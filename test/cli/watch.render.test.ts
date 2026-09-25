import { test } from "node:test";
import assert from "node:assert/strict";
import { SOURCE_LOCALE, t } from "../../src/core/i18n/index.ts";
import { render } from "../../src/cli/watch/render.ts";
import { initialState } from "../../src/cli/watch/state.ts";
import type { WatchState } from "../../src/cli/watch/state.ts";

const translate = (key: string, params?: Record<string, string | number>): string => t(SOURCE_LOCALE, key, params);

test("an empty fleet says so instead of printing an empty table", () => {
  const output = render("http://localhost:3000", initialState(), translate);
  assert.match(output, /No providers configured/);
});

test("a provider row shows its name and translated status label", () => {
  const state: WatchState = {
    ...initialState(),
    connection: "streaming",
    providers: [{ id: "github", name: "GitHub", status: "major_outage", since: "2026-01-01T00:00:00.000Z", fetchedAt: "2026-01-01T00:05:00.000Z" }],
  };
  const output = render("http://localhost:3000", state, translate);
  assert.match(output, /GitHub/);
  assert.match(output, /Major outage/);
  assert.doesNotMatch(output, /\{seconds\}|\{url\}|\{provider\}/, "no leftover placeholder");
});

test("the connection state and any error are both visible", () => {
  const state: WatchState = { ...initialState(), connection: "error", errorMessage: t(SOURCE_LOCALE, "cli.watch.error.unauthorized") };
  const output = render("http://localhost:3000", state, translate);
  assert.match(output, /error/i);
  assert.match(output, /401/);
});

test("recent changes are listed under their heading", () => {
  const state: WatchState = {
    ...initialState(),
    changes: [{ at: "2026-01-01T00:10:00.000Z", providerId: "github", providerName: "GitHub", status: "degraded" }],
  };
  const output = render("http://localhost:3000", state, translate);
  assert.match(output, /Recent changes/);
  assert.match(output, /GitHub.*Degraded/);
});

test("with no changes yet, the queue says so", () => {
  const output = render("http://localhost:3000", initialState(), translate);
  assert.match(output, /No changes observed yet/);
});
