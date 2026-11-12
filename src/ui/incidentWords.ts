import type { OverallStatus } from "../core/types.ts";

/**
 * What keeps breaking, in the providers' own words — roadmap 6.9.
 *
 * Two readings of rows already stored. The incident titles say what the
 * providers called their trouble ("elevated error rates", "DNS"), and the
 * component samples say which part of a page actually went red, which a title
 * often does not name. Only titles: the update bodies a provider posts are read
 * live from its page and never stored, so they cannot be counted.
 *
 * Counting is per incident, not per occurrence: a title that says "database"
 * twice is one database incident, and a count of mentions would reward the
 * provider that writes the longest titles.
 */

export interface TermCount {
  term: string;
  /** Incidents whose title carries it. */
  incidents: number;
  /** Providers those incidents came from, sorted. */
  providers: string[];
}

export interface ComponentBreakage {
  providerId: string;
  componentId: string;
  name: string;
  /** Days in the window the component spent at least partly not operational. */
  badDays: number;
}

/**
 * Words that carry no meaning in an incident title: English function words
 * plus the lifecycle boilerplate nearly every title shares. "Investigating
 * issues with" tops every fleet's list and says nothing about any of them.
 */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "being", "by", "for", "from", "has", "have", "in", "into",
  "is", "it", "its", "of", "on", "or", "our", "some", "that", "the", "their", "this", "to", "was", "we", "were",
  "with", "within", "while", "after", "all", "can", "may", "not", "no", "now", "out", "over", "up", "via",
  "affected", "affecting", "customers", "identified", "impact", "impacting", "incident", "investigating",
  "issue", "issues", "monitoring", "problem", "problems", "resolved", "update", "users", "currently", "certain",
  "experiencing", "increased", "multiple", "subset", "small", "number",
]);

const MAX_WORDS = 15;
const MAX_PHRASES = 10;
const PHRASE_LENGTHS = [3, 2] as const;

/** Lowercased words; a stopword splits a run, so a phrase never spans one. */
function runsOf(title: string): string[][] {
  const runs: string[][] = [[]];
  for (const token of title.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'.-]*/gu) ?? []) {
    const word = token.replace(/[.'-]+$/u, "");
    if (STOPWORDS.has(word) || /^\d+$/.test(word) || word.length < 2) {
      if (runs.at(-1)!.length > 0) runs.push([]);
      continue;
    }
    runs.at(-1)!.push(word);
  }
  return runs.filter((run) => run.length > 0);
}

interface Tally {
  incidents: Set<number>;
  providers: Set<string>;
}

function tally(counts: Map<string, Tally>, term: string, index: number, providerId: string): void {
  const entry = counts.get(term) ?? { incidents: new Set<number>(), providers: new Set<string>() };
  entry.incidents.add(index);
  entry.providers.add(providerId);
  counts.set(term, entry);
}

function ranked(counts: Map<string, Tally>): TermCount[] {
  return [...counts.entries()]
    .map(([term, entry]) => ({ term, incidents: entry.incidents.size, providers: [...entry.providers].sort() }))
    .sort((left, right) => right.incidents - left.incidents || left.term.localeCompare(right.term));
}

export function countTerms(incidents: readonly { providerId: string; name: string }[]): {
  words: TermCount[];
  phrases: TermCount[];
} {
  const words = new Map<string, Tally>();
  const phrases = new Map<string, Tally>();

  incidents.forEach((incident, index) => {
    for (const run of runsOf(incident.name)) {
      for (const word of run) tally(words, word, index, incident.providerId);
      for (const length of PHRASE_LENGTHS) {
        for (let start = 0; start + length <= run.length; start += 1) {
          tally(phrases, run.slice(start, start + length).join(" "), index, incident.providerId);
        }
      }
    }
  });

  // A phrase seen once is a title, not a pattern. And a shorter phrase that
  // only ever appears inside a longer one is the same finding twice:
  // "elevated error rates" already says "error rates".
  const recurring = ranked(phrases).filter((phrase) => phrase.incidents >= 2);
  const kept = recurring.filter(
    (phrase) =>
      !recurring.some(
        (longer) =>
          longer.term !== phrase.term &&
          longer.incidents === phrase.incidents &&
          ` ${longer.term} `.includes(` ${phrase.term} `),
      ),
  );

  return { words: ranked(words).slice(0, MAX_WORDS), phrases: kept.slice(0, MAX_PHRASES) };
}

const QUIET: ReadonlySet<OverallStatus> = new Set(["operational", "unknown"]);

/**
 * Components by how many days they spent not operational, worst first.
 * Days rather than samples or episodes: a component that flaps forty times in
 * an afternoon had one bad afternoon, and a day count is what reads the same
 * across providers polled at different cadences.
 */
export function rankComponents(
  providers: readonly {
    providerId: string;
    components: readonly { componentId: string; name: string; buckets: readonly { status: OverallStatus }[] }[];
  }[],
): ComponentBreakage[] {
  return providers
    .flatMap((provider) =>
      provider.components.map((component) => ({
        providerId: provider.providerId,
        componentId: component.componentId,
        name: component.name,
        badDays: component.buckets.filter((bucket) => !QUIET.has(bucket.status)).length,
      })),
    )
    .filter((component) => component.badDays > 0)
    .sort(
      (left, right) =>
        right.badDays - left.badDays ||
        left.providerId.localeCompare(right.providerId) ||
        left.name.localeCompare(right.name),
    );
}
