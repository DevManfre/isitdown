---
name: ui-dashboard-charts
description: Implement or modify UI edition's dashboard — status grid, status-page-style uptime charts (daily uptime bars, 7/30/90-day views), incident timeline. Use whenever working on IsItDown UI edition's frontend/dashboard, adding a new chart or view, or wiring dashboard data to the SQLite-backed history API. Always check the Claude Design prototypes in design/ before implementing new UI.
---

# UI Dashboard & Charts

> `design/` is currently listed in `.gitignore`, so prototypes live on disk
> but are not committed. Read them there; do not assume a fresh clone has them.

Covers IsItDown's **UI edition** dashboard only — status grid, uptime charts,
incident timeline, settings panel. Not applicable to the Light edition, which
has no UI.

The dashboard is a React app under `src/ui/web/` (Vite, shadcn/ui, Recharts,
react-router 8, react-i18next, TanStack Query), built into `dist/ui/public`
and served by the Express server. For the shadcn CLI's specific hazards
(alias resolution, the `add index` trap, dependency placement), see the
`shadcn-components` skill — this skill covers the dashboard's own views and
data conventions, not the component-generation tooling.

## Before writing any dashboard code

Check `design/claude-design-prototypes/` for an existing mockup of the
screen/component you're about to build. Per `CLAUDE.md`, new UI surfaces are
prototyped in Claude Design before implementation — if no prototype exists
yet for what you're building, flag it to the user rather than inventing the
visual design yourself from scratch.

## Core dashboard views

1. **Status grid** (main/landing view): one card per monitored service —
   name, current `overallStatus` as color (green/yellow/orange/red),
   last-updated timestamp. Cards update via `useStatus()`, which polls
   `/status` every 30s (`REFRESH_MS` in `src/ui/web/hooks/queries.ts`) — no
   websockets in v1.

2. **Uptime chart** (per service, status-page style): horizontal row of daily
   bars (like Statuspage.io's own uptime history bar), one bar per day,
   colored by that day's worst incident severity (or green if fully
   operational). Support a 7/30/90-day toggle. Data source:
   `/history?provider=<id>&days=<n>`, aggregated server-side from the
   incident log in SQLite — don't compute daily aggregation client-side from
   raw incident rows.

3. **Incident timeline**: reverse-chronological list of past incidents per
   provider, each with start/end time, duration, severity — sourced from the
   same history table as the uptime chart, so the two views never disagree
   about incident boundaries.

4. **Settings panel**: CRUD monitored services (add/edit/remove, adapter
   type, base URL) and notification channels (enable/disable, credentials via
   env-var reference, not raw secret entry in the UI — see note below).
   Writes go through `/config` API routes, persisted to SQLite; changes take
   effect on the next poll cycle without requiring a container restart.

## Data & API conventions

- All chart/history data is served pre-aggregated by
  `src/ui/routes/history.routes.ts` — the frontend never re-derives daily
  uptime percentages from raw incident timestamps. Chart components consume
  the response as given; if a view needs a number the API doesn't return,
  the fix is a server-side aggregation change, not client math.
- `/status` is cheap and safe to poll frequently (reads current in-memory/DB
  state, never triggers a live fetch to providers) — that's what makes
  `useStatus()`'s 30s interval fine to leave running.
- Settings writes should validate against the same `zod` schemas used by the
  Light edition's config loader where the shape overlaps (service definition
  fields) — don't maintain two divergent validation logics for the same
  conceptual entity.

## Secrets in UI

The settings panel lets the user *reference* an environment variable name for
a notifier's credential (e.g. `TELEGRAM_BOT_TOKEN`), but must never accept a
raw secret value typed into a form field and store it in SQLite in plaintext.
If the user wants to change the token, that still happens via the container's
environment, not through the dashboard.

## Styling and components

There is a real frontend stack now — this is not plain HTML/CSS/JS. Two rules
carry over unchanged from the old dashboard and matter more, not less, with a
component library available to route around them:

- **Colours never appear as literals or as component-level CSS.** A chart or
  view reaches for a semantic token — through `src/ui/web/lib/chartConfig.ts`
  for chart series, through Tailwind utility classes backed by
  `css/tokens.css` for everything else — never a hex value or a hand-rolled
  class. `tokens.css` is the only file allowed to contain a colour literal; a
  test enforces it.
- **Follow the Claude Design prototypes' visual direction** (spacing, colour
  palette per severity state, typography) rather than defaulting to whatever
  a shadcn primitive or Recharts default looks like out of the box — the
  prototype is the source of truth, the library is the implementation detail.

Reuse a shadcn primitive under `src/ui/web/components/ui/` before writing a
new one; see the `shadcn-components` skill for how to add one correctly.
Entry animation on view change is gated by the React `key` on `#view` in
`App.tsx` (a changed view/locale/theme remounts it) plus the `anim-*` utility
classes in `css/motion.css` — don't introduce a second animation system
(e.g. framer-motion) alongside it.
