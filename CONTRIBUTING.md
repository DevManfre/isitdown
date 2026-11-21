# Contributing to IsItDown

Thanks for helping. This page is the short version: what to set up, what to
run, and the handful of rules a pull request is checked against. The long
version — architecture, every script, the release flow — is the developer
manual, [`docs/development.md`](docs/development.md); this page links into it
rather than repeating it.

## Before you start: remove before you add

IsItDown does one simple thing — tell you when a service you depend on is
down — and every option, channel and screen is something an operator has to
learn and someone has to maintain. So every issue and every pull request says
**what it simplifies or removes**, or states plainly that it adds complexity
and why that is worth it. This doesn't forbid features; it makes each one a
deliberate choice. The pull request template has a section for it.

The numbers behind that rule are in the complexity inventory,
[9.8](docs/development.md#98-complexity-inventory).

## Setup

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/DevManfre/isitdown?ref=dev)

The quickest way is the dev container: open a Codespace (badge above) or
*Reopen in Container* in VS Code, and Node, the browser for the visual tests,
the dependencies, the git hooks and a fake status page are all ready.

By hand:

```bash
git clone https://github.com/DevManfre/isitdown.git && cd isitdown
git switch dev              # work happens on dev; main only receives releases
nvm use                     # Node 26 — .nvmrc pins it, npm refuses anything older
npm ci
scripts/setup-hooks.sh      # pre-push visual check and the branch guards
```

Then `npm run dev:ui` and open `http://localhost:5173`, or
`npm run fake-provider` for a status page you can break by hand. Both modes are
described in [9.3](docs/development.md#93-live-development).

**Pull requests target `dev`**, never `main`. `main` only moves when a release
is cut.

## Adding a provider or a notification channel

Most status pages run on Atlassian Statuspage: if
`<domain>/api/v2/summary.json` returns data, no code is needed — add the
provider to `config.yml` or from the dashboard. Otherwise, start from the
generator so the adapter, its test, its fixture folder, its registry entry and
its documentation section are laid out the same way as every other one:

```bash
npm run new:adapter -- acme-status
npm run new:notifier -- acme-chat
```

Tests never hit a live provider: an adapter is tested against fixture JSON
under `test/fixtures/<provider>/` (`npm run record-fixture` captures one).

## Before you push

```bash
npm run typecheck
npm test                    # unit tests: node:test for the server, Vitest for the dashboard
npm run test:integration    # end to end, against the fake provider and a webhook receiver
npm run lint
```

CI runs all of this under a coverage floor, plus the bundle budget and the
visual baselines — see [9.4](docs/development.md#94-tests-and-checks).

**A dashboard change moves pixels.** The `pre-push` hook rebuilds and compares
every view against `test/visual/baseline/` when your commits touch `src/ui`.
When a frame differs, look at it, and if the change is intended agree that one
view only:

```bash
npm run build:ui && npm run test:visual
node tools/visual-regression.mjs --only=settings --update
```

Never `--update` without `--only`, and put agreed baselines in their own
commit.

## Rules a pull request is checked against

- **Commit messages** read `<emoji> <TITLE> - <description>`: one
  [gitmoji](https://gitmoji.dev), the surface touched in capitals (`POLLER`,
  `DIFF ENGINE`, `UI`, `DOCKER`), then an imperative sentence, in English, with
  no trailing period — `🐛 POLLER - fix retry backoff resetting on every failure`.
  The changelog and the release notes are generated from these subjects.
- **No user-facing literal.** Every string a person reads — dashboard label,
  notification text, status name — is a key in a catalog under
  `src/ui/web/locales/`, written in English first.
- **Documentation moves with the code.** A change that adds a flag, route,
  environment variable, config key, script, adapter, notifier or view updates
  `README.md` or the relevant page under `docs/`, **and** its Italian twin
  (`README.it.md`, `docs/<page>.it.md`) in the same pull request, section for
  section. CI checks the structure of each pair.
- **The core stays edition-agnostic.** `src/core`, `src/adapters` and
  `src/notifiers` never import from `src/light` or `src/ui`.
- **Validate external input with `zod`** — provider JSON, config, API bodies.
- **Notifications only go through the diff engine.** Nothing sends a message
  from a route handler or the poller directly.
- **Secrets come from environment variables only** — never in code, config
  files or examples.
- **New dashboard screens are discussed before they are built** — open an issue
  with the idea first.

The full list, with the reasons, is [9.5](docs/development.md#95-conventions).

## Reporting a bug or asking for a provider

Use the issue templates — they ask for what is needed to reproduce it (edition,
version, the provider's status page URL). Never paste a bot token or a webhook
URL into an issue.

## Code of conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).

## Licence

By contributing you agree that your contribution is licensed under the
project's [licence](LICENSE).
