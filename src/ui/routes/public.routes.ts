import { Router } from "express";
import {
  publicSummary,
  readPublicPageSettings,
  renderPublicPage,
} from "../publicPage.ts";
import type { UiRuntimeCore } from "../runtime.ts";

/**
 * The public status page's two routes — roadmap 5.1.
 *
 * Both are `GET` and neither reads a body, a query parameter or a header: there
 * is no input to this surface at all, which is the smallest attack surface a
 * public route can have. The provider selection comes from the environment, not
 * from the request, so a visitor cannot ask to see a provider the operator chose
 * not to publish.
 *
 * Both routes are registered whatever the setting says, and answer `404` when
 * the page is off — the same shape `/push` takes for `PUSH_TOKEN`. Registering
 * conditionally would mean the OpenAPI document could not describe a route the
 * server sometimes serves, and the spec's own test (which walks the live
 * router) enforces that symmetry.
 *
 * `404` rather than `403`: a stranger should not learn there is a page here
 * that they are not being shown.
 */
export function publicRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();
  const settings = readPublicPageSettings(runtime.env);

  const locale = async (): Promise<string> =>
    settings.locale ?? (await runtime.configSource.load()).locale;

  /** The one gate, in front of both routes. */
  const off = (res: Parameters<Parameters<Router["get"]>[1]>[1]): boolean => {
    if (settings.enabled) return false;
    res.status(404).json({ error: { message: "not found" } });
    return true;
  };

  router.get("/public", async (_req, res) => {
    if (off(res)) return;
    const summary = await publicSummary(runtime, settings);
    res
      .type("html")
      // Half the poll interval would be ideal and is not knowable per request;
      // a minute is short enough that an outage shows up promptly and long
      // enough that a link doing the rounds does not become a load test.
      .set("cache-control", "public, max-age=60")
      .send(renderPublicPage(summary, await locale()));
  });

  /**
   * The same projection as JSON, for anyone who wants to build their own view
   * on top of it. Deliberately the very same object the page is rendered from:
   * two projections would eventually disagree, and the one that drifted would
   * be the one nobody was looking at.
   */
  router.get("/public/summary.json", async (_req, res) => {
    if (off(res)) return;
    res
      .set("cache-control", "public, max-age=60")
      // A public JSON endpoint is exactly the thing someone wants to fetch from
      // their own page, and it carries nothing private by construction.
      .set("access-control-allow-origin", "*")
      .json(await publicSummary(runtime, settings));
  });

  return router;
}
