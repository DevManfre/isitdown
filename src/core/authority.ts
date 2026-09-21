import type { Adapter } from "./adapter.interface.ts";

/**
 * Which source is the record about a provider — roadmap 9.1.
 *
 * IsItDown began as an aggregator of status pages. Probes (1.8, 1.9) made it
 * also a monitor of things that publish no page, and the two disagree about
 * almost everything that matters: what uptime means, whether a declared
 * "operational" can be overruled, what the Overview should lead with. The
 * roadmap asked which of the two wins an argument, and left it open.
 *
 * The answer recorded here is **both, declared per provider**. Every provider
 * says which source is authoritative for it, and the dashboard says so beside
 * its numbers — so a figure never means one thing on one row and something else
 * on the next without the row saying which.
 *
 * - `declared` — the provider's own page is the record. A probe may contradict
 *   it, and that contradiction is itself the news (1.10), but the page's word is
 *   what the provider's status *is*.
 * - `observed` — our own reading is the record: there is no page, or the
 *   operator has decided that this one is an opinion.
 */

export const AUTHORITIES = ["declared", "observed"] as const;
export type Authority = (typeof AUTHORITIES)[number];

/**
 * What an adapter implies when the operator has not said.
 *
 * Read off the adapter rather than from a list of adapter ids kept somewhere
 * else: a probe is a probe because of what it does, and a list would be a
 * second place to update every time one is added — the kind of list that is
 * right until it silently is not. An adapter that declares nothing is treated
 * as reading somebody's page, which is what every adapter but three does and
 * what an external plugin (`plugins.ts`) almost certainly is.
 */
export function defaultAuthorityFor(adapter: Pick<Adapter, "kind">): Authority {
  return adapter.kind === "probe" ? "observed" : "declared";
}

/** The provider's authority: what it says, or what its adapter implies. */
export function authorityOf(
  service: { authority?: Authority | undefined },
  adapter: Pick<Adapter, "kind">,
): Authority {
  return service.authority ?? defaultAuthorityFor(adapter);
}
