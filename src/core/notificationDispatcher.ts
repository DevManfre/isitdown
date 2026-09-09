import type { ServiceDefinition } from "./configSource.interface.ts";
import { DELIVERY_DEFAULTS, type DeliveryConfig } from "./delivery.ts";
import type { Logger } from "./logger.ts";
import type { MessageRefStore } from "./messageRefStore.interface.ts";
import type { Notifier } from "./notifier.interface.ts";
import { clearsFloor, explain, severityOf, type RoutingRule } from "./routing.ts";
import type { NotificationPayload, StatusChange, StatusChangeKind } from "./types.ts";
import { renderMessage } from "../notifiers/formatting.ts";

export interface SentRecord {
  providerId: string;
  channel: string;
  kind: StatusChangeKind;
  /** The rendered message, kept so the UI edition can show what was sent. */
  text: string;
  sentAt: string;
  ok: boolean;
  error?: string | undefined;
  /**
   * How many times the channel was asked to take this message before the
   * outcome above. `1` is a send that worked first time or was never retried;
   * anything higher on a failed record is a dead letter — every attempt was
   * spent and the message is gone.
   */
  attempts: number;
}

export interface DispatchContext {
  services: ServiceDefinition[];
  locale: string;
  /**
   * Built fresh by the caller from the configuration of this cycle, so enabling
   * or disabling a channel takes effect without a restart.
   */
  notifiers: Notifier[];
  /**
   * Ordered by position; the dispatcher never reorders. Never empty — both
   * config sources substitute a catch-all.
   */
  rules: RoutingRule[];
  /**
   * Every channel id this edition can build, enabled or not. It separates "the
   * rule names a channel the operator switched off" (expected, silent) from
   * "the rule names a channel nothing knows about" (a typo or a channel since
   * removed, worth saying out loud). Passed in rather than read from the shared
   * registry because the UI edition contributes `webpush` through `extra`, and
   * a static list would warn about it on every send.
   */
  knownChannelIds: string[];
  /**
   * Quiet hours, the digest window and the per-provider cap. Optional so a
   * caller from before the policy existed still compiles into "everything
   * off", which is the behaviour it had.
   */
  delivery?: DeliveryConfig | undefined;
}

export interface Dispatcher {
  dispatch(changes: StatusChange[], ctx: DispatchContext): Promise<SentRecord[]>;
  /**
   * Delivers one operator-requested test message. It lives here, rather than in a
   * route, so that the dispatcher stays the single gate every outbound
   * notification passes through — the diff engine remains the only thing that
   * decides whether a *status change* notifies, and diagnostics cannot drift into
   * a second sending path.
   */
  sendTest(notifier: Notifier, service: DispatchContext["services"][number], locale: string): Promise<SentRecord>;
}

export interface DispatcherDeps {
  logger: Logger;
  /** Called once per send, success or failure — never once per attempt. The UI edition persists these. */
  onSent?: ((record: SentRecord) => void | Promise<void>) | undefined;
  /** Injected so tests assert the backoff schedule instead of waiting it out. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
  /** Injected so a test can let a digest window and an hour of the cap elapse without waiting. */
  now?: (() => number) | undefined;
  /**
   * Where the id of the message already sent about an incident is kept, so the
   * next update can edit it (roadmap 3.19). Absent means the feature cannot
   * work at all, which is how a caller opts out of it entirely — an edition
   * with nowhere to keep a reference must not silently send duplicates.
   */
  messageRefs?: MessageRefStore | undefined;
}

/**
 * How many times one message may be handed to one channel. A rate limit, a
 * restarting webhook receiver or a dropped connection is over in seconds, and
 * those are the failures that used to lose an alert outright; a stale
 * credential fails all three times and lands in the delivery log as a dead
 * letter, which is the state the operator has to see.
 *
 * Three rather than more: the retries happen inside the poll cycle, so the
 * whole schedule has to stay short against the shortest cadence anything can
 * be polled on (one minute).
 */
const MAX_ATTEMPTS = 3;
const HOUR_MS = 3600_000;

/**
 * Severity as a number, for picking the worst member of a digest. `unknown`
 * ranks below `operational` here — in a batch it is the least informative
 * thing present, and it must never stand in for a batch that also holds a real
 * outage.
 */
const RANK: Record<string, number> = {
  unknown: -1,
  operational: 0,
  degraded: 1,
  partial_outage: 2,
  major_outage: 3,
};

const rankOf = (status: string): number => RANK[status] ?? -1;

const RETRY_BASE_MS = 1000;
const RETRY_JITTER_MS = 250;

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * The only caller of `Notifier.send` in either edition. Its input is the diff
 * engine's output, which is what keeps "should this notify?" answerable in one
 * place: no route handler and no poller shortcut may send a message.
 */
export function createDispatcher(deps: DispatcherDeps): Dispatcher {
  const { logger, onSent } = deps;
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;
  const messageRefs = deps.messageRefs;

  /**
   * When this provider's recent messages went out, newest last. The cap's whole
   * state (roadmap 3.13), and deliberately in memory: a restart is the one
   * moment an operator is watching, and a cap that survived one would swallow
   * the first alerts after it for reasons nothing on screen could explain.
   */
  const recentSends = new Map<string, number[]>();

  /**
   * How many alerts the cap has swallowed for this provider since the last one
   * that got through. Carried into that next message rather than dropped:
   * silence an operator cannot distinguish from a broken channel is the one
   * thing a cap must not produce.
   */
  const suppressedSince = new Map<string, number>();

  /**
   * What is waiting for the next digest window, per channel (roadmap 3.12).
   * Per channel rather than global: the rules decide who covers a change, and
   * two channels covering different providers must not receive each other's
   * batch.
   */
  const digests = new Map<string, { since: number; items: NotificationPayload[] }>();

  /**
   * One message to one channel, retried with exponential backoff until it lands
   * or the attempts run out. Exactly one record comes out either way: the
   * delivery log is a log of messages, not of attempts, and a retried send that
   * wrote a row per try would report a single alert as three failures.
   *
   * `maxAttempts` is a parameter rather than a constant read here so a delivery
   * test can ask for one attempt: the operator pressing "test" is waiting for
   * the answer, and three seconds of backoff on a credential they know is wrong
   * is a worse answer than a fast no.
   */
  async function deliver(
    notifier: Notifier,
    payload: NotificationPayload,
    text: string,
    maxAttempts: number = MAX_ATTEMPTS,
    /**
     * The incident this message continues, when the policy says one incident is
     * one message that gets edited (roadmap 3.19). Absent for everything else,
     * which is every message that has nothing to edit: a status change, a
     * maintenance window, a digest.
     */
    link?: { incidentId: string; final: boolean } | undefined,
  ): Promise<SentRecord> {
    const providerId = payload.change.providerId;
    const kind = payload.change.kind;
    let attempts = 0;
    let failure: string | undefined;

    // An edit first, when there is a message to edit and a channel that can.
    // One attempt, not the retry schedule below: the errors channels give here
    // — message too old, message deleted — are permanent, and the answer to
    // them is the fresh send that follows rather than three more edits.
    if (link !== undefined && messageRefs !== undefined && notifier.update !== undefined) {
      const ref = await messageRefs.getRef(notifier.id, providerId, link.incidentId);
      if (ref !== null) {
        try {
          await notifier.update(payload, ref);
          if (link.final) await messageRefs.forgetRef(notifier.id, providerId, link.incidentId);
          const record: SentRecord = {
            providerId,
            channel: notifier.id,
            kind,
            text,
            sentAt: new Date().toISOString(),
            ok: true,
            attempts: 1,
          };
          logger.info("notification edited in place", { channel: notifier.id, providerId, kind });
          await audit(record);
          return record;
        } catch (error) {
          logger.warn("editing a message failed, sending a new one instead", {
            channel: notifier.id,
            providerId,
            kind,
            error: error instanceof Error ? error.message : String(error),
          });
          // Forgotten before the fallback send: keeping a reference the channel
          // has just refused would make every later update try the same edit
          // and fail the same way.
          await messageRefs.forgetRef(notifier.id, providerId, link.incidentId);
        }
      }
    }

    while (attempts < maxAttempts) {
      if (attempts > 0) {
        // Jittered, like the poller's own backoff: a provider-wide incident
        // notifies every channel at once, and a fleet of instances retrying in
        // lockstep is how a rate limit becomes permanent.
        await sleep(RETRY_BASE_MS * 2 ** (attempts - 1) + Math.random() * RETRY_JITTER_MS);
      }
      attempts += 1;
      try {
        const ref = await notifier.send(payload);
        // A channel that names its messages, an incident to attach it to, and
        // somewhere to keep it: remember it so the next update edits this one.
        // Not for the message that closes an incident — there is nothing left
        // to edit — which is also what keeps the table from growing a row per
        // incident forever.
        if (
          typeof ref === "string" &&
          ref !== "" &&
          link !== undefined &&
          !link.final &&
          messageRefs !== undefined
        ) {
          await messageRefs.saveRef(notifier.id, providerId, link.incidentId, ref);
        }
        failure = undefined;
        break;
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        // Warn, not error: an attempt that has a retry behind it is not yet a
        // lost notification. The dead letter below is the one worth an error.
        logger.warn("notification attempt failed", {
          channel: notifier.id,
          providerId,
          kind,
          attempt: attempts,
          error: failure,
        });
      }
    }

    const record: SentRecord = {
      providerId,
      channel: notifier.id,
      kind,
      text,
      // Stamped now rather than before the first attempt: this is when the
      // message reached the channel, or when it was given up on.
      sentAt: new Date().toISOString(),
      ok: failure === undefined,
      attempts,
      ...(failure === undefined ? {} : { error: failure }),
    };

    if (record.ok) {
      logger.info("notification sent", { channel: notifier.id, providerId, kind, attempts });
    } else {
      // The dead letter: every attempt spent, the message gone. The delivery
      // log is the other half of this — a line in a log nobody tails is not a
      // channel an operator notices has stopped working.
      logger.error("notification failed permanently", {
        channel: notifier.id,
        providerId,
        kind,
        attempts,
        error: record.error,
      });
    }

    await audit(record);
    return record;
  }

  /**
   * Hands one delivery result to whoever is keeping the audit trail. Its own
   * function because both outcomes go through it — a message sent and a message
   * edited in place — and losing the audit row must not lose the result.
   */
  async function audit(record: SentRecord): Promise<void> {
    if (onSent === undefined) return;
    try {
      await onSent(record);
    } catch (error) {
      logger.error("recording a sent notification failed", {
        channel: record.channel,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * The incident a message should be attached to, when the policy says one
   * incident is one message that gets edited (roadmap 3.19).
   *
   * Only the three incident kinds qualify: the opening message is the one that
   * gets edited, an update edits it, and the resolution edits it one last time
   * and lets it go. A status change or a maintenance window is not part of an
   * incident's story, and folding those into the same message would rewrite
   * history an operator had already read.
   */
  function linkOf(
    change: StatusChange,
    delivery: DeliveryConfig,
  ): { incidentId: string; final: boolean } | undefined {
    if (!delivery.updateInPlace) return undefined;
    const incidentId = change.incident?.id;
    if (incidentId === undefined) return undefined;
    if (
      change.kind !== "incident_opened" &&
      change.kind !== "incident_updated" &&
      change.kind !== "incident_resolved"
    ) {
      return undefined;
    }
    return { incidentId, final: change.kind === "incident_resolved" };
  }

  /** Whether this provider has any of its hourly allowance left at `at`. */
  function capAllows(providerId: string, at: number, cap: DeliveryConfig["cap"]): boolean {
    if (!cap.enabled) return true;
    // Pruned on read rather than on a timer: the map is only ever consulted
    // here, and a timer would keep a dispatcher's state alive for providers
    // nothing is polling any more.
    const window = (recentSends.get(providerId) ?? []).filter((sent) => at - sent < HOUR_MS);
    recentSends.set(providerId, window);
    return window.length < cap.maxPerHour;
  }

  /**
   * One message about one provider went out. Counted per change, not per
   * channel: a change routed to three channels is one thing the operator was
   * told, and counting the channels would make the cap depend on how many of
   * them are switched on.
   */
  function countSend(providerId: string, at: number): void {
    recentSends.set(providerId, [...(recentSends.get(providerId) ?? []), at]);
  }

  /** Takes the suppressed tally for a provider and clears it, so it is reported once. */
  function takeSuppressed(providerId: string): number {
    const count = suppressedSince.get(providerId) ?? 0;
    if (count > 0) suppressedSince.delete(providerId);
    return count;
  }

  /**
   * Sends every digest whose window has elapsed, and only those: a batch that
   * is still collecting is the whole point of the feature, so the flush is
   * driven by the clock rather than by a cycle happening to run.
   *
   * The notifier is looked up in the *current* cycle's channels, not captured
   * when the batch started: a channel switched off while a window was open has
   * its batch dropped with a line in the log, which is the same thing a
   * disabled channel does to an immediate send.
   */
  function flushDue(
    ctx: DispatchContext,
    delivery: DeliveryConfig,
    at: number,
    force: boolean,
  ): Promise<SentRecord>[] {
    const byChannelId = new Map(ctx.notifiers.map((notifier) => [notifier.id, notifier]));
    const windowMs = delivery.digest.windowMinutes * 60_000;
    const sends: Promise<SentRecord>[] = [];

    for (const [channelId, batch] of [...digests]) {
      if (!force && at - batch.since < windowMs) continue;
      digests.delete(channelId);
      const [worst] = [...batch.items].sort(
        (a, b) => rankOf(severityOf(b.change)) - rankOf(severityOf(a.change)),
      );
      if (worst === undefined) continue;

      const notifier = byChannelId.get(channelId);
      if (notifier === undefined) {
        logger.warn("dropping a digest for a channel that is no longer enabled", {
          channel: channelId,
          changes: batch.items.length,
        });
        continue;
      }

      const payload: NotificationPayload = {
        ...worst,
        // The most severe member stands in as "the change" so a channel that
        // colours or badges by severity still has one to read; `items` is what
        // the message is actually made of.
        digest: { items: batch.items, windowMinutes: delivery.digest.windowMinutes },
        suppressedCount: takeSuppressed(worst.change.providerId),
      };
      countSend(worst.change.providerId, at);
      sends.push(deliver(notifier, payload, renderMessage(payload)));
    }

    return sends;
  }

  return {
    async sendTest(notifier, service, locale): Promise<SentRecord> {
      const payload: NotificationPayload = {
        change: {
          kind: "monitoring_degraded",
          providerId: service.id,
          currentStatus: "unknown",
          failureCount: 0,
          at: new Date().toISOString(),
        },
        service: { id: service.id, name: service.name, statusUrl: service.baseUrl },
        locale,
      };
      // One attempt: the operator is waiting on this answer (see `deliver`).
      return deliver(notifier, payload, renderMessage(payload), 1);
    },

    async dispatch(changes: StatusChange[], ctx: DispatchContext): Promise<SentRecord[]> {
      const delivery = ctx.delivery ?? DELIVERY_DEFAULTS;
      const at = now();

      // Not `changes.length === 0 && return`: a cycle in which nothing changed
      // is exactly when a digest window quietly runs out, and a flush that only
      // happened on a busy cycle would hold a batch until the next change —
      // which is the flood it exists to replace, delayed.
      const attempts: Promise<SentRecord>[] = flushDue(ctx, delivery, at, false);
      if (changes.length === 0) {
        const settled = await Promise.allSettled(attempts);
        return settled.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value] : []));
      }

      const byId = new Map(ctx.services.map((service) => [service.id, service]));

      // Neither varies per change, so both are built once for the whole batch
      // rather than rebuilt on every iteration of the loop below.
      const byChannelId = new Map(ctx.notifiers.map((notifier) => [notifier.id, notifier]));
      const known = new Set(ctx.knownChannelIds);
      const enabledChannelIds = [...byChannelId.keys()];

      for (const change of changes) {
        const service = byId.get(change.providerId);
        if (service === undefined) {
          // A provider removed between the poll and the dispatch, which the UI
          // edition makes possible. Nothing to link to, so nothing to send.
          logger.warn("skipping a change for an unconfigured provider", {
            providerId: change.providerId,
            kind: change.kind,
          });
          continue;
        }

        const base: NotificationPayload = {
          change,
          service: { id: service.id, name: service.name, statusUrl: service.baseUrl },
          locale: ctx.locale,
        };

        // Who covers this change, and whether the hour of the day takes it
        // away from them again (roadmap 3.11). Evaluated together in core's own
        // evaluator, so the dashboard's dry run and this cannot disagree.
        const routed = explain(change, ctx.rules, enabledChannelIds, {
          quietHours: delivery.quietHours,
          at: new Date(at),
          // What lets a rule target "my deploy path" rather than four provider
          // ids (roadmap 2.6). Read off the service the change already resolved
          // to, so the evaluator stays pure and knows nothing about the fleet.
          ...(service.group === undefined ? {} : { providerGroup: service.group }),
        });
        if (routed.quieted) {
          logger.info("quiet hours held a change back", {
            providerId: change.providerId,
            kind: change.kind,
            floor: delivery.quietHours.minSeverity,
          });
          continue;
        }
        if (routed.targets.length === 0) continue;

        // The cap is per provider and per change, so it is asked once here
        // rather than inside the channel loop below (roadmap 3.13).
        if (!capAllows(change.providerId, at, delivery.cap)) {
          suppressedSince.set(change.providerId, (suppressedSince.get(change.providerId) ?? 0) + 1);
          logger.warn("the hourly cap held a change back", {
            providerId: change.providerId,
            kind: change.kind,
            maxPerHour: delivery.cap.maxPerHour,
          });
          continue;
        }

        // Under the floor, so it waits for the batch (roadmap 3.12). It is
        // deliberately not counted against the cap: a digest is one message
        // however many changes went into it, and charging each of them would
        // make the two controls fight.
        const batched =
          delivery.digest.enabled &&
          !clearsFloor(severityOf(change), delivery.digest.immediateFloor);

        // Taken once for the change, not once per channel: the tally is what
        // the operator was not told about this provider, and reporting it on
        // the first channel and zero on the rest would be a message that
        // disagrees with itself across channels.
        let counted = false;
        let suppressed: number | undefined;
        for (const channelId of routed.targets) {
          const notifier = byChannelId.get(channelId);
          if (notifier === undefined) {
            // A configured-but-disabled channel is the normal case and says
            // nothing. A channel no registry knows is a broken rule, and a
            // broken routing rule means missing alerts.
            if (!known.has(channelId)) {
              logger.warn("a routing rule names an unknown channel", {
                channelId,
                providerId: change.providerId,
                kind: change.kind,
              });
            }
            continue;
          }

          if (batched) {
            const batch = digests.get(channelId) ?? { since: at, items: [] };
            batch.items.push(base);
            digests.set(channelId, batch);
            continue;
          }

          if (!counted) {
            countSend(change.providerId, at);
            suppressed = takeSuppressed(change.providerId);
            counted = true;
          }
          const payload: NotificationPayload = { ...base, suppressedCount: suppressed ?? 0 };
          attempts.push(deliver(notifier, payload, renderMessage(payload), MAX_ATTEMPTS, linkOf(change, delivery)));
        }
      }

      const settled = await Promise.allSettled(attempts);
      return settled.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value] : []));
    },
  };
}
