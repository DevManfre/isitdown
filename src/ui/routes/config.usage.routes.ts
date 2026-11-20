import type { Router } from "express";
import { buildUsageReport } from "../../core/usageReport.ts";
import type { UiRuntimeCore } from "../runtime.ts";
import { CURRENT_VERSION } from "../updateCheck.ts";

const isSet = (value: string | undefined): boolean => (value ?? "").trim() !== "";

export function configUsageRoutes(runtime: UiRuntimeCore, router: Router): void {
  /**
   * Roadmap 16.3: the opt-in "what I use" report — counts and identifiers,
   * nothing that says whose installation this is. Only ever read; the
   * operator decides whether it goes anywhere.
   */
  router.get("/config/usage-report", async (_req, res) => {
    const env = runtime.env;
    res.json(
      buildUsageReport({
        edition: "ui",
        version: CURRENT_VERSION,
        config: await runtime.configSource.load(),
        allServices: runtime.listAllServices(),
        features: {
          apiToken: isSet(env["API_TOKEN"]),
          egressAllow: isSet(env["EGRESS_ALLOW"]),
          heartbeat: isSet(env["HEARTBEAT_TOKEN"]),
          publicPage: env["PUBLIC_PAGE"]?.trim().toLowerCase() === "true",
          push: isSet(env["PUSH_TOKEN"]),
        },
        deprecatedInUse: runtime.deprecations.used(),
      }),
    );
  });
}
