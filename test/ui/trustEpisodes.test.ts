import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEpisodes,
  graceMs,
  observedCadenceMs,
  summarise,
  type TrustSample,
} from "../../src/ui/trustEpisodes.ts";
import type { OverallStatus } from "../../src/core/types.ts";

/**
 * Provider trust card — roadmap 8.1.
 *
 * The arithmetic behind an accusation, so the table below is written as the
 * evidence someone would be shown when they dispute the number: a probe series,
 * a page series, and what the pair is entitled to claim about the provider.
 */

const START = Date.parse("2026-09-01T00:00:00.000Z");
const MINUTE = 60_000;

/** A series at a fixed cadence, one character per sample. */
function series(spec: string, cadenceMinutes: number, from = START): TrustSample[] {
  const statuses: Record<string, { status: OverallStatus; ok: boolean }> = {
    // operational, down (major outage), unknown, and a failed read
    ".": { status: "operational", ok: true },
    x: { status: "major_outage", ok: true },
    "?": { status: "unknown", ok: true },
    "!": { status: "unknown", ok: false },
  };
  return [...spec].map((character, index) => {
    const reading = statuses[character];
    assert.ok(reading !== undefined, `unknown sample character ${character}`);
    return {
      at: new Date(from + index * cadenceMinutes * MINUTE).toISOString(),
      status: reading.status,
      ok: reading.ok,
    };
  });
}

test("no disagreement produces no episode", () => {
  const episodes = buildEpisodes({
    probe: series("......", 1),
    page: series("......", 1),
  });
  assert.equal(episodes.length, 0);
});

test("an outage the page admits late is one episode, with the delay from the first failing sample", () => {
  // Probe down from minute 2 to minute 7; page admits at minute 5.
  const episodes = buildEpisodes({
    probe: series("..xxxxx...", 1),
    page: series(".....xx...", 1),
  });
  assert.equal(episodes.length, 1);
  const episode = episodes[0]!;
  assert.equal(episode.outcome, "admitted");
  // Minute 2 to minute 5 — measured from where the outage started, not from
  // where enough samples had accumulated to be sure of it.
  assert.equal(episode.delayMinutes, 3);
  assert.equal(episode.observedMinutes, 5);
  assert.equal(episode.excluded, null);
});

test("an outage the page never mentions is the never-admitted outcome", () => {
  const episodes = buildEpisodes({
    probe: series("..xxx.....", 1),
    page: series("..........", 1),
  });
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0]!.outcome, "never");
  assert.equal(episodes[0]!.delayMinutes, null);
  assert.equal(episodes[0]!.admittedMinutes, 0);
});

test("a page that opens the incident just after recovery admitted it late, not never", () => {
  // Probe recovers at minute 4; the page opens at minute 6, inside the grace
  // window. Counting that as "never admitted" would be the false accusation the
  // outcome exists to prevent.
  const episodes = buildEpisodes({
    probe: series("xxxx......", 1),
    page: series("......xx..", 1),
  });
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0]!.outcome, "after_recovery");
  assert.equal(episodes[0]!.delayMinutes, 6);
  // Admitted outside the outage, so it covers none of it.
  assert.equal(episodes[0]!.admittedMinutes, 0);
});

test("a page that opens the incident long after recovery gets no credit for it", () => {
  // The page is read every minute, so the grace window is its floor: 10 minutes.
  // An admission at minute 40 is outside it.
  const episodes = buildEpisodes({
    probe: series("xxx.....................................", 1),
    page: series("........................................x", 1),
  });
  assert.equal(episodes[0]!.outcome, "never");
});

test("declared maintenance is recorded and excluded, not counted as dishonesty", () => {
  const episodes = buildEpisodes({
    probe: series("..xxx.....", 1),
    page: series("..........", 1),
    maintenance: [
      { startsAt: new Date(START).toISOString(), endsAt: new Date(START + 10 * MINUTE).toISOString() },
    ],
  });
  assert.equal(episodes.length, 1, "the episode is still recorded — the excluded count has to be checkable");
  assert.equal(episodes[0]!.excluded, "maintenance");
});

test("an episode read while the whole fleet was blind is excluded", () => {
  const probe = series("..xxx.....", 1);
  const episodes = buildEpisodes({
    probe,
    page: series("..........", 1),
    blindAt: [probe[3]!.at],
  });
  assert.equal(episodes[0]!.excluded, "fleet_blind");
});

test("a single failing sample opens nothing when flap damping asks for two", () => {
  const episodes = buildEpisodes({
    probe: series("..x.......", 1),
    page: series("..........", 1),
    confirmations: 2,
  });
  assert.equal(episodes.length, 0);
});

test("an unknown reading or a failed read neither opens nor closes an episode", () => {
  // The probe stops answering in the middle of the outage. Treating that as a
  // recovery would close the episode early and hand the page a coverage number
  // for an outage that was still running.
  const episodes = buildEpisodes({
    probe: series("xx!?xx....", 1),
    page: series("..........", 1),
  });
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0]!.observedMinutes, 6);
});

test("an episode still running is not returned", () => {
  const episodes = buildEpisodes({
    probe: series("....xxxxxx", 1),
    page: series("..........", 1),
  });
  assert.equal(episodes.length, 0, "delay and coverage are unknowable until it ends");
});

test("coverage counts only the part of the admission that overlaps the outage", () => {
  // Probe down minutes 0-6. Page admits at minute 3 and clears at minute 9, so
  // three of the six observed minutes were covered.
  const episodes = buildEpisodes({
    probe: series("xxxxxx....", 1),
    page: series("...xxxxxx.", 1),
  });
  const card = summarise(episodes, { probeMs: MINUTE, pageMs: MINUTE });
  assert.equal(card.coverage?.observedMinutes, 6);
  assert.equal(card.coverage?.admittedMinutes, 3);
  assert.equal(card.coverage?.percent, 50);
});

test("the card counts excluded episodes apart and never folds the axes into one score", () => {
  const probe = series("..xxx..xxx..xxx...", 1);
  const episodes = buildEpisodes({
    probe,
    page: series("...x.......x......", 1),
    maintenance: [
      {
        startsAt: new Date(START + 7 * MINUTE).toISOString(),
        endsAt: new Date(START + 10 * MINUTE).toISOString(),
      },
    ],
  });
  const card = summarise(episodes, { probeMs: MINUTE, pageMs: 5 * MINUTE });
  assert.equal(card.counted, 2);
  assert.equal(card.excluded.maintenance, 1);
  assert.equal(card.never, 1);
  // The error bar is the coarser of the two cadences, not the probe's.
  assert.equal(card.resolutionMinutes, 5);
});

test("the observed cadence is the median gap, so a restart does not redefine it", () => {
  const samples = series("....", 5);
  // A gap of an hour where the container was down.
  samples.push({ at: new Date(START + 75 * MINUTE).toISOString(), status: "operational", ok: true });
  assert.equal(observedCadenceMs(samples), 5 * MINUTE);
});

test("the grace window is floored, scaled and capped off the page's own cadence", () => {
  assert.equal(graceMs(60_000), 10 * MINUTE, "a fast page still gets the floor");
  assert.equal(graceMs(15 * MINUTE), 30 * MINUTE, "twice the cadence in between");
  assert.equal(graceMs(2 * 60 * MINUTE), 60 * MINUTE, "an hourly page does not get all day");
});
