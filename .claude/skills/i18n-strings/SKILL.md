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
| Dashboard / browser UI | `src/ui/public/locales/<lang>.json` | UI edition only, client-side |

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

```html
<!-- dashboard: mark the node, let i18n.js fill it -->
<button data-i18n="service.add.button"></button>
<h2 data-i18n="service.empty-state.title"></h2>
```

## Interpolation, plurals, formatting

- **Named placeholders only**: `{provider}`, `{count}`. Never build a sentence by concatenating translated fragments — word order differs per language.
- **Plurals**: one key per form (`incident.count.one` / `incident.count.other`) selected with `Intl.PluralRules`. Never `key + (n === 1 ? "" : "s")`.
- **Dates, numbers, percentages, relative times**: `Intl.DateTimeFormat` / `Intl.NumberFormat` / `Intl.RelativeTimeFormat` with the active locale. Notification timestamps stay UTC with an explicit `UTC` suffix in every locale.
- **Don't localize** provider names, URLs, or severity ids — only the human-readable severity label.

## Constraints that don't move

- `en` is the fallback: a missing key renders the English string, never an empty node and never the raw key.
- Catalogs are validated with `zod` at load, like every other external input.
- `src/core/i18n/` stays edition-agnostic — the Diff Engine keeps passing structured payloads and stays language-unaware; translation happens in the notifier. Never import `src/ui` or `src/light` from it.
- Adding a language = one JSON file per layer + a registry entry. If it needs a code change, the design is wrong.

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

## Checklist before finishing

- [ ] No user-facing literal left in the changed code.
- [ ] Key added to `en.json` **and** every sibling catalog in that layer.
- [ ] Key name describes meaning, is flat and dotted.
- [ ] Placeholders named; dates/numbers/plurals via `Intl.*`.
- [ ] Catalog parity test passes (see `core-engine-testing`).
- [ ] Keys you translated without confidence reported to the user.
