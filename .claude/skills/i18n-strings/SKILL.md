---
name: i18n-strings
description: Use when writing or changing any string a human will read — dashboard labels, buttons, headings, empty states, tooltips, validation/error text shown in the UI, notification message text, status names — or when reviewing code that contains a quoted user-facing literal. Also use when adding a language or a new catalog key.
---

# i18n Strings

Every user-facing string in IsItDown is a **key** resolved through the i18n layer. The source text is **always English**, stored in a catalog file, and translated in the other catalogs.

Two rules, no exceptions:

1. **No user-facing literal in code.** Code references a key; the text lives in a JSON catalog.
2. **English is the source language.** `en.json` holds the original wording, whatever language the conversation with the user is in. Italian (or any other language) exists only as a translation of an English key — never as the string typed into the code.

## Applies to

- Dashboard text: labels, buttons, headings, tab names, empty states, tooltips, chart axis/legend labels, relative-time words, settings copy, validation messages shown to the operator.
- Notification message text sent by notifiers (shared by both editions).
- Human-readable status names ("Operational", "Degraded performance", "Major outage").

## Does NOT apply to

Leave these as plain English literals — they are not user-facing text:

- `console.log` / logger output, stack traces, thrown `Error` messages consumed by developers.
- Identifiers and config values: adapter ids, provider ids, channel ids, DB column names, route paths, env var names, HTTP header names.
- Test fixtures and test assertions.
- The catalog keys themselves.

## Recipe — adding a string

1. **Pick the catalog** (they are separate layers, a string belongs to exactly one):

| String appears in | Catalog | Loaded by |
|---|---|---|
| Notification message (Telegram/Discord/Slack/webhook) | `src/core/i18n/<lang>.json` | both editions, via `src/core/i18n/index.ts` |
| Dashboard / browser UI | `src/ui/web/locales/<lang>.json` | UI edition only, client-side, via `i18next.init({ resources })` in `src/ui/web/lib/i18n.ts` |

2. **Name the key**: flat, dotted, lowercase — `<area>.<subject>.<variant>`. No nesting, no dynamic key building.

```
status.operational
status.major-outage
service.add.button
service.empty-state.title
chart.uptime.range.30d
notification.incident.opened
notification.incident.resolved
```

Name it after **meaning, not wording** — `service.add.button`, not `service.add-a-service-button`. Rewording English later must not force a key rename.

3. **Write the English value in `en.json`**, sentence case, no trailing period on labels:

```json
{
  "service.add.button": "Add service",
  "notification.incident.opened": "{provider} — {severity}\n\nIncident: {title}\nStatus: {status}\nUpdated: {updatedAt}"
}
```

4. **Add the same key to every other catalog** in that layer (`it.json`, …). The catalog parity test fails on a key present in one catalog and missing in another. If you can't produce a confident translation, put the English value in and tell the user which keys need a native review — don't leave the key out.

5. **Reference the key from code**, never the text:

```ts
// notifier (core i18n, locale comes from config/DB — never a module-level default)
import { t } from "../core/i18n";
const message = t(locale, "notification.incident.opened", {
  provider: payload.provider,
  severity: payload.severity,
  title: payload.incident.title,
  status: payload.incident.status,
  updatedAt: formatUtc(payload.updatedAt),
});
```

```tsx
// dashboard: resolve the key, never the text
const { t } = useTranslation();
<Button>{t("service.add.button")}</Button>
<h2>{t("service.empty-state.title")}</h2>
```

## i18next configuration invariants

`src/ui/web/lib/i18n.ts` configures the dashboard's i18next instance. These
choices are deliberate — don't "simplify" them back to the library defaults:

- **`keySeparator: false`** — a dotted key like `service.add.button` is one
  flat key, not a nested path (`service` → `add` → `button`). Key names stay
  dotted for readability without i18next trying to resolve them as a tree.
- **`nsSeparator: false`** — disables namespace splitting on the key passed
  to `t()`. This is a **key-side** setting only: it never touches a resolved
  catalog *value*. A colon inside a translation value (`"Impatto: {impact}"`)
  is safe to render regardless of how `nsSeparator` is set, because
  `nsSeparator` never parses values, only the string handed to `t()`.
  Disabling it is still the right defensive default for this repo's flat,
  dotted-key convention — it just doesn't provide a value-side guarantee, and
  a comment claiming it does is describing the wrong mechanism.
- **Single-brace interpolation** (`prefix: "{", suffix: "}"`) — placeholders
  are `{provider}`, not i18next's default `{{provider}}`.
- **Plurals** use `_one` / `_other` key suffixes, selected by `Intl.PluralRules`
  under the hood — never `key + (n === 1 ? "" : "s")`.
- Catalogs are imported JSON, registered directly as i18next `resources` at
  init time — not fetched, so there's no request path for a stale or missing
  catalog file at runtime.
- `returnNull: false` is set but is inert: it has been i18next's own default
  since v24, and no catalog value is ever a JSON `null`. Keep it or drop it;
  don't describe it as load-bearing.

## Interpolation, plurals, formatting

Mechanism for the dashboard catalog is in the invariants block above; the
authoring rules are the same in both layers:

- **Named placeholders only**: `{provider}`, `{count}`. Never build a sentence by concatenating translated fragments — word order differs per language.
- **Plurals**: one key per form (`incident.count.one` / `incident.count.other`) selected with `Intl.PluralRules`. Never `key + (n === 1 ? "" : "s")`.
- **Dates, numbers, percentages, relative times**: `Intl.DateTimeFormat` / `Intl.NumberFormat` / `Intl.RelativeTimeFormat` with the active locale. Notification timestamps stay UTC with an explicit `UTC` suffix in every locale.
- **Don't localize** provider names, URLs, or severity ids — only the human-readable severity label.

## Constraints that don't move

- `en` is the fallback: a missing key renders the English string, never an empty node and never the raw key.
- Catalogs are validated with `zod` at load, like every other external input.
- `src/core/i18n/` stays edition-agnostic — the Diff Engine keeps passing structured payloads and stays language-unaware; translation happens in the notifier. Never import `src/ui` or `src/light` from it.
- Adding a language = one JSON file per layer, plus one line in
  `src/ui/web/lib/i18n.ts` (the `SUPPORTED` array and the `resources`
  object). That registry line **is** the intended code change, not a
  design failure — catalogs are bundled at build time (see the
  invariants block above), so "registered" means "listed in the
  module that builds the `resources` object," not "fetched at
  runtime with nothing to touch in code." The old "if it needs a code
  change, the design is wrong" absolute described the previous,
  fetch-at-runtime catalog loader; it no longer applies now that
  catalogs are imported JSON.

## Rationalizations — all of them mean "add the key"

| Excuse | Reality |
|---|---|
| "It's one word, I'll extract it later" | Later never comes; the untranslated word ships. One key is 10 seconds. |
| "The user speaks Italian, so I'll write the label in Italian" | The conversation language is not the source language. `en.json` holds the English; `it.json` holds the Italian. |
| "It's an error message, errors aren't UI" | If the operator reads it in the browser, it's UI. Dev-only logs/thrown Errors are not. |
| "It's a placeholder, the design isn't final" | Placeholder text is still rendered text. Key it now, reword the value later — that's why keys are meaning-based. |
| "It's inside the prototype in `design/`, not real code" | Prototypes are exempt. `src/` is not. |
| "I'll concatenate the translated pieces" | Word order and grammar break. One key = one full sentence or label. |
| "I don't know the Italian translation" | Add the key everywhere with the English value, then say which keys need review. |
| "The chart library needs a plain string" | Pass it `t(locale, key)` — the requirement is where the text comes from, not what type it is. |

## Red flags — stop and add the key

- A quoted string in `src/` that a human would read in a browser or a notification.
- Any non-English word in a `src/` literal.
- `+` joining a translated fragment to anything.
- A `key` built at runtime from variables (`"status." + s`) with no exhaustive map of the possible keys — the parity test can't see those.
- A new key in `en.json` and nowhere else.
- An English sentence typed straight into JSX, or a literal `aria-label` / `title` / `placeholder` string instead of a `t()` call. `test/ui/strings.test.ts` scans for this, but it's a heuristic (it strips comments and only flags multi-word text or a handful of known attributes) — the rule lives in this skill, not in whatever that test happens to catch.

## Checklist before finishing

- [ ] No user-facing literal left in the changed code.
- [ ] Key added to `en.json` **and** every sibling catalog in that layer.
- [ ] Key name describes meaning, is flat and dotted.
- [ ] Placeholders named; dates/numbers/plurals via `Intl.*`.
- [ ] Catalog parity test passes (see `core-engine-testing`).
- [ ] Keys you translated without confidence reported to the user.
