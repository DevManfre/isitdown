import type { NotificationPayload } from "./types.ts";

export interface Notifier {
  /** Channel id, e.g. "telegram". */
  id: string;
  /** Throws on a delivery failure; the dispatcher isolates and records it. */
  send(payload: NotificationPayload): Promise<void>;
}
