---
name: ui-dashboard-charts
description: Implement or modify the UI edition's dashboard — status grid, status-page-style uptime charts (daily uptime bars, 7/30/90-day views), and incident timeline. Use whenever working on the IsItDown UI edition's frontend/dashboard, adding a new chart or view, or wiring dashboard data to the SQLite-backed history API. Always check the Claude Design prototypes in design/ before implementing new UI.
---

# UI Dashboard & Charts

> `design/` is currently listed in `.gitignore`, so the prototypes live on disk
> but are not committed. Read them there; do not assume a fresh clone has them.

Covers the IsItDown **UI edition** dashboard only — status grid, uptime charts, incident timeline, settings panel. Not applicable to the Light edition, which has no UI.

## Before writing any dashboard code

Check `design/claude-design-prototypes/` for an existing mockup of the screen/component you're about to build. Per `CLAUDE.md`, new UI surfaces are prototyped in Claude Design before implementation — if no prototype exists yet for what you're building, flag that to the user rather than inventing the visual design yourself from scratch.

## Core dashboard views

1. **Status grid** (main/landing view): one card per monitored service — name, current `overallStatus` as a color (green/yellow/orange/red), last-updated timestamp. Cards should update via polling the `/status` endpoint (short interval, e.g. every 30–60s) — no need for websockets for v1.

2. **Uptime chart** (per service, status-page style): a horizontal row of daily bars (like Statuspage.io's own uptime history bar), one bar per day, colored by that day's worst incident severity (or green if fully operational). Support 7/30/90-day toggle. Data source: `/history?provider=<id>&days=<n>`, aggregated server-side from the incident log in SQLite — don't compute daily aggregation client-side from raw incident rows.

3. **Incident timeline**: reverse-chronological list of past incidents for a provider, each with start/end time, duration, and severity — sourced from the same history table as the uptime chart, so the two views never disagree about incident boundaries.

4. **Settings panel**: CRUD for monitored services (add/edit/remove, adapter type, base URL) and notification channels (enable/disable, credentials via env-var reference, not raw secret entry in the UI — see note below). Writes go through `/config` API routes, persisted to SQLite; changes should take effect on the next poll cycle without requiring a container restart.

## Data & API conventions

- All chart/history data is served pre-aggregated from `src/ui/routes/history.routes.ts` — the frontend should never need to re-derive daily uptime percentages from raw incident timestamps.
- `/status` is cheap and safe to poll frequently (reads current in-memory/DB state, doesn't trigger a live fetch to providers).
- Settings writes should validate with the same `zod` schemas used by the Light edition's config loader where the shape overlaps (service definition fields) — don't maintain two divergent validation logics for the same conceptual entity.

## Secrets in the UI

The Settings panel lets the user *reference* an environment variable name for a notifier's credential (e.g. `TELEGRAM_BOT_TOKEN`), but should never accept a raw secret value typed into a form field and store it in SQLite in plaintext. If the user wants to change a token, that still happens via the container's environment, not through the dashboard.

## Styling

No heavy frontend framework required — plain HTML/CSS/JS (or a minimal setup) is sufficient per the architecture doc. Follow whatever visual direction comes out of the Claude Design prototypes (spacing, color palette for severity states, typography) rather than defaulting to generic dashboard boilerplate styling.
