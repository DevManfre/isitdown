import { Router } from "express";
import type { UiRuntimeCore } from "../runtime.ts";
import type { TrustPair } from "../trust.ts";

/**
 * Provider trust cards — roadmap 8.1.
 *
 * How closely a provider's own status page tracked what a probe observed. Only
 * pairs exist here: a card needs a probe pointed at the real service and a
 * `crossChecks` naming the page that is supposed to speak for it, so a fleet
 * without one gets an empty list and the dashboard shows no section at all.
 * Sparse by nature, and deliberately not a column on the overview.
 *
 * The window is selectable, and the ten-episode floor is applied inside the
 * window the caller asked for — a 30-day view built on two episodes has to stay
 * silent even when 90 days would speak.
 */

/** Windows the card offers. Same shape as the history views' own allowlist. */
const ALLOWED_DAYS = [30, 90, 365] as const;

function parseWindow(raw: unknown): number {
  const days = Number.parseInt(String(raw ?? ""), 10);
  return (ALLOWED_DAYS as readonly number[]).includes(days) ? days : 90;
}

function pairKey(pair: TrustPair): string {
  return pair.componentId === ""
    ? `${pair.probeId}->${pair.pageId}`
    : `${pair.probeId}->${pair.pageId}#${pair.componentId}`;
}

export function trustRoutes(runtime: UiRuntimeCore): Router {
  const router = Router();

  router.get("/trust", (req, res) => {
    const days = parseWindow(req.query["days"]);
    const cards = runtime.trustPairs().map((pair) => ({
      key: pairKey(pair),
      ...runtime.trust.card(pair, days),
    }));
    res.json({ days, windows: ALLOWED_DAYS, cards });
  });

  router.get("/trust/:key/episodes", (req, res) => {
    const days = parseWindow(req.query["days"]);
    const pair = runtime.trustPairs().find((candidate) => pairKey(candidate) === req.params.key);
    if (pair === undefined) {
      res.status(404).json({ error: "no such cross-checked pair" });
      return;
    }
    // Every episode, excluded ones included: they are how the excluded counts
    // on the card can be checked, and a card that hides what it dropped is not
    // a card anyone should be asked to believe.
    res.json({ key: req.params.key, days, episodes: runtime.trust.episodes(pair, days) });
  });

  return router;
}
