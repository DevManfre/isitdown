import type { Router } from "express";
import { describeChannels, readSettings } from "../dbConfigSource.ts";
import { abandonedProviders, installChecks } from "../installHealth.ts";
import { readPublicPageSettings } from "../publicPage.ts";
import type { UiRuntimeCore } from "../runtime.ts";

export function configHealthRoutes(runtime: UiRuntimeCore, router: Router): void {
  /**
   * Roadmap 5.15 and 5.16 in one read: the providers that look abandoned and
   * the installation's housekeeping checklist. Apart from `GET /config` because
   * it scans sample history, and because Settings asks for it on its own.
   */
  router.get("/config/health", (_req, res) => {
    const db = runtime.db;
    const now = Date.now();
    // A channel counts once it is on and every credential it needs resolves —
    // an enabled row with an empty environment variable cannot send anything.
    const enabledChannels = describeChannels(db, runtime.env).filter(
      (channel) =>
        channel.enabled &&
        channel.fields.every((field) => field.isSet || field.optional),
    ).length;
    res.json({
      abandoned: abandonedProviders(db, now),
      checks: installChecks(
        db,
        {
          enabledChannels,
          retentionDays: readSettings(db, runtime.logger).retentionDays,
          update: runtime.updateCheck.state().status,
          publicPageEnabled: readPublicPageSettings(runtime.env).enabled,
          apiTokenSet: (runtime.env["API_TOKEN"] ?? "").trim() !== "",
        },
        now,
      ),
    });
  });
}
