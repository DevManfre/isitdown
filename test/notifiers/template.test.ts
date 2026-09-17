import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMessage, renderParts, templateValues } from "../../src/notifiers/formatting.ts";
import { TEMPLATE_TOKENS, TEMPLATE_MAX_LENGTH, templateProblems } from "../../src/notifiers/template.ts";
import type { NotificationPayload, StatusChange } from "../../src/core/types.ts";

/**
 * Per-channel message templates — roadmap 3.15.
 *
 * The behaviour worth holding is not "substitution works": it is the three
 * limits the feature was allowed to ship with. A template must not become a
 * language, a typo must be caught where it is typed rather than where it is
 * paged, and a template written for an incident must stay readable on a change
 * that has no incident in it.
 */

const service = { id: "github", name: "GitHub", statusUrl: "https://www.githubstatus.com" };

const incident = {
  id: "i1",
  name: "API requests failing",
  impact: "major",
  status: "investigating",
  updatedAt: "2026-08-19T14:32:07.000Z",
};

const opened: StatusChange = {
  kind: "incident_opened",
  providerId: "github",
  currentStatus: "major_outage",
  incident,
  at: "2026-08-19T14:32:07.000Z",
};

const statusChange: StatusChange = {
  kind: "status_change",
  providerId: "github",
  previousStatus: "operational",
  currentStatus: "degraded",
  at: "2026-08-19T14:32:07.000Z",
};

const payloadFor = (change: StatusChange, template?: string, locale = "en"): NotificationPayload => ({
  change,
  service,
  locale,
  ...(template === undefined ? {} : { template }),
});

test("every declared token resolves to a string", () => {
  const values = templateValues(payloadFor(opened));
  for (const token of Object.keys(TEMPLATE_TOKENS)) {
    assert.equal(typeof values[token as keyof typeof TEMPLATE_TOKENS], "string", token);
  }
  assert.deepEqual(Object.keys(values).sort(), Object.keys(TEMPLATE_TOKENS).sort());
});

test("a template replaces the default rendering and keeps the operator's own words", () => {
  const rendered = renderMessage(payloadFor(opened, "[ACME] {{provider}} {{severity}}: {{title}}"));
  assert.equal(rendered, "[ACME] GitHub MAJOR OUTAGE: API requests failing");
});

test("no template leaves the message byte for byte what it was", () => {
  assert.equal(renderMessage(payloadFor(opened)), renderMessage(payloadFor(opened, "")));
  assert.equal(renderMessage(payloadFor(opened)), renderMessage(payloadFor(opened, "   ")));
});

test("{{message}} carries the whole default message rather than recursing", () => {
  const plain = renderMessage(payloadFor(opened));
  assert.equal(renderMessage(payloadFor(opened, "#ops\n{{message}}")), `#ops\n${plain}`);
});

test("a line made only of tokens with nothing behind them disappears", () => {
  // Written for an incident, delivered on a status change: there is no title
  // and no incident status, and what arrives must not be two empty lines.
  const template = "{{provider}} — {{status}}\n{{title}}\n{{incidentStatus}}\n{{url}}";
  assert.equal(
    renderMessage(payloadFor(statusChange, template)),
    "GitHub — Degraded\nhttps://www.githubstatus.com",
  );
});

test("a line that carries literal text keeps it even when its token is empty", () => {
  assert.equal(renderMessage(payloadFor(statusChange, "Incident: {{title}}")), "Incident:");
});

test("substitution is all a template can do: braces are not an expression language", () => {
  // Neither of these is a token, so neither is touched — and both are reported
  // where the template is saved (below), which is what stops them reaching a
  // channel at all.
  const rendered = renderMessage(payloadFor(opened, "{{#if title}} {{provider|upper}} {{provider}}"));
  assert.match(rendered, /GitHub$/);
  assert.match(rendered, /\{\{#if title\}\}/);
});

test("an unknown token is a problem reported by name, with the known set beside it", () => {
  const problems = templateProblems("{{provder}} {{provider}} {{sevrity}}");
  assert.equal(problems.length, 2);
  assert.match(problems[0] ?? "", /unknown token \{\{provder\}\}/);
  assert.match(problems[0] ?? "", /known tokens are message, emoji, provider/);
  assert.match(problems[1] ?? "", /unknown token \{\{sevrity\}\}/);
});

test("a template that names no token at all is refused", () => {
  assert.deepEqual(templateProblems("{provider} is down"), [
    "a template names no token, so every notification would read the same",
  ]);
  // An empty template is not a broken one: it means the default rendering.
  assert.deepEqual(templateProblems(""), []);
});

test("a template longer than the cap is refused", () => {
  assert.deepEqual(templateProblems(`{{provider}}${"x".repeat(TEMPLATE_MAX_LENGTH)}`), [
    `a template may be at most ${TEMPLATE_MAX_LENGTH} characters`,
  ]);
});

test("validating the same template twice gives the same answer", () => {
  // A module-level /g regexp carries `lastIndex` between calls, and the second
  // read of one template would then disagree with the first.
  assert.deepEqual(templateProblems("{{provider}}"), templateProblems("{{provider}}"));
});

test("a structured channel splits a templated message like any other, and drops the link it renders itself", () => {
  const parts = renderParts(payloadFor(opened, "{{provider}} {{severity}}\n\n{{title}}\n{{url}}"));
  assert.equal(parts.heading, "GitHub MAJOR OUTAGE");
  assert.equal(parts.detail, "API requests failing");
  assert.equal(parts.url, service.statusUrl);
});

test("a template renders in the channel's own locale", () => {
  assert.equal(
    renderMessage(payloadFor(statusChange, "{{provider}}: {{previous}} → {{status}}", "it")),
    "GitHub: Operativo → Degradato",
  );
});

test("the suppressed line survives a template, which has no token for it", () => {
  const payload: NotificationPayload = { ...payloadFor(opened, "{{provider}}"), suppressedCount: 3 };
  const rendered = renderMessage(payload);
  assert.match(rendered, /^GitHub\n\n/);
  assert.match(rendered, /3/);
});

test("a digest is never templated", () => {
  const items = [payloadFor(opened), payloadFor(statusChange)];
  const digest: NotificationPayload = {
    ...payloadFor(opened, "{{provider}} ONLY"),
    digest: { items, windowMinutes: 15 },
  };
  const rendered = renderMessage(digest);
  assert.doesNotMatch(rendered, /ONLY/);
  assert.match(rendered, /API requests failing/);
});
