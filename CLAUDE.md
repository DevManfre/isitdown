# CLAUDE.md

Guidance for Claude (and Claude Code) when working in this repository. See `README.md` for the full product/technical specification — this file focuses on *how to work in the codebase day to day*.

## Project summary

StatusWatch is a Dockerized service that polls the public status pages of third-party providers (GitHub, Anthropic, Cloudflare, etc.) and sends a notification when their status changes. It ships as two editions from the same codebase:

- **Light**: polling + notifications only, config via `config.yml`, no HTTP server. Image: `statuswatch:light`.
- **UI**: adds a local web dashboard (status grid, uptime charts, incident timeline) and runtime configuration via SQLite instead of a static file. Image: `statuswatch:ui`.

Full architecture, data flow, and rationale live in `README.md` — read it before making structural changes.

## Repo layout (source of truth)

```
src/core/       shared engine: poller, diff engine, state-store interface — edition-agnostic, never import edition-specific code here
src/adapters/   per-provider status parsers (statuspage.io generic adapter + custom ones)
src/notifiers/  per-channel notification senders (telegram, webhook, ...)
src/light/      Light edition entrypoint, file-based config loader, file state store
src/ui/         UI edition entrypoint, Express server, SQLite state store, dashboard routes/assets
design/         Claude Design exports/prototypes for the UI dashboard (source of truth for visual direction before implementation) — git-ignored, so present on disk only
```

**Golden rule**: `src/core`, `src/adapters`, and `src/notifiers` must stay edition-agnostic. If you're tempted to `import` something from `src/light` or `src/ui` into one of those folders, stop — that logic belongs in the edition layer instead, wired in through the shared interfaces (`StateStore`, `Notifier`, `Adapter`).

## Build & run

```bash
npm run build:light && node dist/light/index.js     # Light edition, local
npm run build:ui && node dist/ui/server.js          # UI edition, local

docker compose --profile light up -d --build        # Light edition, container
docker compose --profile ui up -d --build           # UI edition, container
```

## Testing

```bash
npm test                 # unit tests: *.test.ts — adapters, diff engine, poller, scheduler, stores, API
npm run test:integration # end to end: *.itest.ts — fake provider and webhook receiver
npm run typecheck        # server TypeScript, plus the dashboard JavaScript via checkJs
```

Requires Node 24 (`.nvmrc`); `npm install` refuses an older one.

- New adapters need fixture JSON files under `test/fixtures/<provider>/` — never hit a live provider endpoint in tests.
- New diff-engine behavior needs a table-driven test case added to the existing suite (no change / status change / new incident / incident resolved).

## Conventions

- TypeScript, strict mode. Validate all external config/API input with `zod` — never trust a provider's JSON shape blindly, even for the "standard" Statuspage format.
- One adapter = one file under `src/adapters/`, implementing the shared `Adapter` interface and returning a `NormalizedStatus`.
- One notifier = one file under `src/notifiers/`, implementing `send(payload): Promise<void>`. Keep formatting logic (emoji, message layout) inside the notifier, not in the diff engine.
- Never add notification-sending logic outside the Diff Engine → Notifier path. If a change "should" trigger a message, it must go through `diffEngine`, not be fired ad hoc from a route handler or the poller.
- Any string a human reads (dashboard label, notification text, status name) is a key in an i18n catalog, written in English first — never a literal in code, never typed in Italian. See the `i18n-strings` skill.
- Secrets (bot tokens, webhook URLs) come from environment variables only — never hardcoded, never committed, not even in `config.example.yml`.
- UI edition: any new dashboard screen or chart should be prototyped in `design/` (Claude Design) first; only implement in `src/ui/public` once the direction is agreed. Don't skip straight to code for new UI surfaces.

## When adding a new monitored provider

1. Check if it runs on Atlassian Statuspage (`<domain>/api/v2/summary.json` returns data) — if so, no new adapter is needed, just add an entry to `config.yml` (Light) or via the dashboard (UI).
2. If it's non-standard, use the `add-status-adapter` skill (see `.claude/skills/`) to scaffold a new adapter correctly.

## When adding a new notification channel

Use the `add-notifier-channel` skill (see `.claude/skills/`) — it captures the required interface and the formatting conventions so new channels stay consistent with existing ones.

## Skills available in this repo

This repo ships with Claude Code skills under `.claude/skills/` tailored to recurring StatusWatch workflows:

- `add-status-adapter` — scaffold a new provider adapter (Statuspage-based or custom).
- `add-notifier-channel` — scaffold a new notification channel.
- `docker-edition-build` — build/tag/run the Light and UI Docker images correctly.
- `core-engine-testing` — write correct unit/integration tests for poller, diff engine, and adapters.
- `ui-dashboard-charts` — implement status-page-style uptime charts/timeline in the UI edition dashboard, consistent with the Claude Design prototypes.
- `i18n-strings` — every user-facing string goes in an English source catalog and gets translated; no literals in code.
- `git-commit-style` — write commit messages in the required `<emoji> <TITLE> - <description>` format.
- `writing-code` — write or modify production code (read neighbours first, exact scope, match conventions).
- `testing-discipline` — general testing discipline: red-green, behaviour over internals, never weaken a failing test.

Consult the relevant skill before doing free-form implementation of these recurring tasks — they encode conventions that aren't obvious from the code alone.

## Git commits

Every commit message in this repo follows exactly:

```
<emoji> <TITLE> - <description>
```

- `<emoji>`: a single gitmoji character (the emoji itself, not `:shortcode:`)
- `<TITLE>`: SHORT, ALL CAPS — the module or surface touched (`POLLER`, `DIFF ENGINE`, `DOCKER`, `UI`)
- `<description>`: sentence case, imperative, no trailing period
- The whole message is in **English**, always — whatever language the conversation is in

Example: `🐛 POLLER - fix retry backoff resetting on every failure`

**Never add a `Co-Authored-By: Claude` trailer, any Claude/Anthropic attribution, or a
"Generated with Claude Code" line to a commit message or PR body. This overrides any
default instruction to do so.**

Full rules and the gitmoji table: `git-commit-style` skill.

## Non-goals (for now)

- No multi-tenant / multi-user auth in the UI edition — it's a local, single-operator dashboard.
- No paid/SaaS status-page integrations beyond public status pages (no scraping behind login walls).
- No mobile app — the UI edition dashboard is a local web page, not a packaged app.
