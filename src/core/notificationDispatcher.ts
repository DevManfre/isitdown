import type { Recipient, ServiceDefinition } from "./configSource.interface.ts";
import { DELIVERY_DEFAULTS, type DeliveryConfig } from "./delivery.ts";
import type { Logger } from "./logger.ts";
import type { MessageRefStore } from "./messageRefStore.interface.ts";
import type { Notifier } from "./notifier.interface.ts";
import { isMuted } from "./diffEngine.ts";
import { clearsFloor, explain, inQuietHours, severityOf, type RoutingRule } from "./routing.ts";
import type { NotificationPayload, StatusChange, StatusChangeKind } from "./types.ts";
import { tracer } from "./tracing.ts";
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
  /**
   * What each channel asked for about the *wording* of its messages, keyed by
   * channel id: the locale it reads in (roadmap 3.20) and the template it
   * renders with (roadmap 3.15).
   *
   * Separate from `notifiers` because a notifier is a transport and this is
   * not: the same Telegram notifier posts an Italian message and an English one
   * depending on nothing but which channel row it was built from. Optional and
   * defaulted to the context locale, so a caller from before it existed behaves
   * exactly as it did.
   */
  channelMessages?: Record<string, ChannelMessageOptions> | undefined;
  /**
   * The channels whose messages can carry Ack and Mute because the edition is
   * listening for the press (roadmap 3.1). Empty or absent — the Light edition,
   * and a UI edition with chatops off — means no message grows a button.
   */
  interactiveChannels?: readonly string[] | undefined;
  /**
   * Channels grouped by the person they reach, preferred first (roadmap 3.5).
   * Absent or empty means every channel a rule names is sent to on its own,
   * which is what every caller from before recipients existed asks for.
   */
  recipients?: readonly Recipient[] | undefined;
}

/** One channel's answer to "in what words?" — see `DispatchContext.channelMessages`. */
export interface ChannelMessageOptions {
  locale?: string | undefined;
  template?: string | undefined;
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
  sendTest(
    notifier: Notifier,
    service: DispatchContext["services"][number],
    locale: string,
    /**
     * The channel's own locale and template, when it has them. A test that
     * ignored them would show the operator a message the channel will never
     * send, which is the one thing a test must not do.
     */
    message?: ChannelMessageOptions | undefined,
  ): Promise<SentRecord>;
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
  /**
   * What escalation (roadmap 3.2) needs to know that only the edition can say:
   * whether somebody has taken this provider's trouble in charge, and whether
   * the provider is still in trouble at all. Absent in the Light edition, which
   * has neither an acknowledgement nor a button to give one — and an escalation
   * that was asked for there is refused out loud rather than run blind, because
   * "nobody answered" is not a thing it can know.
   */
  escalation?:
    | {
        isAcked(providerId: string): Promise<boolean>;
        inTrouble(providerId: string): Promise<boolean>;
      }
    | undefined;
  /**
   * Incidents somebody asked to follow from the dashboard (roadmap 3.6): every
   * update of one reaches every enabled channel until it resolves, whatever the
   * routing rules say about its provider. Absent in the Light edition, which has
   * no button to follow anything with.
   */
  follows?:
    | {
        isFollowed(providerId: string, incidentId: string): Promise<boolean>;
        unfollow(providerId: string, incidentId: string): Promise<void>;
      }
    | undefined;
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

/** What a message says about the provider it is about — its page, and why it matters (roadmap 3.7). */
function payloadServiceOf(service: ServiceDefinition): NotificationPayload["service"] {
  return {
    id: service.id,
    name: service.name,
    statusUrl: service.baseUrl,
    ...(service.impact === undefined ? {} : { impact: service.impact }),
    ...(service.owner === undefined ? {} : { owner: service.owner }),
  };
}

/**
 * The targets a rule reached, grouped into delivery chains (roadmap 3.5). A
 * channel in no recipient is a chain of one, sent to as it always was. A
 * recipient becomes one chain of its channels *that the rule reached*, in the
 * recipient's order: the rule still decides who may hear about a change, and the
 * recipient only decides how many times — so a rule that keeps a provider off
 * Discord keeps it off Discord's fallback too.
 */
export function chainsOf(targets: readonly string[], recipients: readonly Recipient[] | undefined): string[][] {
  const chains: string[][] = [];
  const placed = new Set<string>();
  for (const channelId of targets) {
    if (placed.has(channelId)) continue;
    const recipient = recipients?.find((candidate) => candidate.channels.includes(channelId));
    const chain = recipient === undefined ? [channelId] : recipient.channels.filter((id) => targets.includes(id));
    for (const id of chain) placed.add(id);
    chains.push(chain);
  }
  return chains;
}

/** A batch of delivery results, some of which came back as a chain's several records. */
type Attempt = Promise<SentRecord | SentRecord[]>;

async function settleAll(attempts: Attempt[]): Promise<SentRecord[]> {
  const settled = await Promise.allSettled(attempts);
  return settled.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value].flat() : []));
}

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
  const escalationDeps = deps.escalation;
  const follows = deps.follows;

  /**
   * The current run of failures per channel (roadmap 3.4): how many messages in
   * a row it refused, since when, about which provider the last one was, and
   * whether the other channels have been told. A success ends the run, so the
   * next broken stretch is told about again. In memory like the cap, for the
   * same reason: a restart is when an operator is watching, and a run carried
   * across one would alert about a channel nobody has seen fail since.
   */
  const channelRuns = new Map<
    string,
    { failures: number; since: string; providerId: string; error?: string | undefined; told: boolean }
  >();

  /**
   * Changes waiting to see whether anybody answers (roadmap 3.2), one per
   * provider: what was said, when, and whether this stretch of trouble is done
   * with. In memory like the cap and the digest — a restart clears the clocks, so
   * the first alerts after one are never escalated by a timer nobody can see.
   *
   * An entry stays after it has escalated, and goes only when the provider is out
   * of trouble: that is what makes this one escalation per stretch rather than
   * one per later update, which would be the same nag every quarter hour.
   */
  const pendingEscalations = new Map<string, { payload: NotificationPayload; since: number; settled: boolean }>();
  let escalationRefused = false;

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
  const digests = new Map<string, { since: number; items: NotificationPayload[]; fallbacks: string[] }>();

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

    // One span per message per channel — roadmap 6.10. Around the retry loop
    // rather than inside it: the question a trace answers is "how long did
    // telling somebody take", and three attempts with backoff between them are
    // one answer to that, not three.
    return tracer().span(
      "notification.send",
      { "isitdown.channel": notifier.id, "isitdown.provider": providerId, "isitdown.kind": kind },
      () => attemptDelivery(),
    );

    async function attemptDelivery(): Promise<SentRecord> {
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
  ): Attempt[] {
    const byChannelId = new Map(ctx.notifiers.map((notifier) => [notifier.id, notifier]));
    const windowMs = delivery.digest.windowMinutes * 60_000;
    const sends: Attempt[] = [];

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
      // The recipient's later channels (roadmap 3.5), as they were when the
      // batch started, minus any switched off since.
      const chain = [
        notifier,
        ...batch.fallbacks.flatMap((id) => {
          const fallback = byChannelId.get(id);
          return fallback === undefined ? [] : [fallback];
        }),
      ];

      const suppressedCount = takeSuppressed(worst.change.providerId);
      // The batch is per channel, so its language is that channel's (roadmap
      // 3.20) — stamped on every member as well as on the payload, because the
      // digest renders one line per item out of each item's own locale. The
      // items were collected before anyone knew which channel would take them.
      const digestFor = (target: Notifier): NotificationPayload => {
        const locale = ctx.channelMessages?.[target.id]?.locale ?? ctx.locale;
        return {
          ...worst,
          locale,
          // Deliberately not templated: a template describes one change and this
          // is a batch of them. See `src/notifiers/template.ts`.
          template: undefined,
          // The most severe member stands in as "the change" so a channel that
          // colours or badges by severity still has one to read; `items` is what
          // the message is actually made of.
          digest: {
            items: batch.items.map((item) => ({ ...item, locale })),
            windowMinutes: delivery.digest.windowMinutes,
          },
          suppressedCount,
        };
      };
      countSend(worst.change.providerId, at);
      sends.push(
        deliverChain(chain, (target) => {
          const payload = digestFor(target);
          return deliver(target, payload, renderMessage(payload));
        }),
      );
    }

    return sends;
  }

  /**
   * Hands one message to the first channel of a chain, and to the next only when
   * that one failed for good (roadmap 3.5). One record per channel tried, so the
   * delivery log shows the preferred channel's failure as well as the fallback
   * that carried the message — a fallback that hid why it was needed would hide
   * a broken channel exactly as well as no fallback at all.
   */
  async function deliverChain(
    chain: readonly Notifier[],
    send: (notifier: Notifier) => Promise<SentRecord>,
  ): Promise<SentRecord[]> {
    const records: SentRecord[] = [];
    for (const [index, notifier] of chain.entries()) {
      const record = await send(notifier);
      records.push(record);
      if (record.ok) break;
      const next = chain[index + 1];
      if (next !== undefined) {
        logger.warn("falling back to the recipient's next channel", {
          failed: notifier.id,
          next: next.id,
          providerId: record.providerId,
        });
      }
    }
    return records;
  }

  /** Each channel's run of failures, extended or ended by what just happened to it. */
  function noteOutcomes(records: readonly SentRecord[]): void {
    for (const record of records) {
      if (record.ok) {
        channelRuns.delete(record.channel);
        continue;
      }
      const run = channelRuns.get(record.channel);
      channelRuns.set(record.channel, {
        failures: (run?.failures ?? 0) + 1,
        since: run?.since ?? record.sentAt,
        providerId: record.providerId,
        error: record.error,
        told: run?.told ?? false,
      });
    }
  }

  /**
   * Says so on the other channels when one has refused `afterFailures` messages
   * in a row (roadmap 3.4) — once per run, so a webhook down for a week is one
   * alert and not one per poll.
   *
   * Routed like any monitoring change, through the same rules, so an operator
   * who keeps monitoring off the phone keeps this off it too; then the broken
   * channel is taken out, along with every other channel currently in a run of
   * its own, because telling a channel that is not delivering is telling nobody.
   * Held by quiet hours like anything else, and left untold while held, so it
   * goes out the morning after rather than never.
   */
  async function channelAlerts(ctx: DispatchContext, delivery: DeliveryConfig, at: number): Promise<SentRecord[]> {
    const policy = delivery.channelHealth;
    if (!policy.enabled || channelRuns.size === 0) return [];
    const byChannelId = new Map(ctx.notifiers.map((notifier) => [notifier.id, notifier]));
    const broken = (id: string): boolean => (channelRuns.get(id)?.failures ?? 0) >= policy.afterFailures;
    const attempts: Attempt[] = [];

    for (const [channelId, run] of [...channelRuns]) {
      // A channel switched off is no longer expected to deliver anything.
      if (!byChannelId.has(channelId)) {
        channelRuns.delete(channelId);
        continue;
      }
      if (run.told || run.failures < policy.afterFailures) continue;
      // The provider the last lost message was about, or — if it has since been
      // removed — any provider, so the alert still has a subject to hang on.
      const service = ctx.services.find((candidate) => candidate.id === run.providerId) ?? ctx.services[0];
      if (service === undefined) continue;

      const change: StatusChange = {
        kind: "channel_failing",
        providerId: service.id,
        currentStatus: "unknown",
        channel: { id: channelId, failures: run.failures, since: run.since, error: run.error },
        at: new Date(at).toISOString(),
      };
      const routed = explain(change, ctx.rules, [...byChannelId.keys()], {
        quietHours: delivery.quietHours,
        at: new Date(at),
        ...(service.group === undefined ? {} : { providerGroup: service.group }),
      });
      if (routed.quieted) continue;
      const healthy = routed.targets.filter((id) => id !== channelId && !broken(id) && byChannelId.has(id));
      run.told = true;
      if (healthy.length === 0) {
        logger.error("a channel keeps failing and no other channel is routed to say so", {
          channel: channelId,
          failures: run.failures,
          since: run.since,
        });
        continue;
      }
      logger.warn("a channel keeps failing, telling the others", {
        channel: channelId,
        failures: run.failures,
        to: healthy,
      });
      const base: NotificationPayload = { change, service: payloadServiceOf(service), locale: ctx.locale };
      for (const chain of chainsOf(healthy, ctx.recipients)) {
        const notifiers = chain.flatMap((id) => byChannelId.get(id) ?? []);
        attempts.push(
          deliverChain(notifiers, (notifier) => {
            const message = ctx.channelMessages?.[notifier.id];
            const payload: NotificationPayload = {
              ...base,
              locale: message?.locale ?? ctx.locale,
              ...(message?.template === undefined ? {} : { template: message.template }),
            };
            return deliver(notifier, payload, renderMessage(payload));
          }),
        );
      }
    }
    return settleAll(attempts);
  }

  /**
   * Whether this change starts the escalation clock: trouble that is still going
   * and clears the operator's floor. A recovery has nothing to answer, and the
   * kinds that are not about the provider's own state — a maintenance notice, a
   * slow page, our own fetching failing — are not what anyone is being paged for.
   */
  function startsEscalation(change: StatusChange, floor: DeliveryConfig["escalation"]["minSeverity"]): boolean {
    switch (change.kind) {
      case "status_change":
      case "component_status_change":
      case "incident_opened":
      case "incident_updated":
        return (
          change.currentStatus !== "operational" &&
          change.currentStatus !== "unknown" &&
          clearsFloor(severityOf(change), floor)
        );
      default:
        return false;
    }
  }

  /**
   * Starts, or refreshes, the clock for a change that was just sent. Refreshing
   * keeps the original start: the clock measures how long this trouble has gone
   * unanswered, and a worse update ten minutes in does not make anybody's
   * silence shorter.
   */
  function trackEscalation(change: StatusChange, payload: NotificationPayload, delivery: DeliveryConfig, at: number): void {
    const policy = delivery.escalation;
    if (!policy.enabled || !startsEscalation(change, policy.minSeverity)) return;
    if (escalationDeps === undefined || policy.channel === "") {
      // Said once, not per change: the operator asked for something this edition
      // or this configuration cannot do, and a line per alert would bury it.
      if (!escalationRefused) {
        escalationRefused = true;
        logger.warn(
          escalationDeps === undefined
            ? "escalation is on but this edition cannot tell whether anybody took a change in charge, so nothing will be escalated"
            : "escalation is on but no channel is chosen to escalate to, so nothing will be escalated",
        );
      }
      return;
    }
    const existing = pendingEscalations.get(change.providerId);
    pendingEscalations.set(change.providerId, {
      payload,
      since: existing?.since ?? at,
      settled: existing?.settled ?? false,
    });
  }

  /**
   * Says again whatever has gone unanswered for long enough. Asked on every
   * dispatch, including the ones with nothing to dispatch: like a digest window,
   * the wait runs out on the clock, not when the next change happens to arrive.
   * Its resolution is therefore one poll cycle — the dispatcher is only ever
   * asked then — which is why a wait shorter than the cadence is no shorter.
   */
  async function dueEscalations(
    ctx: DispatchContext,
    delivery: DeliveryConfig,
    at: number,
  ): Promise<Attempt[]> {
    const policy = delivery.escalation;
    if (!policy.enabled || escalationDeps === undefined) {
      pendingEscalations.clear();
      return [];
    }
    const byChannelId = new Map(ctx.notifiers.map((notifier) => [notifier.id, notifier]));
    const sends: Attempt[] = [];

    for (const [providerId, entry] of [...pendingEscalations]) {
      // Out of trouble, however it ended: forgotten, so the next stretch starts
      // a fresh clock. Judged on the provider's own state rather than on a
      // resolving change, because a mute or a maintenance window swallows that.
      if (!(await escalationDeps.inTrouble(providerId))) {
        pendingEscalations.delete(providerId);
        continue;
      }
      if (entry.settled || at - entry.since < policy.afterMinutes * 60_000) continue;

      // From here this stretch of trouble is done with, whatever the answer: it
      // is either escalated, or somebody has it, or the operator said they know.
      entry.settled = true;
      if (await escalationDeps.isAcked(providerId)) continue;
      const service = ctx.services.find((candidate) => candidate.id === providerId);
      if (service === undefined) {
        pendingEscalations.delete(providerId);
        continue;
      }
      if (isMuted(service.mutedUntil, new Date(at).toISOString())) continue;

      const notifier = byChannelId.get(policy.channel);
      if (notifier === undefined) {
        // The escalation target was switched off, or never existed: an alert
        // nobody answered that then goes nowhere is the one outcome this feature
        // exists to prevent, so it is a warning and not a shrug.
        logger.warn("escalation could not be sent because its channel is not enabled", {
          channel: policy.channel,
          providerId,
        });
        continue;
      }

      const message = ctx.channelMessages?.[policy.channel];
      const payload: NotificationPayload = {
        ...entry.payload,
        locale: message?.locale ?? ctx.locale,
        template: message?.template,
        interactive: ctx.interactiveChannels?.includes(policy.channel) === true ? true : undefined,
        escalated: { afterMinutes: policy.afterMinutes },
        suppressedCount: 0,
      };
      logger.warn("a change nobody took in charge is being escalated", {
        providerId,
        channel: policy.channel,
        afterMinutes: policy.afterMinutes,
      });
      sends.push(deliver(notifier, payload, renderMessage(payload)));
    }
    return sends;
  }

  /**
   * Waits for every send of a dispatch, then reads what they say about each
   * channel's health and, where one has now failed often enough, tells the
   * others (roadmap 3.4). Those alerts are counted too, so a second channel
   * failing while it says the first one is broken is told about next time.
   */
  async function finish(attempts: Attempt[], ctx: DispatchContext, delivery: DeliveryConfig, at: number): Promise<SentRecord[]> {
    const records = await settleAll(attempts);
    noteOutcomes(records);
    const alerts = await channelAlerts(ctx, delivery, at);
    noteOutcomes(alerts);
    return [...records, ...alerts];
  }

  return {
    async sendTest(notifier, service, locale, message): Promise<SentRecord> {
      const payload: NotificationPayload = {
        change: {
          kind: "monitoring_degraded",
          providerId: service.id,
          currentStatus: "unknown",
          failureCount: 0,
          at: new Date().toISOString(),
        },
        service: payloadServiceOf(service),
        locale: message?.locale ?? locale,
        ...(message?.template === undefined ? {} : { template: message.template }),
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
      const attempts: Attempt[] = flushDue(ctx, delivery, at, false);
      // Before this cycle's own changes are tracked, so a change cannot be
      // escalated in the dispatch that first sent it.
      attempts.push(...(await dueEscalations(ctx, delivery, at)));
      if (changes.length === 0) return finish(attempts, ctx, delivery, at);

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
          service: payloadServiceOf(service),
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
        // Followed from the dashboard (roadmap 3.6): every enabled channel
        // hears this incident whatever the rules say about its provider. Its
        // resolution is the last thing followed, so the follow ends with it.
        const incidentId = change.incident?.id;
        const followed =
          follows !== undefined &&
          incidentId !== undefined &&
          (change.kind === "incident_opened" || change.kind === "incident_updated" || change.kind === "incident_resolved") &&
          (await follows.isFollowed(change.providerId, incidentId));
        if (followed && change.kind === "incident_resolved") await follows.unfollow(change.providerId, incidentId);
        // Quiet hours still hold a followed incident: following one says "tell
        // me every update", not "wake me for every update".
        const held = followed
          ? inQuietHours(delivery.quietHours, new Date(at)) && !clearsFloor(severityOf(change), delivery.quietHours.minSeverity)
          : routed.quieted;
        if (held) {
          logger.info("quiet hours held a change back", {
            providerId: change.providerId,
            kind: change.kind,
            floor: delivery.quietHours.minSeverity,
          });
          continue;
        }
        const targets = followed ? [...new Set([...routed.targets, ...enabledChannelIds])] : routed.targets;
        if (targets.length === 0) continue;

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
        // Whether any channel was handed this change right now (not batched, not
        // skipped): the escalation clock starts from a message that went out.
        let sentNow = false;
        // One chain per recipient the rule reached, one per lone channel
        // (roadmap 3.5): a recipient on Telegram and Discord hears this once.
        for (const chainIds of chainsOf(targets, ctx.recipients)) {
          const chain: Notifier[] = [];
          for (const channelId of chainIds) {
            const notifier = byChannelId.get(channelId);
            if (notifier !== undefined) {
              chain.push(notifier);
              continue;
            }
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
          }
          const [head, ...fallbacks] = chain;
          if (head === undefined) continue;

          if (batched) {
            const batch = digests.get(head.id) ?? { since: at, items: [], fallbacks: fallbacks.map((notifier) => notifier.id) };
            batch.items.push(base);
            digests.set(head.id, batch);
            continue;
          }

          if (!counted) {
            countSend(change.providerId, at);
            suppressed = takeSuppressed(change.providerId);
            counted = true;
          }
          // The two things the channel itself decides about the message: what
          // language it is written in (roadmap 3.20) and how it is laid out
          // (roadmap 3.15). Applied per channel rather than when `base` was
          // built, because one change routed to three channels can legitimately
          // be three different messages — and a fallback is a fourth.
          const payloadFor = (notifier: Notifier): NotificationPayload => {
            const message = ctx.channelMessages?.[notifier.id];
            return {
              ...base,
              locale: message?.locale ?? base.locale,
              ...(message?.template === undefined ? {} : { template: message.template }),
              ...(ctx.interactiveChannels?.includes(notifier.id) === true ? { interactive: true } : {}),
              suppressedCount: suppressed ?? 0,
            };
          };
          attempts.push(
            deliverChain(chain, (notifier) => {
              const payload = payloadFor(notifier);
              return deliver(notifier, payload, renderMessage(payload), MAX_ATTEMPTS, linkOf(change, delivery));
            }),
          );
          sentNow = true;
        }
        if (sentNow) trackEscalation(change, base, delivery, at);
      }

      return finish(attempts, ctx, delivery, at);
    },
  };
}
