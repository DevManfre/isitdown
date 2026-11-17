import type { SentRecord } from "../../../src/core/dispatcher.interface.ts";

/** What `GET /notifications/log` answers, as the dashboard reads it. */
export interface DeliveryLogBody {
  page: { items: SentRecord[]; page: number; pageSize: number; total: number };
  counts: { all: number; sent: number; failed: number };
}
