import type { ServiceDefinition } from "./configSource.interface.ts";
import type { Logger } from "./logger.ts";
import type { Notifier } from "./notifier.interface.ts";
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
}

export interface Dispatcher {
  dispatch(changes: StatusChange[], ctx: DispatchContext): Promise<SentRecord[]>;
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
    async dispatch(changes: StatusChange[], ctx: DispatchContext): Promise<SentRecord[]> {
      if (changes.length === 0 || ctx.notifiers.length === 0) return [];

      const byId = new Map(ctx.services.map((service) => [service.id, service]));
      const attempts: Promise<SentRecord>[] = [];

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

        for (const notifier of ctx.notifiers) {
          attempts.push(deliver(notifier, payload, text));
        }
      }

      const settled = await Promise.allSettled(attempts);
      return settled.flatMap((outcome) => (outcome.status === "fulfilled" ? [outcome.value] : []));
    },
  };
}
