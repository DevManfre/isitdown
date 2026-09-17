import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand, parseDurationMinutes } from "../../../src/core/chatops/commands.ts";

test("a message that is not a command is not answered at all", () => {
  assert.equal(parseCommand("morning everyone"), null);
  assert.equal(parseCommand("  "), null);
  assert.equal(parseCommand("github/status"), null);
});

test("the bot suffix a group chat adds is stripped before the verb is read", () => {
  const parsed = parseCommand("/status@isitdown_bot");
  assert.deepEqual(parsed, { ok: true, command: { kind: "status", providerId: undefined } });
});

test("/status takes an optional provider, lowercased", () => {
  assert.deepEqual(parseCommand("/status GitHub"), {
    ok: true,
    command: { kind: "status", providerId: "github" },
  });
});

test("/history defaults to 30 days and refuses a window it does not keep", () => {
  assert.deepEqual(parseCommand("/history github"), {
    ok: true,
    command: { kind: "history", providerId: "github", days: 30 },
  });
  assert.deepEqual(parseCommand("/history github 7"), {
    ok: true,
    command: { kind: "history", providerId: "github", days: 7 },
  });
  const refused = parseCommand("/history github 45");
  assert.equal(refused?.ok, false);
  assert.equal(refused?.ok === false ? refused.key : "", "chatops.error.bad-window");
});

test("/mute needs both a provider and a duration", () => {
  assert.equal(
    parseCommand("/mute")?.ok === false ? parseCommand("/mute")?.key : "",
    "chatops.error.provider-required",
  );
  const noDuration = parseCommand("/mute github");
  assert.equal(noDuration?.ok === false ? noDuration.key : "", "chatops.error.duration-required");
  assert.deepEqual(parseCommand("/mute github 2h"), {
    ok: true,
    command: { kind: "mute", providerId: "github", minutes: 120 },
  });
});

test("an unknown verb is named back, so a typo reads as a typo", () => {
  const parsed = parseCommand("/statsu");
  assert.equal(parsed?.ok, false);
  assert.deepEqual(parsed?.ok === false ? parsed.params : undefined, { command: "statsu" });
});

test("durations read minutes, hours and days, and a bare number as minutes", () => {
  assert.equal(parseDurationMinutes("30"), 30);
  assert.equal(parseDurationMinutes("30m"), 30);
  assert.equal(parseDurationMinutes("2h"), 120);
  assert.equal(parseDurationMinutes("1d"), 1440);
  assert.equal(parseDurationMinutes(" 3 hrs "), 180);
});

test("a duration that is not one, or is past the ceiling, is refused rather than guessed", () => {
  // A mute is silence. Guessing at "soon" would silence a provider for an
  // amount of time nobody chose.
  assert.equal(parseDurationMinutes("soon"), null);
  assert.equal(parseDurationMinutes("0h"), null);
  assert.equal(parseDurationMinutes("-2h"), null);
  assert.equal(parseDurationMinutes("2 weeks"), null);
  assert.equal(parseDurationMinutes("31d"), null);
  assert.equal(parseDurationMinutes("30d"), 43_200);
});
