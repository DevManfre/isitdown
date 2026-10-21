import { z } from "zod";
import type { Router } from "express";
import type { UiRuntimeCore } from "../runtime.ts";
import { ensureVapidKeys } from "../vapidKeys.ts";
import { issues } from "./config.shared.ts";

// Push endpoints are https by protocol (no browser issues a plain-http one),
// and none of these fields has any business being large — a browser-supplied
// body should not be able to push arbitrary-length strings into SQLite.
const subscriptionSchema = z.object({
  endpoint: z.string().max(2048).url().startsWith("https://"),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
  label: z.string().min(1).max(80),
});

export function configPushRoutes(runtime: UiRuntimeCore, router: Router): void {
  const db = runtime.db;

  /**
   * The VAPID public key is public by construction — the browser needs it to
   * subscribe. Its private half is generated alongside it and stays in the
   * process; neither is an operator credential, so nothing here reads the
   * environment and the channel has no fields to configure (see
   * src/ui/vapidKeys.ts).
   */
  router.get("/config/push", (_req, res) => {
    res.json({ publicKey: ensureVapidKeys(db, runtime.logger).publicKey });
  });

  router.get("/config/push/subscriptions", (_req, res) => {
    res.json({ devices: runtime.pushSubscriptions.listDevices() });
  });

  router.post("/config/push/subscriptions", (req, res) => {
    const parsed = subscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: issues(parsed.error) } });
      return;
    }
    const { endpoint, keys, label } = parsed.data;
    runtime.pushSubscriptions.save({ endpoint, keys }, label);
    res.status(201).json({ devices: runtime.pushSubscriptions.listDevices() });
  });

  router.delete("/config/push/subscriptions/:id", (req, res) => {
    if (!runtime.pushSubscriptions.remove(req.params.id)) {
      res
        .status(404)
        .json({ error: { message: `unknown device: ${req.params.id}` } });
      return;
    }
    res.status(204).end();
  });
}
