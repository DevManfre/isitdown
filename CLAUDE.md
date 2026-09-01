# CLAUDE.md

Guidance for Claude (and Claude Code) when working in this repository. See `README.md` for the full product/technical specification — this file focuses on *how to work in the codebase day to day*.

## Project summary

IsItDown is a Dockerized service that polls the public status pages of third-party providers (GitHub, Anthropic, Cloudflare, etc.) and sends a notification when their status changes. It ships as two editions from the same codebase:

- **Light**: polling + notifications only, config via `config.yml`, no HTTP server. Image: `ghcr.io/devmanfre/isitdown:light-latest`.
- **UI**: adds a local web dashboard (status grid, uptime charts, incident timeline) and runtime configuration via SQLite instead of a static file. Image: `ghcr.io/devmanfre/isitdown:ui-latest`.

Full architecture, data flow, and rationale live in `README.md` — read it before making structural changes.

## Repo layout (source of truth)

```
src/core/       shared engine: poller, diff engine, state-store interface — edition-agnostic, never import edition-specific code here
src/adapters/   per-provider status parsers (statuspage.io generic adapter + custom ones)
src/notifiers/  per-channel notification senders (telegram, webhook, ...)
src/light/      Light edition entrypoint, file-based config loader, file state store
src/ui/         UI edition entrypoint, Express server, SQLite state store, dashboard routes
src/ui/web/     React dashboard: Vite, shadcn/ui, Recharts — bundled into dist/ui/public
design/         Claude Design exports/prototypes for the UI dashboard (source of truth for visual direction before implementation) — git-ignored, so present on disk only
```

**Golden rule**: `src/core`, `src/adapters`, and `src/notifiers` must stay edition-agnostic. If you're tempted to `import` something from `src/light` or `src/ui` into one of those folders, stop — that logic belongs in the edition layer instead, wired in through the shared interfaces (`StateStore`, `Notifier`, `Adapter`).

## Build & run

```bash
npm run build:light && node dist/light/index.js     # Light edition, local
npm run build:ui && node dist/ui/server.js          # UI edition, local

docker compose --profile light up -d --build        # Light edition, container
docker compose --profile ui up -d --build           # UI edition, container

npm run dev:docker                                  # UI edition, container, rebuild-on-save
npm run dev:ui                                      # UI edition, local, HMR on :5173
```

`dev:docker` and `dev:ui` both run the UI edition straight from the source tree,
but they put the dashboard on different ports, and mixing them up is the
easiest way to stare at a stale page:

- `npm run dev:ui` (local) runs the Express server on **:3000** via Node 24's
  load-time type stripping (`node --watch` restarts it on a `.ts` change) *and*
  a Vite dev server on **:5173** with HMR, which proxies `/status`, `/config`,
  … back to :3000. The dashboard itself lives on **`http://localhost:5173`**
  — a CSS/JS/locale edit shows up there via HMR with no reload at all; :3000
  serves only the API plus whatever static bundle happens to be in
  `dist/ui/public`, which is not kept in sync.
- `npm run dev:docker` (container) has no Vite dev server: the `dev` build
  stage runs `vite build --watch`, which rewrites `dist/ui/public` on every
  save, and the same Express server serves that rebuilt bundle from
  **`http://localhost:3000`**. Reload 3000 after an edit; there is nothing on
  5173 in this mode.

Type stripping does *not* type-check — `npm run typecheck` and a real
`--build` before shipping still matter either way.

## Every change ships to the running instance

The dashboard is served out of `dist/ui/public` and the container mounts no
source directory, so an edit under `src/` changes nothing the operator can see
until it is rebuilt. A change is therefore not done when the file is saved —
it is done when the running instance shows it. Every time:

1. Find how it is running: `docker ps --filter name=isitdown`, otherwise a local
   `node dist/…` process. `docker inspect -f '{{.Config.Image}}' isitdown-ui`
   says which mode — `ghcr.io/devmanfre/isitdown:ui-latest` is a built image
   (`isitdown:ui` for one built before the GHCR rename), `isitdown:dev` is
   `dev:docker`'s override image (see Build & run). `docker inspect -f
   '{{.Config.Cmd}}' isitdown-ui` corroborates: `node dist/ui/server.js` for a
   built image, a `vite build --watch & … node --watch src/ui/server.ts` shell
   command for dev mode.
2. Redeploy that same way — container: `docker compose --profile ui up -d --build`;
   local: `npm run build:ui`, then restart the process. In dev mode there is
   nothing to redeploy: the edit is already live (HMR for `dev:ui`, rebuild-on-
   save for `dev:docker` — see Build & run for which port), so go straight to
   step 3.
3. Prove it is live before reporting, don't assume — and don't stop at
   fetching HTML: the entry script's filename is content-hashed on every
   build, so `index.html` can look perfect while the bundle it points at 404s
   and no JavaScript ever runs. Worse, a 200 on that asset only proves *some*
   bundle resolves — a stale redeploy (forgot `--build`, or an older image
   still running) serves yesterday's code with a perfectly valid 200. Climb
   three rungs, each proving something the one below it doesn't:

   ```bash
   # Rung 1 — existence: the hashed asset resolves at all
   ASSET=$(curl -s localhost:3000/ | grep -o '[^"]*assets/index-[A-Za-z0-9_-]*\.js')
   curl -s -o /dev/null -w '%{http_code}\n' "localhost:3000/${ASSET#./}"      # 200, not 404

   # Rung 2 — content: the bundle being served is *this* build, not a stale one
   curl -s "localhost:3000/${ASSET#./}" | grep -c 'the-string-you-just-added'  # >0

   # Rung 2, CSS — same idea for a style change: pick a token you just added or
   # changed, e.g. a colour variable
   CSS=$(curl -s localhost:3000/ | grep -o '[^"]*assets/index-[A-Za-z0-9_-]*\.css')
   curl -s "localhost:3000/${CSS#./}" | grep -c -- '--color-surface'           # >0
   ```

   Rung 1 proves an asset resolves. Rung 2 proves your specific edit is inside
   the bytes being served right now. Neither proves the app actually renders —
   a syntax error deep in a component tree still 200s and still contains the
   string. So climb a third rung: look at the rendered page, not its source.
   A headless browser is available with no setup: Playwright isn't a project
   dependency, but its Chromium build is already cached, so `npx --yes
   playwright@latest screenshot <url> <file>` renders a real page (the
   package can't be `import`ed from a script — use the CLI). Only this rung
   proves the app boots — the earlier two just prove the bytes are right.
   Confirm container health too: `docker compose ps` should say `healthy`.
4. Say what to reload — `http://localhost:3000` (or `:5173` in local dev
   mode), hard refresh (Ctrl+Shift+R) after a CSS/JS change.

**The general rule: for anything with rendered output, look at the page, not
at its HTML source.** Grepping served markup for a string proves delivery,
never that the app booted — this port hit that false positive on the "prove
it live" step itself before a real browser check caught it.

Holds for anything the operator can look at: CSS, dashboard JS/JSX, HTML,
locales, routes, notifier text. Never leave "now run the build yourself" as
the last step.

## Testing

```bash
npm test                 # unit tests: node:test (*.test.ts — adapters, diff engine, poller,
                          # scheduler, stores, API) and Vitest (*.test.tsx — dashboard
                          # components/hooks, since JSX needs a real transform)
npm run test:integration # end to end: *.itest.ts — fake provider and webhook receiver
npm run typecheck        # tsc -p tsconfig.json (server + core) and
                          # tsc -p tsconfig.web.json (dashboard React tree)
```

Requires Node 24 (`.nvmrc`); `npm install` refuses an older one.

- New adapters need fixture JSON files under `test/fixtures/<provider>/` — never hit a live provider endpoint in tests.
- New diff-engine behavior needs a table-driven test case added to the existing suite (no change / status change / new incident / incident resolved).

## Conventions

- TypeScript, strict mode. Validate all external config/API input with `zod` — never trust a provider's JSON shape blindly, even for the "standard" Statuspage format.
- One adapter = one file under `src/adapters/`, implementing the shared `Adapter` interface and returning a `NormalizedStatus`.
- One notifier = one file under `src/notifiers/`, implementing `send(payload): Promise<void>`. Keep formatting logic (emoji, message layout) inside the notifier, not in the diff engine.
- Never add notification-sending logic outside the Diff Engine → Notifier path. If a change "should" trigger a message, it must go through `diffEngine`, not be fired ad hoc from a route handler or the poller.
- Any string a human reads (dashboard label, notification text, status name) is a key in an i18n catalog, written in English first — never a literal in code, never typed in Italian. In the dashboard the key is resolved through `useTranslation()` (react-i18next); catalogs live in `src/ui/web/locales/`. See the `i18n-strings` skill.
- A shadcn primitive under `src/ui/web/components/ui/` exists for most dashboard surfaces (button, card, dialog, select, table, chart, …) — use it; don't hand-write a new component-level CSS class. See the `shadcn-components` skill before running the CLI.
- Chart colours are never a literal or a runtime-built token name — they come from `src/ui/web/lib/chartConfig.ts`, which resolves them to the semantic variables declared in `tokens.css`.
- Secrets (bot tokens, webhook URLs) come from environment variables only — never hardcoded, never committed, not even in `config.example.yml`.
- UI edition: any new dashboard screen or chart should be prototyped in `design/` (Claude Design) first; only implement in `src/ui/web` once the direction is agreed. Don't skip straight to code for new UI surfaces.

## When adding a new monitored provider

1. Check if it runs on Atlassian Statuspage (`<domain>/api/v2/summary.json` returns data) — if so, no new adapter is needed, just add an entry to `config.yml` (Light) or via the dashboard (UI).
2. If it's non-standard, use the `add-status-adapter` skill (see `.claude/skills/`) to scaffold a new adapter correctly.

## When adding a new notification channel

Use the `add-notifier-channel` skill (see `.claude/skills/`) — it captures the required interface and the formatting conventions so new channels stay consistent with existing ones.

## Skills available in this repo

This repo ships with Claude Code skills under `.claude/skills/` tailored to recurring IsItDown workflows:

- `add-status-adapter` — scaffold a new provider adapter (Statuspage-based or custom).
- `add-notifier-channel` — scaffold a new notification channel.
- `docker-edition-build` — build/tag/run the Light and UI Docker images correctly.
- `core-engine-testing` — write correct unit/integration tests for poller, diff engine, and adapters.
- `ui-dashboard-charts` — implement status-page-style uptime charts/timeline in the UI edition dashboard, consistent with the Claude Design prototypes.
- `shadcn-components` — add or modify a shadcn/ui primitive and wire it into the theme correctly.
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
