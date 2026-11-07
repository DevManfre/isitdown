[← README](../README.md)

## 8. Theming and localisation

### 8.1 Themes

UI edition. Three states: **light / dark / system**, cycled from the header — and
three variants chosen in **Settings → Appearance** (roadmap 4.18): **high
contrast**, **colour-blind safe** and **OLED black**.

- **A variant is a correction laid over a ground, not a fourth palette.** The
  document carries two attributes: `data-theme` (the ground, `light` or `dark`,
  which Tailwind's `dark:` and the globe read) and `data-variant` (what is different
  about it). `contrast` and `colorblind` sit on the light ground, `oled` on the dark
  one, and each block in `tokens.css` lists only the palette values it changes.
  - **High contrast** takes every text colour to WCAG AAA (7:1) on both grounds,
    makes the divider a real line and darkens the painted status fills with it.
  - **Colour-blind safe** replaces the red/green pair the status colours lean on
    with blue, amber, orange and deep purple (Okabe–Ito's hues, darkened to clear
    4.5:1 as text). Every status already carried a word and a shape, so this is the
    second line of defence, not the only one. A test refuses a palette where
    "operational" is not blue or "major outage" has no blue in it to tell it from
    green.
  - **OLED black** turns the ground fully off (`#000`) for an always-on wallboard.
  - The header button still cycles light, dark and system; pressed on a variant it
    goes back to light. `tokens.test.ts` holds each variant to its own contrast floor.
- **Instance identity** (roadmap 4.19). Settings → Appearance also takes an
  **accent colour**, an **instance name** and a **logo address**, for a dashboard on
  an office monitor. The accent writes `--color-accent`, `--status-accent`,
  `--primary-foreground` and `--primary-hover` on the document — the text on a
  button is whichever of two inks reads better on the colour picked — and never a
  status colour, which would make the dashboard lie. A hint says when the accent is
  under 3:1 against the page, and the high-contrast theme keeps its own accent. The
  name replaces the product's in the rail, on the wallboard and in the tab title;
  the logo (an `https` address, or a path on the same host — never `data:` or
  `javascript:`) replaces the mark beside it, and falls back to the product's own
  if it does not load. Each is empty by default and falls back on its own. The
  accent is stored in the browser as well, so the inline script paints it before
  React runs.

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

- **Lit chrome** (roadmap 7.6), pared back by the calm redesign: nothing animates
  ambiently any more, so the dot grid and the travelling beam are gone. What is
  left is tokens (`--gradient-primary`, `--gradient-hero-live`, `--shadow-glow`) —
  the incident page's band takes the severity bloom while the incident is open —
  and provider tiles whose border answers the pointer (`.tile-lit` in
  `motion.css`).

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

Shipping: `en`, `de`, `es`, `fr`, `it` and `pt` (roadmap 5.14). Locale resolution
is the stored preference, then `en`. The picker is **Settings → Appearance**, not
the header: six languages is past the point where a row of codes in the chrome is
a glance rather than clutter. Each one is listed under its own name — "Deutsch",
not "German" — since a reader who does not read the current language is looking
for the word their own language uses.

> The Italian catalog had a native review in roadmap 5.15; the four added in 5.14
> were written against the English source and have not.

### 8.3 Accessibility

The dashboard is one operator's console, and that operator may be using a
keyboard, a screen reader, a high-contrast setting, or all three (roadmap 5.13).
What is guaranteed, and checked:

- **Contrast.** Every status colour used as *text* clears WCAG AA (4.5:1) against
  both the page and the card, in both themes — and against the tint it is drawn
  over, and secondary copy against the chip fill. `src/ui/web/css/tokens.test.ts`
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
- **Keyboard shortcuts** (roadmap 4.17). GitHub's and Linear's grammar: `g` then a
  letter goes somewhere — `g o` Overview, `g p` Providers, `g c` Components, `g i`
  Incidents, `g h` History, `g d` Delivery log, `g s` Settings — and a bare key does one thing:
  `/` opens the palette, `p` polls now, `?` shows the map of all of them (also in
  the palette). They stay out of a text field, out of an open dialog and out of
  anything held with ⌘, Ctrl or Alt, and a `g` forgotten for 1.2 seconds is
  forgotten. One table in `lib/shortcuts.ts` drives both the matcher and the map,
  so a shortcut that works is a shortcut that is listed.
- **Filters that stay** (roadmap 4.16). The Incidents state, window and search, the
  History window, the Providers sort and all/issues toggle and the Delivery log
  state are carried by the address — a pasted link reopens the same view — and
  remembered per browser, so the rail's link lands where it was left. Precedence is
  the address, then what was remembered, then the default; a choice equal to the
  default is removed from both, so links stay short and a cleared filter does not
  come back.
- **Screen readers** (roadmap 4.20). `tools/visual-regression.mjs` runs axe-core
  (WCAG 2.0/2.1 A and AA, 2.2 AA) over every frame it captures — all views, both
  themes, both locales — and over the three theme variants, and fails on a
  violation; a waiver goes in `ACCEPTED` with its reason, in the diff. It found
  and fixed: status words under 4.5:1 on their own tint, secondary copy at 3.46:1
  on chips in dark, a destructive badge at 2.89:1, three charts with a name but no
  `role="img"`, a toast region whose label was ignored, and a link whose name left
  out the number printed on it. What the stream changes is now said aloud, too: one
  hidden polite region in the shell names the providers whose status moved since
  the last read (three named, the rest counted), the toast stack announces each new
  card alone, and a refused write is an alert.
- **Components** (roadmap 4.23). Every component of every provider in one table,
  worst first, at `#/components` — "is anything called API down?" without opening
  each provider. The text filter matches the component's name or its provider's
  (which is how "eu-west" is found: components carry no region of their own), and
  the status chips count what each state holds; both ride the address like 4.16's
  filters.
- **Incident mode** (roadmap 4.22). While a major outage is open — on a provider
  that is neither muted nor in a declared maintenance window — a band above the
  Overview's own layout carries the incident, how long it has been open, who else
  it is hitting, its latest updates with the operator's notes among them, the
  last day's annotations and an "Add a note" field. "Back to normal view" hides it
  for that incident only; the next one brings it back. When it resolves, a
  one-line strip says how long it lasted for ten minutes, with a link to the
  incident for the post-mortem.
- **Fleet order** (roadmap 4.24). "Arrange" on the Overview opens a dialog where
  providers and groups are dragged — or moved with the arrows beside each row —
  into the order the Overview's widgets and the wallboard list them in. The order
  is kept by the instance (`fleetOrder` and `groupOrder` in `/api/preferences`),
  so the office screen agrees with the laptop that arranged it; a provider added
  later goes at the end, and "Automatic order" forgets it.
- **Wallboard QR code** (roadmap 4.26). A QR code sits in the corner of the
  wallboard and opens the dashboard on a phone, at the page of the provider in
  the worst trouble — or the Overview when nothing is wrong. It follows the
  worst provider, not the page the rotation is on, because nobody scans a code
  that changes every fifteen seconds. It is black on white in every theme, since
  a camera reads contrast, and it encodes the address the wallboard was opened
  at: open the wallboard through the machine's network address rather than
  `localhost`, or the phone will be sent to itself.
- **Status pulse** (roadmap 4.27). When the stream brings a provider's status
  change, its tile, card or row gives off one ring — red for a worse status,
  green for a better one — for about two seconds, so a change does not pass unseen
  in a dense view. The first read after opening the tab is only a baseline and
  pulses nothing. With `prefers-reduced-motion` the ring does not travel: it stays
  still for the same two seconds. The screen-reader announcement (roadmap 4.20)
  says the same change in words.
- **Alert sound** (roadmap 4.28). Settings → Appearance can play a short tone when
  a provider gets worse while the tab is open — for a second monitor. It is off by
  default, with a volume (25, 50 or 100%) and the mildest severity that still
  sounds (Degraded, Partial outage or Major outage). The tone is synthesised, not
  a file, and falls in pitch with the severity; one tone per refresh, for the worst
  change in it, never one per provider. A recovery, and a provider that has only
  just started or stopped being measured, make no sound. The choice is kept in
  this browser, not on the instance, because a speaker belongs to the machine the
  tab is open on. Browsers keep a page silent until it has been clicked once; the
  **Play** button says so if that is why it stayed quiet.
- **Phone Overview** (roadmap 4.29). Below 768px the Overview opens on a list made
  for one hand: what needs a look first, as rows tall enough to hit, and the
  operational providers folded under a "Show all" button. Swipe a problem row
  left to mute it for 1 or 24 hours (an Undo bar waits six seconds); the row's
  ⋯ menu does the same with the four usual durations, for anyone who does not
  swipe. Pull the page down from the top and release to poll now — the header's
  "Poll now", within thumb reach. Status is always written next to its icon, and
  the mute is the same write Settings makes.
- **Empty, loading and error states, reviewed together** (roadmap 4.21). The
  visual harness also captures each view with nothing configured, with a quiet
  fleet that has no incident, history or message yet, and with the backend gone.
  The pass changed three of them: a window with no readings shows `—` rather than
  0.00% and names no best or worst provider, a stopped server says so rather than
  "Failed to fetch", and the empty Overview no longer offers a 90-day history of
  nothing.
- **The command palette.** `⌘K` (or `Ctrl+K`) on any screen — or the header's
  search button, which carries the shortcut on it so the second use is the
  keystroke — opens one search box over the console (roadmap 5.4): every view the rail lists, every enabled
  provider — searchable by the name on screen or the id it was configured with
  — plus **Poll now** and the theme. A provider opens the History view's
  drawer (a provider also has a page of its own, `#/providers/<id>`). It is mounted in the shell rather than in a view, so the keystroke
  answers everywhere, and it opens with its views and actions even when the
  status read has failed.
- **Narrow screens.** Two thresholds, because the tablet range is not a small
  desktop. **Below 768px** the rail is off the layout — the `Sidebar` primitive
  hides it there — so the four views an operator moves between become a tab bar
  fixed to the bottom of the screen; the page gutter drops from 32px to 16px;
  every dialog anchors to the bottom edge as a sheet instead of the middle of
  the screen; and menu items are 44px tall. **Below 1024px** — so on a tablet
  too, where the rail is back but the page is not yet wide — the header keeps
  one line: the title, a search icon button and the poll control, and the
  theme toggle is not shown (the theme is picked in Settings → Appearance, and
  on a phone also in the **More** sheet, which holds Settings, the delivery log
  and search); the hero is one column rather than copy beside the uptime
  arc; and the fleet rows, the history list and the delivery rows stay one card
  or one stacked row each instead of the desktop's shared columns. Those columns
  were what made a tablet drop text: five tracks in 464px left the headline
  overlapping the arc and the header title truncated to nothing.
- **Charts.** A run of coloured bars says nothing out loud, so the uptime bars,
  the component strip, the poll strip, the sparkline and the provider ring each
  carry a one-sentence summary ("Daily status over 90 days: 84 operational, 3
  with issues, 3 not measured"), in the active locale. A status dot is hidden
  from the accessibility tree wherever the status is written beside it, and
  carries the status in words wherever it is not.
- **Motion.** `prefers-reduced-motion: reduce` flattens every entry animation,
  hover travel and pulse in `motion.css`, and the views that animate in
  JavaScript check the same query.
