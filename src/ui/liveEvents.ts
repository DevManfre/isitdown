/**
 * The dashboard's push channel, one hub and no transport of its own.
 *
 * The dashboard used to learn about a finished cycle by asking every 30
 * seconds, which made a manual poll feel late, kept an idle tab talking, and
 * left the countdown guessing at a deadline it could only re-read on the next
 * round. The scheduler already knows the moment a cycle ends; this is the
 * seam that lets it say so.
 *
 * Deliberately not a WebSocket: nothing the dashboard sends needs a socket —
 * every write it makes is already an HTTP request — and server-sent events
 * ride plain HTTP with reconnection handled by the browser, so this costs no
 * new dependency in a project whose whole pitch is having four.
 */

export interface LiveEvent {
  /** `hello` on connect, `cycle` when one finishes. */
  type: "hello" | "cycle";
  data: Record<string, unknown>;
}

export interface LiveEvents {
  /** Returns the unsubscribe; a stream that has gone away must not be written to. */
  subscribe(listener: (event: LiveEvent) => void): () => void;
  publish(event: LiveEvent): void;
  /** Open streams. Read by the tests, and by nothing that behaves differently for it. */
  subscriberCount(): number;
}

export function createLiveEvents(): LiveEvents {
  const listeners = new Set<(event: LiveEvent) => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    publish(event) {
      // A copy, because a listener that unsubscribes on delivery — a stream
      // that has just died — would otherwise mutate the set being walked.
      for (const listener of [...listeners]) listener(event);
    },

    subscriberCount: () => listeners.size,
  };
}
