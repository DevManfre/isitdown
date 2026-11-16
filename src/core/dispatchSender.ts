import type { Clock } from "./clock.ts";
import type { DispatcherDeps, SentRecord } from "./dispatcher.interface.ts";
import type { Logger } from "./logger.ts";
import type { MessageRefStore } from "./messageRefStore.interface.ts";
import type { Notifier } from "./notifier.interface.ts";
import type { NotificationPayload, StatusChangeKind } from "./types.ts";
import { tracer } from "./tracing.ts";

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
export const MAX_ATTEMPTS = 3;

/**
 * A batch of delivery results, some of which came back as a chain's several
 * records. The context says whose message it was, so a rejection nobody
 * expected can still be logged and recorded against a provider and a channel.
 */
export interface Attempt {
  run: Promise<SentRecord | SentRecord[]>;
  providerId: string;
  /** For a chain, its preferred channel: the one the message was meant for. */
  channel: string;
  kind: StatusChangeKind;
}

export function attempt(
  run: Promise<SentRecord | SentRecord[]>,
  providerId: string,
  channel: string | undefined,
  kind: StatusChangeKind,
): Attempt {
  return { run, providerId, channel: channel ?? "unknown", kind };
}

const RETRY_BASE_MS = 1000;
const RETRY_JITTER_MS = 250;

/**
 * How a dispatcher hands one message to its channels: the retried send, the
 * in-place edit, the recipient's fallback chain and the audit row each one
 * leaves. Split out of the dispatcher so its policy — who hears what, when —
 * reads apart from the mechanics of getting a message through.
 */
export interface Sender {
  deliver(
    notifier: Notifier,
    payload: NotificationPayload,
    text: string,
    maxAttempts?: number,
    link?: { incidentId: string; final: boolean } | undefined,
  ): Promise<SentRecord>;
  deliverChain(chain: readonly Notifier[], send: (notifier: Notifier) => Promise<SentRecord>): Promise<SentRecord[]>;
  settleAll(attempts: Attempt[]): Promise<SentRecord[]>;
}

export interface SenderDeps {
  logger: Logger;
  onSent: DispatcherDeps["onSent"];
  clock: Clock;
  messageRefs: MessageRefStore | undefined;
}

export function createSender(deps: SenderDeps): Sender {
  const { logger, onSent, clock, messageRefs } = deps;
  const sleep = (ms: number) => clock.sleep(ms);
  const now = () => clock.now();

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
            sentAt: new Date(now()).toISOString(),
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
      let sentRef: string | void | undefined;
      while (attempts < maxAttempts) {
        if (attempts > 0) {
          // Jittered, like the poller's own backoff: a provider-wide incident
          // notifies every channel at once, and a fleet of instances retrying in
          // lockstep is how a rate limit becomes permanent.
          await sleep(RETRY_BASE_MS * 2 ** (attempts - 1) + Math.random() * RETRY_JITTER_MS);
        }
        attempts += 1;
        try {
          sentRef = await notifier.send(payload);
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

      // A channel that names its messages, an incident to attach it to, and
      // somewhere to keep it: remember it so the next update edits this one.
      // Not for the message that closes an incident — there is nothing left
      // to edit — which is also what keeps the table from growing a row per
      // incident forever. Outside the send's try: the message has already
      // gone, so a store that cannot keep its reference must not make the
      // loop send it again.
      if (
        failure === undefined &&
        typeof sentRef === "string" &&
        sentRef !== "" &&
        link !== undefined &&
        !link.final &&
        messageRefs !== undefined
      ) {
        try {
          await messageRefs.saveRef(notifier.id, providerId, link.incidentId, sentRef);
        } catch (error) {
          logger.warn("could not remember the message for later edits", {
            providerId,
            channel: notifier.id,
            error: error instanceof Error ? error.message : String(error),
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
        sentAt: new Date(now()).toISOString(),
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
   * Waits for every attempt. One that rejected — a throw outside `deliver`'s
   * own retry loop — is logged and recorded as a failed delivery rather than
   * dropped: a failed delivery is always visible.
   */
  async function settleAll(attempts: Attempt[]): Promise<SentRecord[]> {
    const settled = await Promise.allSettled(attempts.map((item) => item.run));
    const records: SentRecord[] = [];
    for (const [index, outcome] of settled.entries()) {
      if (outcome.status === "fulfilled") {
        records.push(...[outcome.value].flat());
        continue;
      }
      const context = attempts[index];
      if (context === undefined) continue;
      const error = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      logger.error("a delivery failed before it could be tried", {
        providerId: context.providerId,
        channel: context.channel,
        error,
      });
      const record: SentRecord = {
        providerId: context.providerId,
        channel: context.channel,
        kind: context.kind,
        text: "",
        sentAt: new Date(now()).toISOString(),
        ok: false,
        attempts: 0,
        error,
      };
      await audit(record);
      records.push(record);
    }
    return records;
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
  return { deliver, deliverChain, settleAll };
}
