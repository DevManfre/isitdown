import { createPublicKey, verify } from "node:crypto";
import { serviceDefinitionSchema } from "../core/config.schema.ts";
import { catalogFileSchema, type CatalogEntry, type CatalogFile } from "./catalog.ts";

/**
 * The catalog, updatable without a new image — roadmap 2.2.
 *
 * The catalog ships inside the build, so a provider that moves its status page
 * used to need a release before the picker knew. The catalog job (roadmap 2.1)
 * also publishes the same list, signed, beside the code on `main`; an install
 * that opts in reads it on a slow cadence and prefers it to its own copy when
 * it is newer and the signature holds.
 *
 * Three rules keep that from being a way to push anything into anybody's
 * fleet:
 *
 * - **Signed or ignored.** Ed25519 over the exact bytes served, with the
 *   public key compiled in here. A file that does not verify is a failed check,
 *   and the bundled copy stays in charge.
 * - **Checked like a hand edit.** Every entry still has to pass the service
 *   schema and name an adapter this build has; one that does not is dropped,
 *   never trusted because the signature was good.
 * - **Proposed, never applied.** A configured provider whose catalog entry
 *   moved gets a proposal the operator accepts or dismisses. Nothing here
 *   writes a service.
 *
 * Edition-agnostic and pure but for the signature check: fetching on a
 * schedule and remembering dismissals is the UI edition's.
 */

/** Where the catalog job publishes the list and its signature. */
export const CATALOG_FEED_URL =
  "https://raw.githubusercontent.com/DevManfre/isitdown/main/catalog/catalog.json";
export const CATALOG_SIGNATURE_URL = `${CATALOG_FEED_URL}.sig`;

/** The key the catalog job signs with. Its private half lives only in a CI secret. */
export const CATALOG_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAgk3WWQgRzWunS5RpCsxl4+mEzLo5JfObf6QrFKxfSLQ=
-----END PUBLIC KEY-----
`;

export type VerifiedCatalog =
  | { ok: true; catalog: CatalogFile; dropped: string[] }
  | { ok: false; reason: string };

/**
 * The downloaded list, if its signature holds over these exact bytes and it is
 * a catalog at all. `signature` is the base64 the job writes; `knownAdapters`
 * is this build's registry, passed in so a list naming an adapter added in a
 * later release drops that row instead of offering a provider nothing can read.
 */
export function verifyCatalog(
  body: string,
  signature: string,
  knownAdapters: readonly string[],
  publicKey: string = CATALOG_PUBLIC_KEY,
): VerifiedCatalog {
  let valid: boolean;
  try {
    valid = verify(null, Buffer.from(body, "utf8"), createPublicKey(publicKey), Buffer.from(signature.trim(), "base64"));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "the signature does not match the published key" };

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return { ok: false, reason: "the signed file is not JSON" };
  }
  const parsed = catalogFileSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "the signed file is not a catalog" };

  const known = new Set(knownAdapters);
  const dropped: string[] = [];
  const entries = parsed.data.entries.filter((entry) => {
    const usable = known.has(entry.adapter) && serviceDefinitionSchema.safeParse(entry).success;
    if (!usable) dropped.push(entry.id);
    return usable;
  });
  return { ok: true, catalog: { generatedAt: parsed.data.generatedAt, entries }, dropped };
}

/** Whether a downloaded list should replace the one this build shipped. */
export function isNewer(candidate: CatalogFile, bundledGeneratedAt: string): boolean {
  return Date.parse(candidate.generatedAt) > Date.parse(bundledGeneratedAt);
}

/** A configured provider whose catalog entry now reads differently. */
export interface CatalogProposal {
  serviceId: string;
  name: string;
  from: { adapter: string; baseUrl: string };
  to: { adapter: string; baseUrl: string };
}

/**
 * Configured providers whose catalog entry has moved — "GitHub changed its
 * status page's url: update?".
 *
 * Matched by id, which is what a provider added from the catalog carries. A
 * dismissal names the exact value turned down (`id adapter baseUrl`), so the
 * operator who deliberately points `github` somewhere else is asked once about
 * this move, and again only when the catalog moves a second time.
 */
export function catalogProposals(
  services: readonly { id: string; name: string; adapter: string; baseUrl: string }[],
  entries: readonly CatalogEntry[],
  dismissed: ReadonlySet<string>,
): CatalogProposal[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const proposals: CatalogProposal[] = [];
  for (const service of services) {
    const entry = byId.get(service.id);
    if (entry === undefined) continue;
    if (entry.adapter === service.adapter && sameUrl(entry.baseUrl, service.baseUrl)) continue;
    if (dismissed.has(dismissalKey(service.id, entry))) continue;
    proposals.push({
      serviceId: service.id,
      name: service.name,
      from: { adapter: service.adapter, baseUrl: service.baseUrl },
      to: { adapter: entry.adapter, baseUrl: entry.baseUrl },
    });
  }
  return proposals;
}

/** What a dismissal remembers: the provider and the value it was offered. */
export function dismissalKey(serviceId: string, to: { adapter: string; baseUrl: string }): string {
  return `${serviceId} ${to.adapter} ${to.baseUrl}`;
}

/** A trailing slash is not a move. */
function sameUrl(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}
