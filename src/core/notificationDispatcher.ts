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
  /** Called once per attempt, success or failure. The UI edition persists these. */
  onSent?: ((record: SentRecord) => void | Promise<void>) | undefined;
}

/**
 * The only caller of `Notifier.send` in either edition. Its input is the diff
 * engine's output, which is what keeps "should this notify?" answerable in one
 * place: no route handler and no poller shortcut may send a message.
 */
export function createDispatcher(deps: DispatcherDeps): Dispatcher {
  const { logger, onSent } = deps;

  async function deliver(
    notifier: Notifier,
    payload: NotificationPayload,
    text: string,
  ): Promise<SentRecord> {
    const record: SentRecord = {
      providerId: payload.change.providerId,
      channel: notifier.id,
      kind: payload.change.kind,
      text,
      sentAt: new Date().toISOString(),
      ok: true,
    };

    try {
      await notifier.send(payload);
      logger.info("notification sent", {
        channel: notifier.id,
        providerId: record.providerId,
        kind: record.kind,
      });
    } catch (error) {
      record.ok = false;
      record.error = error instanceof Error ? error.message : String(error);
      logger.error("notification failed", {
        channel: notifier.id,
        providerId: record.providerId,
        kind: record.kind,
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
      return deliver(notifier, payload, renderMessage(payload));
    },

    async dispatch(changes: StatusChange[], ctx: DispatchContext): Promise<SentRecord[]> {
      if (changes.length === 0) return [];

      const byId = new Map(ctx.services.map((service) => [service.id, service]));
      const attempts: Promise<SentRecord>[] = [];

      // Neither varies per change, so both are built once for the whole batch
      // rather than rebuilt on every iteration of the loop below.
      const byChannelId = new Map(ctx.notifiers.map((notifier) => [notifier.id, notifier]));
      const known = new Set(ctx.knownChannelIds);

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

        for (const channelId of resolveTargets(change, ctx.rules, [...byChannelId.keys()])) {
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
