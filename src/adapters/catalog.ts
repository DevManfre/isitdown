import { z } from "zod";
import catalogFile from "./catalog.json" with { type: "json" };

/**
 * The bundled provider catalog (roadmap 5.11).
 *
 * Adding a provider needs three answers only whoever wrote the adapters can
 * give: which adapter reads that page, the base url that adapter expects, and
 * an id the schema accepts. Detection (`detect.ts`) answers the first two from
 * a pasted url; this list answers all three from a name, which is what a first
 * run actually starts with — "I want to watch GitHub", not a url.
 *
 * It lives in `src/adapters` for the same reason detection does: it is
 * knowledge about adapters, and the Light edition's `config.yml` takes exactly
 * these fields. It is deliberately a list and not a lookup service — no
 * network, no upstream to be down, nothing to keep in sync at runtime.
 *
 * Every entry was confirmed by running `detectAdapter` against the page and then
 * reading it through its adapter: the adapter and base url here are what
 * detection itself answered, not what a provider's marketing page says. Providers whose status page refuses an
 * automated read (Stripe, GitLab, Zendesk, Okta and friends, all of which
 * answer 403 to a plain fetch) are deliberately absent rather than listed and
 * broken — detection stays the path for a page this list does not have.
 */
export interface CatalogEntry {
  /** Slug the service schema accepts, unchanged. */
  id: string;
  name: string;
  adapter: string;
  baseUrl: string;
}

/**
 * The catalog as a generated artifact (roadmap 2.1): `tools/build-catalog.mjs`
 * reads the curated seed and the public status-page lists, runs every
 * candidate through detection and its adapter, and writes what answered here.
 * Validated on import, so a hand edit that breaks the shape fails the build
 * rather than the picker.
 */
export const catalogFileSchema = z.object({
  /** ISO 8601, UTC. When the generator last wrote this list. */
  generatedAt: z.string().datetime(),
  entries: z.array(
    z.object({
      id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
      name: z.string().min(1),
      adapter: z.string().min(1),
      baseUrl: z.string().url(),
    }),
  ),
});

export type CatalogFile = z.infer<typeof catalogFileSchema>;

const bundled = catalogFileSchema.parse(catalogFile);

export const CATALOG: readonly CatalogEntry[] = bundled.entries;
/** When the bundled list was generated — what a downloaded one has to be newer than (roadmap 2.2). */
export const CATALOG_GENERATED_AT: string = bundled.generatedAt;
