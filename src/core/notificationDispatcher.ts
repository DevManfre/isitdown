import type { ServiceDefinition } from "./configSource.interface.ts";
import type { Logger } from "./logger.ts";
import type { Notifier } from "./notifier.interface.ts";
import { resolveTargets, type RoutingRule } from "./routing.ts";
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
  ): Promise<SentRecord> {
    const providerId = payload.change.providerId;
    const kind = payload.change.kind;
    let attempts = 0;
    let failure: string | undefined;

    while (attempts < maxAttempts) {
      if (attempts > 0) {
        // Jittered, like the poller's own backoff: a provider-wide incident
        // notifies every channel at once, and a fleet of instances retrying in
        // lockstep is how a rate limit becomes permanent.
        await sleep(RETRY_BASE_MS * 2 ** (attempts - 1) + Math.random() * RETRY_JITTER_MS);
      }
      attempts += 1;
      try {
        await notifier.send(payload);
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

    if (onSent !== undefined) {
      try {
        await onSent(record);
      } catch (error) {
        // Losing the audit row must not lose the delivery result.
        logger.error("recording a sent notification failed", {
          channel: notifier.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return record;
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
      if (changes.length === 0) return [];

      const byId = new Map(ctx.services.map((service) => [service.id, service]));
      const attempts: Promise<SentRecord>[] = [];

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

        const payload: NotificationPayload = {
          change,
          service: { id: service.id, name: service.name, statusUrl: service.baseUrl },
          locale: ctx.locale,
        };
        const text = renderMessage(payload);

        for (const channelId of resolveTargets(change, ctx.rules, enabledChannelIds)) {
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
          attempts.push(deliver(notifier, payload, text));
        }
      }

      const settled = await Promise.allSettled(attempts);
      return settled.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value] : []));
    },
  };
}
