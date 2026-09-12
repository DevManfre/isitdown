[← README](../README.md)

## 8. Theming and localisation

### 8.1 Themes

UI edition. Three states: **light / dark / system**, cycled from the header.

- **Tokens, not per-component colours.** Every colour is a CSS custom property.
  `css/tokens.css` is the only file in the dashboard allowed to contain a colour
  literal, and a test enforces that. The light palette sits on bare `:root`, the dark
  one overrides it in `:root[data-theme="dark"]`, and the same overrides are mirrored
  under `prefers-color-scheme: dark` guarded by `:root:not([data-theme="light"])` so
  "system" works in both directions. All three blocks declare an identical token set,
  which a test also checks — a token defined in one theme only would render wrong.
- **Shadcn's components read the same tokens.** `tokens.css` also maps the semantic
  variables shadcn's primitives expect — `--background`, `--foreground`,
  `--primary`, `--border`, `--ring` and the rest — onto this palette, so a stock
  shadcn component needs no per-component override to fit the design system.
  Tailwind's `dark:` variant is rebound, via `@custom-variant`, from shadcn's
  default `.dark` class to this repo's own `[data-theme="dark"]` attribute, so the
  existing theme toggle — which sets an attribute, not a class — still drives it.
  None of this touches the pre-paint script below, which still only ever sets
  `data-theme`.
- **Charts read the same tokens**, so they never need a separate dark palette.
- **System is the default.** With no explicit choice, the theme follows the OS and
  reacts to it changing live, with no reload.
- **Persisted twice**: in `localStorage`, so the inline `<head>` script can apply it
  *before first paint* and avoid a flash of the wrong theme; and in the settings
  table, so a fresh browser against the same instance starts where you left off.
- **Palette**: Nocturne, from the Claude Design prototype. The light mode reads the
  same tonal ramps from the other end — no colour was invented, including the five
  severity colours, which have their own value per theme.

### 8.2 Localisation

Two layers, `en` as the source and the fallback in both:

| Layer | Files | Used by |
|---|---|---|
| Notification text | `src/core/i18n/<lang>.json` | both editions |
| Dashboard text | `src/ui/web/locales/<lang>.json` | UI edition |

`src/core/i18n/` is untouched by the dashboard's stack; the server still resolves
notification strings itself, in both editions, exactly as before. The dashboard
now resolves its own strings through `react-i18next`, configured with
`keySeparator: false` and single-brace interpolation (`{name}`, not the default
`{{name}}`) — the same flat `area.subject.variant` keys and placeholder syntax the
catalogs already used. Plurals use i18next's `_one`/`_other` key suffixes, not a
dotted pair. The catalogs are **bundled, not fetched**: `src/ui/web/lib/i18n.ts`
imports both JSON files directly, so they ship inside the JS bundle and
`GET /locales/:lang.json` no longer exists as a route.

Rules that are enforced by tests, not just documented:

- **No user-facing literal in code.** Every string is a flat dotted key; the value
  lives in a catalog. Logger output, thrown `Error` messages, adapter ids and route
  paths are developer-facing and stay plain English.
- **Every catalog has exactly `en`'s key set**, and every translated value carries
  the same named placeholders as its source. A string cannot ship half-translated.
- **Every key the dashboard asks for exists** — a typo would otherwise render as the
  key itself in the browser.
- **Never assemble a sentence from translated fragments.** Word order differs per
  language, so one key holds the whole sentence. Plurals are separate `_one`/`_other`
  keys, not composed at the call site.
- **Dates, numbers, percentages and durations** go through `Intl.*` in the active
  locale. Notification timestamps are the deliberate exception: always UTC with an
  explicit suffix, so an operator reading alerts in two languages never has to guess.
- The dashboard language and the notification language are **separate settings** — an
  English UI can send Italian alerts.
- Adding a **notification** language is one JSON file under `src/core/i18n/` — no
  code change. Adding a **dashboard** language is one JSON file under
  `src/ui/web/locales/` plus one import line in `src/ui/web/lib/i18n.ts`, since the
  catalogs are bundled rather than discovered from disk at runtime.

Shipping: `en` and `it`. Locale resolution is the stored preference, then `en`.

> The Italian strings were written alongside the implementation and have not had a
> native review.

### 8.3 Accessibility

The dashboard is one operator's console, and that operator may be using a
keyboard, a screen reader, a high-contrast setting, or all three (roadmap 5.13).
What is guaranteed, and checked:

- **Contrast.** Every status colour used as *text* clears WCAG AA (4.5:1) against
  both the page and the card, in both themes — `src/ui/web/css/tokens.test.ts`
  computes the ratios from `tokens.css`, so a palette tweak that breaks one
  fails the suite rather than shipping. The audit found two real defects in the
  dark theme: a partial outage and a major one were the same colour, and the
  status *label* read from the near-background grey the unsampled uptime bars
  want (1.3:1 — no text at all). Both are fixed; the bars keep their grey as a
  separate `-fill` token.
- **Keyboard.** Every dialog rides Radix's contract — focus moves in on open,
  Tab stays trapped, Escape closes, focus returns to the trigger — and the
  dialogs that accumulated (service add/edit, remove, diagnose, routing rules)
  each have a test that shows it rather than assuming it. Hand-written
  clickables (a provider row, a ring tile) get a visible focus ring from
  `base.css` at zero specificity, under whatever ring a primitive already has.
- **Charts.** A run of coloured bars says nothing out loud, so the uptime bars,
  the component strip, the poll strip, the sparkline and the provider ring each
  carry a one-sentence summary ("Daily status over 90 days: 84 operational, 3
  with issues, 3 not measured"), in the active locale. A status dot is hidden
  from the accessibility tree wherever the status is written beside it, and
  carries the status in words wherever it is not.
- **Motion.** `prefers-reduced-motion: reduce` flattens every entry animation,
  hover travel and pulse in `motion.css`, and the views that animate in
  JavaScript check the same query.
