# Changelog

Every release of IsItDown, newest first, grouped by the surface each commit
touched. Generated from the commit log by `tools/changelog.mjs` — don't edit
it by hand; the release flow regenerates it.

## v2.47.0 — 2026-11-23

### COMPLEXITY

- 🔧 raise the env and config.yml ceilings for the heartbeat settings

### HEARTBEAT

- ✨ ping an external dead-man's switch after every poll cycle

### PROXY

- ✨ send every HTTP request through HTTP_PROXY, HTTPS_PROXY and NO_PROXY

### DEPS

- ⬆️ bump dashboard stack (#46)
- ⬆️ bump devDependencies (non-major) (#47)

### BUNDLE

- 🔨 raise the JS budget for Renovate's recharts and dashboard stack bumps

## v2.46.2 — 2026-11-22

### RELEASE

- 🔖 bump the version to 2.46.2

### ENVELOPE

- 📝 measure and publish what 10, 100 and 500 providers cost

### COMPLEXITY

- 🔨 warn in CI when a budgeted count grows past its ceiling

## v2.46.1 — 2026-11-21

### RELEASE

- 🔖 bump the version to 2.46.1

### CONTRIBUTING

- 📝 add contributor files, generated changelog and the remove-before-add rule

## v2.46.0 — 2026-11-20

### RELEASE

- 🔖 bump the version to 2.46.0

### VISUAL

- ✅ agree the wallboard frames with the deprecation notice

### DEPRECATIONS

- 🗑️ deprecate the SEA binary, five exports, wallboard and app install

### EGRESS

- 🔒️ refuse private targets in the UI edition behind an allowlist

## v2.45.1 — 2026-11-19

### RELEASE

- 🔖 bump the version to 2.45.1

### TOOLS

- 🔨 add the complexity inventory per subsystem

### CONFIG

- 📝 open config.example.yml and the docs with the base path

## v2.45.0 — 2026-11-18

### RELEASE

- 🔖 bump the version to 2.45.0

### HOOKS

- 🔨 refuse the visual pre-push check when node_modules is stale

### UI

- ⏪️ revert the three Overview bar fixes and their baselines
- 🐛 snap the uptime bars to whole pixels so every machine draws them alike
- 🐛 draw the uptime bars without antialiasing so frames match everywhere
- 🐛 give the Overview's uptime figure a fixed column
- 🐛 keep the provider tile busy while the fleet is still loading

### VISUAL

- ✅ agree the Overview and severities frames with whole-pixel bars
- ✅ agree the Overview frames with the fixed figure column
- ✅ agree the first component-catalog story frames

### CI

- 👷 publish job durations and quarantine unstable tests

### SCAFFOLD

- 🔨 add npm run new:adapter and new:notifier for contributors

### UI CATALOG

- ✨ add a component catalog with every component in every state

### DEPS

- ⬆️ bump actions/cache action to v6 (#37)

## v2.44.2 — 2026-11-17

### RELEASE

- 🔖 bump the version to 2.44.2

### VISUAL

- ✅ agree the Overview frames after the first Renovate lot

### DEPS

- ⬆️ bump devDependencies (non-major)

### BUNDLE BUDGET

- 🔧 raise JS ceiling to 783,000 for the first Renovate lot

### DEVCONTAINER

- 🔧 add a ready-to-use dev container for Codespaces

### RENOVATE

- ⬆️ write the lockfile with npm 11
- ⬆️ write the lockfile with npm 11
- 🔧 put the Monday schedule back
- 🔧 drop the Monday schedule for one run

### CATALOG

- 🍱 publish the signed provider catalog
- 🍱 regenerate the provider catalog (207 providers)

### DISPATCHER

- ♻️ move channel health into dispatchChannelHealth
- ♻️ move escalation into dispatchEscalation
- ♻️ move the send itself into dispatchSender
- ♻️ move the dispatcher's types into their own module

## v2.44.1 — 2026-11-16

### RELEASE

- 🔖 bump the version to 2.44.1

### CONFIG SOURCE

- ♻️ split dbConfigSource by table family

### STATE STORE

- ♻️ move the row schemas and SQL helpers into their own module

### DB

- ✅ drill a kill mid-write, a torn page and a full disk
- 🐛 roll back only a transaction SQLite left open
- 🗃️ check the database on open and stop the start on a torn page

### OPENAPI

- ✅ hold every response and refused body to the documented schema
- ♻️ split the document into one module per area
- 🐛 serve the YAML document without anchors

### API

- 🐛 send ack, mute and trust refusals in the shared error shape
- 🐛 answer a refused body with the parser's own 4xx, not 500

## v2.44.0 — 2026-11-15

### RELEASE

- 🔖 bump the version to 2.44.0

### NODE

- ⬆️ move to Node 26 LTS

### CORE

- 🐛 never send an IP literal as the TLS server name

### DEPS

- 🔧 add the Renovate config and the dependency and Node update policy

### TOOLING

- ✨ add an interactive fake provider with npm run fake-provider

### I18N

- ✨ report orphan and missing catalog keys with check:i18n

### VISUAL

- ✅ agree the History frames with the pinned axis ticks

### UI

- 🐛 pin the History trend chart's axis ticks to the days

## v2.43.1 — 2026-11-14

### RELEASE

- 🔖 bump the version to 2.43.1

### CORE

- ♻️ inject one Clock into the scheduler, poller and dispatcher

### DIFF ENGINE

- ✅ add a seeded property-based test over random reading sequences

## v2.43.0 — 2026-11-13

### RELEASE

- 🔖 bump the version to 2.43.0

### DOCS

- 📝 document the operator metric lane and its settings
- 📝 document incident summaries, the AI settings and the operator series API

### BUNDLE BUDGET

- 🔧 raise JS ceiling to 772,000 for roadmap 6.11
- 🔧 raise JS ceiling to 765,000 for roadmap 6.10

### UI

- ✨ draw the operator's metric under the incident timeline
- ✨ add Settings → AI implementation and the summary on an incident's page

### ADAPTERS

- ✨ add the Datadog Status Pages adapter and move DNSimple, Datadog and Gemfury to their new pages
- ✨ read the update text a provider posted on one Statuspage incident

### VISUAL

- ✅ agree the Settings launcher with the AI implementation tile

### OPERATOR SERIES

- 🗃️ store and read the operator's own metric for the timeline

### DOCKER

- 🔧 let the UI image opt into Claude Code with WITH_CLAUDE_CODE

### AI SUMMARY

- ✨ summarize an incident's updates with a model the operator chooses

### DEPENDENCIES

- ➕ add the official Anthropic SDK for incident summaries

## v2.42.0 — 2026-11-12

### RELEASE

- 🔖 bump the version to 2.42.0

### BUNDLE BUDGET

- 🔧 raise JS ceiling to 756,000 for roadmap 6.7-6.9

### DOCS

- 📝 document the forecast, report card and incident words (roadmap 6.7-6.9)

### INCIDENT WORDS

- ✨ count the words and components that keep breaking (roadmap 6.9)

### REPORT CARD

- ✨ grade each vendor per axis over a quarter (roadmap 6.8)

### RELIABILITY

- ✨ forecast the chance of an incident in the next 7 days (roadmap 6.7)

## v2.41.0 — 2026-11-11

### RELEASE

- 🔖 bump the version to 2.41.0

### ANALYTICS

- ✨ export SLA credit evidence and a printable monthly report (roadmap 6.5-6.6)

## v2.40.0 — 2026-11-10

### RELEASE

- 🔖 bump the version to 2.40.0

### CATALOG

- 🍱 publish the signed provider catalog
- 🍱 regenerate the provider catalog (206 providers)
- 🔧 commit the weekly catalog refresh as the maintainer instead of the bot

### BUNDLE BUDGET

- 🔧 raise JS ceiling to 751,000 for the incident page redesign

### INCIDENT PAGE

- ✨ redesign the incident detail around a verdict, one timeline and a quiet context column

### ANALYTICS

- ✨ roll old days up instead of deleting, compare year on year, price outages, export postmortems (roadmap 6.1-6.4)

## v2.39.0 — 2026-11-09

### TESTS

- 🐛 anchor the prune tests to the store's fixed clock instead of the wall clock

### RELEASE

- 🔖 bump the version to 2.39.0

### VISUAL

- ✅ agree the four Settings baselines for the installation health card

### BUNDLE BUDGET

- 🔧 raise JS ceiling to 745,000 for roadmap 5.15 and 5.16

### INSTALL HEALTH

- ✨ suggest forgotten providers and list what the installation still needs, in Settings (roadmap 5.15, 5.16)

## v2.38.0 — 2026-11-08

### RELEASE

- 🔖 bump the version to 2.38.0

### BUNDLE BUDGET

- 🔧 raise JS ceiling to 742,000 for roadmap 5.11 to 5.14

### REPLAY

- ✨ replay the saved readings to show why an alert was sent, from the delivery log (roadmap 5.12)

### DIAGNOSTICS

- ✨ explain why a provider shows its status, from the last reading to flap damping (roadmap 5.11)

### VISUAL

- ✅ agree the four Providers baselines for the star beside each provider name

### FAVORITES

- ✨ star a provider to list it first, keep it on every wallboard page and in the periodic report (roadmap 5.14)

### COMPONENTS

- ✨ silence a single component from its row with a bell button (roadmap 5.13)

## v2.37.0 — 2026-11-07

### RELEASE

- 🔖 bump the version to 2.37.0

### HISTORY

- 🚨 strip control characters by code point, not by a regex the linter refuses
- ✨ record every configuration write and restore a value from it (roadmap 5.7)

### README

- 📝 bring the README and manual up to date with the React dashboard, the calm redesign and the configuration safety net

### SETTINGS

- ✨ review an import as a diff, and add snapshots and change history to Data (roadmap 5.7-5.9)

### SERVICES

- ✨ add a Read now button to the provider form (roadmap 5.10)
- ✨ read an unsaved provider from the form before saving it (roadmap 5.10)

### CANARY

- 🐛 follow redirects instead of reading them as unreachable and drop Amplitude, no longer on Statuspage

### SNAPSHOTS

- ✨ save the configuration under a name and restore it later (roadmap 5.8)

### IMPORT

- ✨ preview a config.yml as a diff before applying it (roadmap 5.9)

## v2.36.0 — 2026-11-06

### RELEASE

- 🔖 bump the version to 2.36.0

### WIDGETS

- 💄 speak in sentence case and keep mono for figures

### MOTION

- 🎨 hold every entry to 8px and every hover to colour

### VISUAL

- ✅ agree the frames moved by the calm redesign's phase 5
- ✅ agree the frames moved by the calm redesign's phase 4
- ✅ agree the frames moved by the calm redesign's phase 3
- ✅ agree the Overview frames moved by the calm redesign's phase 2
- ✅ agree the frames moved by the calm redesign's phases 0 and 1

### SETTINGS

- 💄 list the categories, retire the reels, and filter the delivery log by a select

### HISTORY

- ✨ split eleven stacked sections into five tabs

### PROVIDERS

- 💄 read the fleet once, and calm Components and Incidents

### OVERVIEW

- ✨ answer one question and fold the rest away

### SHELL

- ♿️ give the poll button foreground text so it clears contrast on its accent tint
- 💄 fold the header into one line and calm the rail

### DASHBOARD

- 🎨 put motion and spacing on design tokens and retire the decorative effects

### SKILLS

- 📝 add the dashboard design direction and enforce it with a design guard hook

## v2.35.0 — 2026-11-05

### RELEASE

- 🔖 bump the version to 2.35.0

### DOCS

- 📝 document runbooks, tags, planned mutes, declared maintenance, bulk edit and duplicate

### BUNDLE BUDGET

- 🔧 raise JS ceiling to 731,000 for roadmap 5.1 to 5.6

### DASHBOARD

- ✨ add schedule, bulk edit and duplicate dialogs, tag filters and the runbook card

### API

- ✨ store the new provider fields and add a bulk PATCH /config/services

### CORE

- ✨ add runbooks, tags, planned mutes and operator-declared maintenance windows

## v2.34.0 — 2026-11-04

### BUNDLE

- 🔧 raise the CSS budget to 23.5 kB for the one-hand Overview's utility classes

### RELEASE

- 🔖 bump the version to 2.34.0

### MOBILE

- ✨ add one-hand Overview with problems first, swipe to mute and pull to poll (roadmap 4.29)

### WIDGETS

- 📝 document phone home-screen widgets with a Scriptable script and a KWGT recipe (roadmap 4.30)

## v2.33.0 — 2026-11-03

### RELEASE

- 🔖 bump the version to 2.33.0

### CATALOG

- 🍱 publish the signed provider catalog
- 🍱 regenerate the provider catalog (206 providers)

### README

- 📝 bring the badges, edition table and roadmap up to date in English and Italian

### VISUAL

- ✅ agree the wallboard frames moved by the QR code
- 🧪 blank the wallboard QR modules, whose port changes every run

### BUNDLE BUDGET

- 🔧 raise JS ceiling to 720,500 for roadmap 4.25 to 4.28

### I18N

- 🌐 add the wallboard QR and alert sound strings and document 4.26 to 4.28

### FEEDBACK

- ✨ pulse a tile when its status moves and add an optional alert sound

### WALLBOARD

- ✨ add a QR code that opens the provider in the worst trouble

### RENDER

- ✨ serve the fleet as a 1-bit PNG and SVG for e-ink frames and chats

## v2.32.0 — 2026-11-02

### RELEASE

- 🔖 bump the version to 2.32.0

### SKILLS

- 📝 delete the previous merged feature branches before opening a PR into dev

### CLAUDE

- 📝 stop counting the visual frames in the baseline rewrite warning

### BUNDLE BUDGET

- 🔧 raise JS ceiling to 709,500 for roadmap 4.21 to 4.24

### VISUAL

- ✅ agree the frames moved by roadmap 4.21 to 4.24
- ✅ capture empty, quiet and offline states and the Components view

### DASHBOARD

- ✨ add the Components view, incident mode band and fleet arrange dialog

### FLEET ORDER

- ✨ keep a manual provider and group order and serve /status in it

## v2.31.0 — 2026-11-01

### RELEASE

- 🔖 bump the version to 2.31.0

### TESTS

- 🐛 keep the colours of the identity rows test out of the .tsx so the palette scan passes

### ACCESSIBILITY

- ♿ run axe over every visual frame and fix what it found, announce status changes

### VISUAL

- ✅ agree the frames moved by the palette and accessibility fixes

### BUNDLE BUDGET

- 🔧 raise JS ceiling to 695,500 and CSS to 23,000 for roadmap 4.16 to 4.20

### DOCS

- 📝 describe the variants, identity, shortcuts, persisted filters and the axe pass in English and Italian

### SHORTCUTS

- ✨ add g-sequence navigation, / for search, p to poll and a ? map of the keys

### THEMES

- ✨ add high contrast, colour-blind and OLED variants plus a custom accent, name and logo

### VIEWS

- ✨ keep filters, windows and sorts in the address and remember them per browser

## v2.30.0 — 2026-10-31

### TESTS

- 🐛 stop the monthly report test failing on the last day of the month

### RELEASE

- 🔖 bump the version to 2.30.0

### VISUAL

- ✅ agree the four Incidents frames with the new timeline card

### DASHBOARD

- ✨ add incident Gantt, latency percentiles, five-way compare and text search in the palette

## v2.29.0 — 2026-10-30

### RELEASE

- 🔖 bump the version to 2.29.0

### VISUAL

- ✅ agree the four History frames moved down by the new zoom hint line

### HISTORY

- ✨ zoom the trend chart by dragging and carry the range in the address

### PROVIDERS

- ✨ virtualize the table past 100 rows with measured variable heights

## v2.28.0 — 2026-10-29

### RELEASE

- 🔖 bump the version to 2.28.0

### SETTINGS

- ✨ add undo toasts for deferred writes and a lost-connection banner with full refetch on return

## v2.27.0 — 2026-10-28

### RELEASE

- 🔖 bump the version to 2.27.0

### BUNDLE BUDGET

- 🔧 raise JS ceiling to 685,500 and CSS to 22,500 for the first-run wizard and tour

### VISUAL

- 🐛 mark the fixture installation as set up so the first-run wizard stays closed

### FIRST RUN

- ✨ add setup wizard and guided tour, start fresh installs with no providers

### COMMAND PALETTE

- ✨ add mute, diagnose, latest incident, marker, test notification and monthly export actions

## v2.26.0 — 2026-10-27

### RELEASE

- 🔖 bump the version to 2.26.0
- 👷 wait for CI's verify check on the tagged commit instead of re-running tests

### CATALOG

- 🍱 publish the signed provider catalog
- 🍱 regenerate the provider catalog (205 providers)

### RELEASE FLOW

- 📝 land dev on main through a pull request so its commits count
- 📝 cut the release to one dev CI run and a tree check after the merge

### WIDGET CATALOG

- ✨ preview each widget live in the add panel

### DOCS

- 📝 describe the sharded Vitest jobs in CI
- 📝 describe the parallel CI jobs and the release's wait on CI

### CI

- 👷 shard the Vitest suite across two runners and apply the floor to the merge
- 👷 split the verify job into four parallel jobs behind an aggregate check

### PREFERENCE SYNC

- ✅ wait for the theme attribute as well as the mode

### CANARY

- 🐛 ignore statuspage fields Statuspage-compatible hosts do not ship

### DOCKER

- ⚡️ compile the build stage on the build platform, not under emulation

### DATABASE

- ⚡️ run the schema upgrade and the default seed in one transaction each

## v2.25.0 — 2026-10-26

### RELEASE

- 🔖 bump the version to 2.25.0

### DOCS

- 📝 document linked figures, the away summary and the new widgets

### BUNDLE BUDGET

- 🔧 raise JS ceiling to 675,500 and CSS to 22,000 for roadmap 4.3 and 4.4

### STATUS DOT

- 💄 keep the dot from shrinking beside truncated text

### WIDGETS

- ✨ add a third round of twelve catalogue widgets

### DASHBOARD

- ✨ add the "while you were away" summary to the Overview
- ✨ make every widget number a link to its rows

### INCIDENTS

- 🐛 stop an untouched search box from resetting the pager

### PREFERENCES API

- ✨ store when the operator last saw the Overview

## v2.24.0 — 2026-10-24

### RELEASE

- 🔖 bump the version to 2.24.0

### DOCS

- 📝 document named dashboards and their routes

### BUNDLE BUDGET

- 🔧 raise JS ceiling to 645,500 for named dashboards

### DASHBOARD

- ✨ add named dashboards to the rail, header menu and command palette

### DASHBOARDS API

- ✨ add named dashboards with home, export, import and undo

## v2.23.0 — 2026-10-23

### RELEASE

- 🔖 bump the version to 2.23.0

### MOTION

- 🐛 zero reduced-motion delays only on the catalogue's entries

### VISUAL

- 🐛 wait for the web fonts before capturing a view
- ✅ agree the Overview frames with Customise and add the edit view

### DOCS

- 📝 document the Overview widget catalogue
- 📝 document customising the Overview and the dashboard routes

### BUNDLE BUDGET

- 🔧 raise JS ceiling to 635,500 for the widget catalogue
- 🔧 raise JS ceiling to 603,500 and CSS to 21,500 for roadmap 4.1
- 🔧 raise JS ceiling 583,500 roadmap 3.15-3.16

### DASHBOARD

- ✨ add twelve catalogue widgets to the composable Overview
- 🐛 take focus into edit mode only when Customise opened it
- ✨ make the Overview a composable widget layout with an animated edit mode

### TESTS

- ✅ cover the on-call rotation and routine test controls in Settings

### DELIVERY

- ✨ add the on-call rotation and the weekly routine delivery test

## v2.22.0 — 2026-10-22

### RELEASE

- 🔖 bump the version to 2.22.0

### DOCS

- 📝 document the five new delivery controls and their example config

### DELIVERY

- ✨ add shared-failure summary, update coalescing, known-outage quiet, 24h chart and periodic report

## v2.21.0 — 2026-10-21

### RELEASE

- 🔖 bump the version to 2.21.0

### LINT

- 🔧 add a check-only Biome baseline wired into CI

### SETTINGS

- ♻️ extract the engine section into its own component
- ♻️ extract the recently removed section into its own component
- ♻️ extract the services section into its own component
- ♻️ extract the notifications section into its own component
- ♻️ extract the delivery section into its own component
- ♻️ extract the data section into its own component
- ♻️ extract the appearance section into its own component

### CONFIG ROUTES

- ♻️ extract catalog and service routes, leaving settings in config.routes
- ♻️ extract channel, secret, routing and recipient routes into their own router factory
- ♻️ extract storage report and maintenance routes into their own router factory
- ♻️ extract web push routes into their own router factory
- ♻️ extract discover, neighbour import and config file import/export routes
- ♻️ extract backup and restore routes into their own router factory

### NOTIFIERS

- ♻️ import the shared request timeout instead of redeclaring it
- ♻️ share request timeout and not-ok failure tail in errors helper
- ✨ add seventeen channels and hold every channel to one contract

### DEPENDENCIES

- 🔧 move cobe to devDependencies and correct the runtime dependency claims

### HTTP

- 🔒️ cap response bodies and refuse link-local targets, with opt-in private-range blocking

### UI

- 🔒️ refuse cross-origin and rebound-host writes to the dashboard API
- 🔒️ bind dashboard to loopback by default
- 🔥 remove the channel list from the rail

### DISPATCHER

- 🐛 degrade a failed follow or trouble lookup instead of dropping the alert
- 🐛 keep a failed ref save from resending and record deliveries that reject

### BACKUP

- 🔒️ leave VAPID private key out of the snapshot

### CI

- 🔧 pin the Playwright release and cache its Chromium

### SQLITE

- 🐛 guard each pending-damping column and prune stale message refs

### VISUAL

- ✅ agree the rail without channels and the longer channel filter

### DOCS

- 📝 document the new channels and the notifier contract

### BRAND

- 🎨 add a 128x128 PNG of the app icon

### CANARY

- 🐛 skip fields that only exist during an open maintenance or incident

### INCIDENT TIMELINE

- 🐛 order entries by time and grey out the secondary observed ones

## v2.20.0 — 2026-10-20

### RELEASE

- 🔖 bump the version to 2.20.0

### CATALOG

- 🍱 publish the signed provider catalog
- 🍱 regenerate the provider catalog (205 providers)

### BUNDLE BUDGET

- 🔧 raise the JS ceiling to 573,500 for roadmap 3.4-3.7

### DOCS

- 📝 document broken-channel alerts, recipients, incident follow, and impact and owner

### NOTIFICATIONS

- ✨ add broken-channel alerts, recipients, incident follow, and impact and owner

## v2.19.0 — 2026-10-19

### RELEASE

- 🔖 bump the version to 2.19.0

### VISUAL

- ✅ agree the header's Ctrl K hint and the UTC delivery times

### UI

- ♿️ add loading, first-run and confirm states, name the fleet dots and enforce them with skills and hooks

### SETTINGS

- 🐛 put the maintenance and escalation lines back where they belong

### DOCS

- 📝 document the maintenance heads-up, ack and mute buttons, and escalation

### NOTIFICATIONS

- ✨ add the maintenance heads-up, ack and mute buttons, and escalation

## v2.18.0 — 2026-10-18

### RELEASE

- 🔖 bump the version to 2.18.0

### BUNDLE BUDGET

- 🔧 raise the JS ceiling to 563,500 for the sequence probe and the tcp checks

### UI

- ✨ add the sequence and tcp check fields to the service dialog, translate them and document both

### ADAPTERS

- ✨ add the sequence adapter and the tcp check option for TLS, SMTP, WebSocket and gRPC

## v2.17.0 — 2026-10-16

### RELEASE

- 🔖 bump the version to 2.17.0

### BUNDLE BUDGET

- 🔧 raise the JS ceiling to 553,500 for the new adapters

### ADAPTERS

- 🔧 register the new adapters, detect Sorry and cState, add the dashboard fields and document them
- ✨ add OpenStatus, Sorry and cState adapters and pin incident.io to the Statuspage reader
- 🔧 register the new adapters, offer them in the dashboard and document them
- ✨ add GitHub Actions workflow and package registry adapters
- ✨ add Upptime and Status.io status page adapters

### REGISTRY

- ✨ cover crates.io and the jsDelivr, cdnjs and unpkg CDNs and flag a newer major than the pinned one

### FEDERATION

- ✨ add the isitdown adapter that reads another instance's /status

## v2.16.0 — 2026-10-15

### RELEASE

- 🔖 bump the version to 2.16.0

### BUNDLE

- 🔨 raise the JS ceiling for roadmap 2.9 and 2.10's dashboard

### DEPENDENCIES

- ✨ add the dependsOn field, shared-failure card and break-together suggestions to the dashboard

### COINCIDENCE

- ✨ list provider pairs whose incidents overlap more than chance

### CANARY

- 🐛 add lean fixtures so optional fields stop reading as drift

## v2.15.0 — 2026-10-14

### RELEASE

- 🔖 bump the version to 2.15.0

### DEPENDENCIES

- ✨ name the declared upstream in a shared-failure alert

## v2.14.0 — 2026-10-13

### RELEASE

- 🔖 bump the version to 2.14.0

### CATALOG

- 🍱 publish the signed provider catalog
- 🍱 regenerate the provider catalog (203 providers)
- 👷 push over a deploy key so the publish to main gets past its ruleset
- 🍱 regenerate the provider catalog (203 providers)

### HYPERSCALERS

- ✨ narrow AWS, GCP and Azure to your regions and services

### DNS

- ✨ warn on domain expiry and broken DNSSEC

### PROBES

- ✨ add icmp and docker adapters for homelab boxes

## v2.13.0 — 2026-10-12

### RELEASE

- 🔖 bump the version to 2.13.0

### IMPORT

- ✨ read a fleet from Uptime Kuma, Gatus, Statping or StatusGator

### HEARTBEAT

- ✨ add a dead-man's switch for jobs that stop calling

## v2.12.0 — 2026-10-11

### RELEASE

- 🔖 bump the version to 2.12.0

### DISCOVER

- ✅ track the fixture's .env, which the ignore rule left out

### BUNDLE

- 🔨 raise the JS ceiling for roadmap 2.2's catalog updates row

### CATALOG

- ✨ generate a signed provider catalog, update it in place and discover dependencies

## v2.11.0 — 2026-10-10

### RELEASE

- 🔖 bump the version to 2.11.0

### BUNDLE

- 🔨 raise the JS ceiling for roadmap 1.10 to 1.12

### DETECTION

- ✨ flag slow status pages, edited incidents and changed prose pages

## v2.10.0 — 2026-10-09

### RELEASE

- 🔖 bump the version to 2.10.0

### CANARY

- ✨ read the catalog nightly against the committed fixtures

### BUNDLE

- 🔨 raise the JS ceiling for the suspect reading badge

### STATUS

- ✨ flag a reading that has stopped looking alive

## v2.9.0 — 2026-10-08

### RELEASE

- 🔖 bump the version to 2.9.0

### OUTPOST

- ✨ ask a second point of view before trusting a probe

### PROBES

- ✨ poll a probe on a cadence in seconds

## v2.8.0 — 2026-10-07

### RELEASE

- 🔖 bump the version to 2.8.0

### BUNDLE

- 🔨 raise the JS ceiling for source credentials
- 🔨 raise the JS ceiling for the IMAP adapter
- 🔨 raise the JS ceiling for the suspected status

### AUTH

- ✨ send credentials to private status sources

### IMAP

- ✨ read a vendor's notices from a mailbox

### STATUS

- ✨ show a suspected status beside the declared one

## v2.7.0 — 2026-10-06

### RELEASE

- 🔖 bump the version to 2.7.0

### VISUAL

- ✅ agree the Overview frames after the plural agreement fix

### PUSH

- ✨ help the operator subscribe a provider's webhook from its page

### HISTORY

- ✨ measure how long after a provider declares an incident it is detected

### GIT

- 🙈 ignore the local roadmap.md brainstorming file

### DEVELOPMENT

- 📝 document the sandbox font-fallback gap in test:visual

### I18N

- 🐛 agree verb and adjective with count in status plural texts

### ROADMAP

- 🔥 remove the roadmap files and the links to them

## v2.6.0 — 2026-09-29

### RELEASE

- 🔖 bump the version to 2.6.0

### UI

- ✨ add opt-in GHCR update check with a Settings badge
- ✨ export the fleet as a Gatus config.yaml (roadmap 17.4)

### ROADMAP

- 📝 mark 17.4 shipped, Gatus export only

### CLI

- ✨ add isitdown watch, a read-only terminal client for the fleet

## v2.5.0 — 2026-09-21

### RELEASE

- 🔖 bump the version to 2.5.0

### VISUAL

- ✅ agree the History frames as UTC renders
- 🐛 render the baselines in a fixed time zone
- ✅ agree the authority beside each provider's adapter
- ✅ agree the History view's new sections

### ROADMAP

- 🔥 drop the Italian twin of roadmap 2
- 📝 mark what shipped out of roadmap 2

### UI

- ✨ put the problems first, and let a big fleet pack tighter
- 🐛 let the connection test answer where the operator is looking
- 🐛 keep the service dialog body scrollable

### NOTIFICATIONS

- ✨ show what every channel would actually say

### ADAPTER

- ✨ read any JSON status page from a declared mapping

### IDENTITY

- ✨ let every provider say which source is the record

### HISTORY

- ✨ rank suppliers by MTTR and MTBF, and show when they break
- ✨ mark the operator's own changes on the timeline
- 📝 publish the definition of uptime, and assert it
- ✨ tell "nobody was watching" apart from "nothing was wrong"
- ✨ bucket days in the operator's zone, across DST
- ✨ mark every sample with the adapter revision that read it

### OVERVIEW

- ✅ cover the headline for a provider nobody could read

### HTTP PROBE

- 🐛 name every request, and read a bot challenge as unknown

## v2.4.0 — 2026-09-18

### RELEASE

- 🔖 bump the version to 2.4.0

### ROADMAP

- 📝 archive the finished roadmap under docs
- 📝 carry "this day last year" into section 12
- 📝 add a guided first-open tour row to the operator's day
- 📝 mark 3.18, 5.1, 5.14, 5.15 and 5.21 shipped

### TRUST

- ✨ add the provider trust card

### VISUAL

- ✅ agree the frames the header and the new locales moved

### DOCS

- 📝 document chatops, the public page and the language picker

### BUNDLE

- 🔨 raise the JS ceiling for the four new locale catalogs

### TESTING

- 🔧 raise the two deadlines that flaked under coverage

### I18N

- 🌐 add es, fr, de and pt, and review the Italian catalog

### UI

- 💄 move the language picker into Settings and centre the search

### PWA

- ✨ make the dashboard installable with an offline shell

### PUBLIC PAGE

- ✨ publish a read-only status page behind PUBLIC_PAGE

### CHATOPS

- ✨ take Telegram commands for status, history and mute

## v2.3.0 — 2026-09-17

### RELEASE

- 🔖 bump the version to 2.3.0

### VISUAL

- ✅ agree the Italian settings frame the reel-loop fix moved
- ✅ agree the four wallboard frames and the three the new channels moved
- ✅ agree the baselines the responsive hero moved
- ✅ agree the baselines the reel loop fix moved
- ✅ agree the baselines the new channels and the range picker moved

### CORE

- ✨ ship plugins, push, templates, per-channel locale, SLA, token, wallboard and traces

### ROADMAP

- 📝 read the product against its competitors and list what is missing
- 📝 add a second brainstorm with eighty new candidate rows
- 📝 mark the eleven rows that shipped

### UI

- 💄 make the console usable on a phone and a tablet
- 🐛 make every settings reel loop cleanly
- 💄 lay routing rules out as cards instead of a clipped table
- ✨ answer every settings write in one corner stack
- ✨ pick an arbitrary history range, and give every provider a page

### TESTS

- ✅ add a load and soak test for a fleet nobody has

### BUILD

- ✨ ship the Light edition as a single executable

### API

- ✨ describe every route in OpenAPI and expose the fleet to Home Assistant

### DIFF ENGINE

- ✨ report a shared failure once, and a page that hides an outage

### NOTIFIERS

- ✨ add Matrix, PagerDuty, Opsgenie and Apprise channels

## v2.2.0 — 2026-09-16

### RELEASE

- 🔖 bump the version to 2.2.0

### VISUAL

- ✅ agree the settings launcher's wider grid
- ✅ agree the baselines the merged UI moved

### UI

- 💄 let the settings launcher grid fill the page
- ✨ hold the filter counts to their widest tally
- ✨ give every shadcn control the same motion vocabulary
- ✨ open settings as a bento of categories
- ✨ rail the add wizard on a React Bits stepper, animate its height
- ✨ type the single-provider headline in
- ✨ reveal the theme switch through the Magic UI toggler
- 🐛 draw the hero arc on, keep the services card, sharpen the detail page
- ✨ light the console with hero bands, fleet cards and a beam

### TOOLING

- 🔧 raise the JS budget for motion's DOM renderer
- 🔧 add the shadcn and magic-ui MCP servers

### TESTS

- ✅ cover the settings reels and the band that paints them
- ✅ allow the theme toggler's own custom properties

## v2.1.0 — 2026-09-15

### RELEASE

- 🔖 bump the version to 2.1.0

### VISUAL

- ✅ agree the baselines the settings chrome moved
- ✅ agree the baselines the two new channels moved

### SETTINGS

- ✨ give the page a rail, a filter and one shape per control

### TESTS

- ✅ mutation-test the diff engine

### DEPLOY

- ✨ ship an Unraid template and a Home Assistant add-on

### UI

- ✨ open a command palette on ⌘K

### API

- ✨ write a month of uptime up as Markdown

### ADAPTERS

- ✨ probe a bare TCP port and a DNS name

### NOTIFIERS

- ✨ add the Pushover and Microsoft Teams channels

## v2.0.0 — 2026-09-14

### RELEASE

- 🔖 bump the version to 2.0.0

### TESTS

- 🐛 annotate the note-removal fetch stub so tsc can type it

### VISUAL

- ✅ agree the baselines the email channel moved

### DOCS

- 📝 split the manual into docs/, one file per section

### DEPLOY

- ✨ ship Kubernetes manifests and a Helm chart

### UI

- ✨ keep operator notes on an incident
- ✨ back up and restore the whole database from Settings
- ✨ show the probe's own reason in the diagnostics panel
- ✨ configure the probe from the add-provider dialog

### NOTIFIERS

- ✨ send status changes by email over SMTP

### ROUTING

- ✨ let a rule name one component of one provider

### ADAPTERS

- ✨ read Cachet, Uptime Kuma and Uptime.com status pages
- ✨ say why a probe is down, and warn before its certificate expires
- ✨ add the direct HTTP probe adapter

### ROADMAP

- 📝 mark 1.8 as shipped, and fold cert expiry out of 1.9
- 📝 record what the HTTP probe shipped as, and what it left
- 📝 mark 1.7 as shipped, Sorry™ folded into the HTML-scrape row
- 📝 close 1.7: two adapters shipped, the third answered by 1.6

### README

- 📝 document the probe's notes, its certificate check and the fleet-wide warning
- 📝 document the HTTP probe and the network it can reach

## v1.11.0 — 2026-09-12

### RELEASE

- 🔖 bump the version to 1.11.0

### ROADMAP

- 📝 drop the suggested next slice section
- 📝 re-plan the slice now that all five rows shipped

### VISUAL

- ✅ agree the segmented toolbars and the download menu
- ✅ agree the compare block moving into a card
- ✅ agree the History view gaining a compare card
- ✅ agree the Incidents view gaining a subscribe control

### UI

- 💄 one segmented tray for filters, one menu for take-aways
- 💄 give the compare block its own card between two rules
- 🩹 spell out both compare picker keys for the catalog guard
- ✨ overlay two providers' uptime on one pair of axes

### CI

- 👷 weigh the built dashboard against a size budget
- 👷 gate both suites on a coverage floor

### FEEDS

- ✨ serve the incident search as RSS and iCalendar

### LOGGER

- ✨ append the log to a rotating file when LOG_FILE is set

## v1.10.0 — 2026-09-11

### RELEASE

- 🔖 bump the version to 1.10.0

### UI

- 🩹 drop the duplicated calendar types
- ✨ split readiness from liveness
- ✨ check and compact the database on demand
- ✨ draw a year of day cells per provider

### VISUAL

- ✅ agree the notifier list gaining ntfy and Gotify

### DOCS

- 📝 document the six rows of the slice, in both languages

### METRICS

- ✨ ship a Grafana dashboard for the scrape surface

### CI

- 👷 gate the README translations on parity

### NOTIFIERS

- ✨ add the ntfy and Gotify channels

### ROADMAP

- 📝 plan the next slice out of the rows that need no decision

## v1.9.0 — 2026-09-10

### RELEASE

- 🔖 bump the version to 1.9.0

### VISUAL

- ✅ agree the dark status palette and the new export controls
- ✅ agree the incidents views search controls

### ROADMAP

- 📝 re-plan the slice now that every undecided row is spent
- 📝 drop the shipped rows from the next slice
- 📝 mark the shipped rows and re-plan the next slice

### DOCS

- 🎨 restore the section and key order the split commits shuffled
- 📝 document the detect route and the incident search

### GROUPS

- ✨ answer "is my deploy path healthy", not just "is GitHub healthy"

### CONFIG FILE

- 🐛 import the type and the hook the backup row uses
- ✨ export the configuration as a config.yml, and read it back

### A11Y

- ♿️ label the drawer's status dot, which carries the status alone
- ♿️ fix the dark status palette, name the charts, ring the focus

### CATALOG

- ✨ open the add dialog on a menu of known providers

### EXPORT

- ✨ serve the incident search and the uptime history as CSV or JSON

### LIGHT CHECK

- ✨ validate a config.yml without starting a poller

### INTEGRATION

- ✅ wait for the first poll cycle instead of sleeping through it

### SKILLS

- 🔨 keep the translated READMEs in sync with the English one

### SLACK

- 🐛 refuse a current payload with no incident list

### ADAPTERS

- ✅ fuzz every adapter with malformed payloads
- ✨ detect which adapter reads a pasted status page

### UI

- ✨ search the incident list by name, in a time window

## v1.8.0 — 2026-09-09

### RELEASE

- 🔖 bump the version to 1.8.0

### DOCS

- 📝 document how the visual baselines are agreed
- 📝 document the delivery policy and mark the slice shipped

### HOOKS

- 🔨 run the visual regression before pushing a dashboard change

### VISUAL

- ✅ agree the three views that drew a provider favicon
- 🐛 keep other people's favicons out of the baselines
- ✅ agree the settings baselines with the diagnose button

### CLAUDE

- 🔧 wire the graphify knowledge graph into the assistant workflow

### GITIGNORE

- 🙈 ignore the graphify output directory

### DASHBOARD

- 🐛 stop the chrome painting a state the server never sent
- ✨ add the delivery settings and the adapter diagnostics dialog

### UI EDITION

- ✨ store the delivery policy and serve adapter diagnostics

### NOTIFIERS

- ✨ edit one message per incident where the channel can

### DELIVERY

- ✨ add quiet hours, digest mode and an hourly cap per provider

### POLLER

- ✨ stagger the fleet by provider id and honour Retry-After

## v1.7.0 — 2026-09-08

### SCHEDULER

- ✅ freeze the clock the countdown deadline is read from

### RELEASE

- 🔖 bump the version to 1.7.0

### ROADMAP

- 📝 add sixteen future rows and choose the next slice
- 📝 record the slice as shipped and name what comes next

### VISUAL

- 🐛 freeze the server's clock too, not only the browser's
- 🐛 compare frames downscaled, so a baseline survives another machine
- 🐛 capture the page once it is ready, not after a fixed wait
- ✅ screenshot every view in both themes and locales

### GEO CARD

- ✅ assert the sentence, not a digit that the calendar can collide with

### DOCS

- 📝 document the scrape adapter, damping, mutes, signing and the badges

### API

- ✨ serve status badges and a widget summary

### UI

- 💄 mute a provider, set the damping threshold, pick a time zone

### PREFERENCES

- ✨ render clock times in a chosen time zone

### WEBHOOK

- 🔒️ sign the payload with a shared secret

### DIFF ENGINE

- ✨ hold a flapping transition and honour a provider mute

### DB

- 🗃️ add schema 14 for mutes, damping state and the webhook secret

### ADAPTERS

- ✨ read a status page's markup with a CSS selector

## v1.6.0 — 2026-09-07

### RELEASE

- 🔖 bump the version to 1.6.0

### ROADMAP

- 📝 propose the next slice now that the last one is spent
- 📝 mark configurable retention shipped

### DOCS

- 📝 document notification retries, adaptive polling and the new adapters

### UI

- 💄 close the gap between delivery log rows
- ✨ reflect the worst status in the browser tab
- ✨ make history retention a setting with its storage cost

### ADAPTERS

- ✨ read Instatus and Better Stack status pages

### POLLER

- ✨ poll a provider in trouble on an adaptive cadence

### NOTIFICATIONS

- ✨ retry a failed send and surface dead letters

## v1.5.0 — 2026-09-07

### RELEASE

- 🔖 bump the version to 1.5.0

### UI

- ♻️ move the brand mark's colours into tokens.css
- 💄 use the brand mark for the favicon and the rail
- ✨ read the dashboard from the event stream instead of a timer
- ✨ make a provider removal undoable
- ✨ add the delivery log
- 🗃️ store a provider's own interval and its removal
- ✨ name what a provider removal deletes before it happens

### ROADMAP

- 📝 mark the fetch latency column shipped
- 📝 mark the live updates shipped
- 📝 refill the slice with the next seven candidates
- 📝 mark the slice shipped and name the next one
- 📝 mark the Slack adapter shipped
- 📝 record the state through v1.4.0 and name the next slice

### POLLER

- ✨ record how long each status page took to answer
- ✨ let a provider set its own poll interval

### README

- 📝 document the event stream and its proxy requirements
- 📝 document the hyperscaler adapters, intervals and undo

### I18N

- 🌐 add the live badge label
- 🌐 add the catalog keys for the delivery log and the new fields

### EVENTS

- ✨ push a finished cycle over server-sent events

### ADAPTERS

- ✨ add the AWS, Google Cloud and Azure adapters
- ♻️ extract the severity-from-wording heuristic

### HTTP

- ✨ read every provider through a conditional request

### SLACK

- ✨ add the Slack status adapter

## v1.4.0 — 2026-09-04

### RELEASE

- 🔖 bump the version to 1.4.0

### SETTINGS

- 🐛 apply the final pre-merge review fix wave

### I18N

- 🌐 pluralize routing rule count and drop the duplicated hot-note
- 🔥 drop five catalog keys orphaned by the settings sections restructure
- 🐛 restore dropped words in five garbled en.json settings strings
- 🌐 add the settings section keys and drop the unit from the polling labels

### UI

- ✨ apply the polling fields on blur instead of behind a Save button
- 💄 lay settings out as named sections instead of a bento grid
- ✨ put the routing editor behind a dialog
- ♻️ move the channel row and push devices out of the settings view
- ♻️ move RemoveServiceDialog out of the settings view
- ✨ add the SettingsSection primitive
- ✨ add the SettingRow primitive
- 🐛 align the routing editor with what the server actually delivers
- ✅ cover the zod-invalid stored routing rule row
- 🐛 fix routing rules table clipping instead of scrolling on narrow tiles
- ✨ add routing rules editor with dry run to settings
- ✨ store notification routing rules in SQLite

### DISPATCHER

- ♻️ hoist the enabled-channel-ids array out of the per-change loop
- 🐛 warn on an unknown routed channel even with none enabled
- ✨ route each change through the notification rules

### DOCS

- 🐛 fix the example routing block to name a service the example defines
- 📝 document notification routing and mark it shipped

### CORE

- ✅ guard the src/core module tsconfig.web.json bundles into the dashboard

### LIGHT

- 🐛 treat an explicitly empty routing list as absent
- ✨ configure notification routing from config.yml

### ROUTING

- ✅ add an end-to-end test for first-match channel routing
- ✅ close review gaps in the routing rules editor tests
- ✨ add explain to trace which rule wins a routing decision
- ✨ add the notification routing matcher

### API

- ✨ read and replace the notification routing rules

### CONFIG

- ✨ carry routing rules in the runtime configuration

### SKILLS

- 📝 add the release-flow skill covering dev to published release

## v1.3.0 — 2026-09-03

### RELEASE

- 🔖 bump the version to 1.3.0
- 🔖 bump the version to 1.2.0

### ROADMAP

- 📝 record dashboard-set channel credentials as shipped

### DOCS

- 📝 document saving channel credentials from the dashboard
- 📝 document the Discord and Slack channels
- 📝 document the metrics endpoint and mark the roadmap item shipped

### UI

- ✨ save a channel credential from the dashboard without a restart
- 💄 collapse the notification channels into a list of rows
- 🐛 bound the incident timeline's maintenance history
- 💄 collapse the incident action log behind a show-more control
- 💄 show running, upcoming maintenance on dashboard
- 💄 show running, upcoming maintenance on dashboard
- ✨ serve active, upcoming and past maintenance windows
- ✨ expose a Prometheus /metrics endpoint

### NOTIFIERS

- ✨ add the Discord and Slack channels
- ✅ sharpen maintenance message assertions and cover the no-end path
- 🌐 word the maintenance started and ended messages

### STATE STORE

- ♻️ derive the notification kind enum from StatusChangeKind
- 🐛 accept the maintenance notification kinds on read
- 🗃️ persist declared maintenance windows and their history

### ADAPTERS

- 🐛 normalise maintenance window timestamps to UTC
- 🐛 test scheduled maintenance against a real recorded window
- ✨ read scheduled maintenances from a statuspage summary

### DIFF ENGINE

- ✅ add a regression case for overlapping maintenance windows
- ✨ keep quiet inside a declared maintenance window

### INTEGRATION

- ✅ prove a maintenance window silences a provider end to end

### CORE

- 🐛 fail maintenance windows towards noise on malformed timestamps
- ✨ add the maintenance window model and isActive rule

## v1.2.0 — 2026-09-02

### RELEASE

- 🔖 bump the version to 1.2.0

### UI

- 🐛 bound the incident timeline's maintenance history
- 💄 collapse the incident action log behind a show-more control
- 💄 show running, upcoming maintenance on dashboard
- 💄 show running, upcoming maintenance on dashboard
- ✨ serve active, upcoming and past maintenance windows
- ✨ expose a Prometheus /metrics endpoint

### STATE STORE

- ♻️ derive the notification kind enum from StatusChangeKind
- 🐛 accept the maintenance notification kinds on read
- 🗃️ persist declared maintenance windows and their history

### ADAPTERS

- 🐛 normalise maintenance window timestamps to UTC
- 🐛 test scheduled maintenance against a real recorded window
- ✨ read scheduled maintenances from a statuspage summary

### DIFF ENGINE

- ✅ add a regression case for overlapping maintenance windows
- ✨ keep quiet inside a declared maintenance window

### INTEGRATION

- ✅ prove a maintenance window silences a provider end to end

### NOTIFIERS

- ✅ sharpen maintenance message assertions and cover the no-end path
- 🌐 word the maintenance started and ended messages

### CORE

- 🐛 fail maintenance windows towards noise on malformed timestamps
- ✨ add the maintenance window model and isActive rule

### DOCS

- 📝 document the metrics endpoint and mark the roadmap item shipped

## v1.1.0 — 2026-09-02

### RELEASE

- 🔖 bump the version to 1.1.0

### ADAPTERS

- 🐛 date the rss fetchStatus feed against the real clock
- ✨ add an RSS/Atom adapter for providers without a Statuspage API
- ✅ add a shared contract suite every adapter must pass

### README

- 📝 drop the title heading already shown in the banner
- 📝 add the project banner at the top of both readmes

### ROADMAP

- 📝 mark the shipped adapter kit, recorder and RSS items
- 📝 drop the completed phase 0 section

### UI

- ✨ derive a service id from its name instead of asking for it

### TOOLING

- 🔨 record provider fixtures with a script instead of by hand

## v1.0.0 — 2026-09-01

### RELEASE

- 🔖 bump the version to 1.0.0 for the first release
- 👷 publish signed multi-arch images to GHCR on a version tag

### DOCS

- 📝 document the no-clone quick start and the release flow
- 📝 describe the react dashboard in both readmes
- 📝 require every change to reach the running instance
- 📝 document 90-day history backfill in both READMEs
- 📝 add the project specification and the day-to-day working guide

### DOCKER

- 🔧 make docker-compose.yml usable without a clone
- 🐛 stop the dev image from passing itself off as production
- 🔧 add the builder and light stages with the compose profiles

### CI

- 👷 run typecheck, both test suites and a build on every push and PR

### TOOLING

- 🔨 generate release notes grouped by commit title
- 🔧 type-check vite.config.ts and drop the deprecated baseUrl
- 🔧 point the editor at the web tsconfig for src/ui/web
- 🚨 fail the typecheck on unused locals and parameters
- 🩹 name the actual exclude list file in the guard message
- 🔥 drop the merge filter from main, it lives on dev and in .git
- 🔨 install the merge filter into .git so main can drop it
- 🔧 add the git tooling paths to the merge exclude list
- 🔨 add the branch-aware merge wrapper and its git hooks
- 🔨 add the branch-aware merge wrapper and its git hooks

### STATE STORE

- 🐛 inject the clock the day and retention windows read
- 🐛 give every atomic write its own temporary file
- ✨ add the shared contract suite and the file-backed store

### ROADMAP

- 📝 add a blocking Phase 0 for making the project installable
- 📝 add a pruning list of possible future work

### UI

- 🐛 keep a disabled provider out of the dashboard's views
- 💄 flip the component picker's select-all CTAs to deselect, per group and overall
- 💄 cap the dialog height and scroll only its body
- 💄 collapse the notifications feed to two rows behind a show-more CTA
- 💄 rebuild the light palette on a neutral ground
- 💄 point the cursor at everything that can be clicked
- ✅ assert the geo card footnote also shows in globe view
- ♻️ share one severity draw order between the map and the globe
- ✨ put the geographic fleet card on the overview
- ✨ draw the located fleet on a rotating globe
- 🐛 pin dotted-world marker and ring colour assertions to the exact fill token
- ✨ draw the located fleet on a dotted world map
- 🐛 widen the base grid's region so no monitored location falls off the map
- 🔨 generate the dotted world grid at build time
- ✨ project and bin located components into grid cells
- ✨ read the located fleet through a map query
- 💫 start the number count on load, not on scroll into view
- ⚡️ draw the uptime strip without Recharts
- ✨ count every figure up with a number ticker
- 💫 fold an accordion panel shut instead of cutting it
- 🐛 keep the row FLIP out of the accordion's own motion
- 🔥 remove the rail's collapse toggle
- ✨ switch a provider off without deleting it
- ✨ scale the overview to the size of the fleet
- ♻️ rebuild the rail on shadcn's sidebar primitive
- ✨ expand a provider row into the components it monitors
- ✨ make the providers table sortable by every column
- 💫 add the FLIP offsets that let table rows close ranks
- 💄 give the theme button one glyph per mode
- 💄 re-derive the light palette so cards sit above the page
- 💄 hide the scrollbar on every surface
- 💫 animate provider rows out when the filter drops them
- 🐛 point the rail collapse chevron sideways again
- 💄 put the provider favicon back on a white disc
- 🐛 stop the uptime tooltip trailing the cursor
- 💄 realign the light palette with the prototype
- ✨ add the overview status beacon
- 🐛 stop the poll countdown sticking at zero
- 🐛 fix the dialog copy, the token colours and the collapsed rail
- 🔥 drop the vanilla dashboard
- ✨ port history and settings views
- 💄 match incidents panel entrance timing, harden filter and empty-state tests
- 🐛 restore the incident status row shape, harden its tests
- ✨ port the incidents list and incident detail
- 🐛 stop Rail's config read throwing the shell down too
- 🐛 stop chrome components throwing the shell down on status errors
- 🐛 fix stagger, host subtitle, filter and false-positive load errors
- ✨ port the overview and providers views to React
- ✨ rebuild the chart primitives on recharts
- ✨ build the console shell on shadcn
- 🐛 fix the /next React bundle referencing assets that 404
- ✨ wire the hash router, theme and provider tree
- ✨ move catalogs onto react-i18next
- 🐛 stop request() leaking a raw SyntaxError, fix incident cache key
- ✨ add typed api client query hooks
- ✨ add the shadcn component layer
- 🎨 rescope the motion layer onto radix and tailwind
- 🐛 fix the dark/system selector collision hiding a test blind spot
- 🎨 map nocturne palette onto shadcn theme contract
- 🐛 stop dev mode from hiding the vanilla dashboard behind /next
- 🔧 add the vite, react and tailwind toolchain
- 🐛 keep the animation gate on across a background repaint
- 🐛 fix the resolved incidents filter and rebuild it as a segmented control
- ✨ refresh the dashboard without flicker
- 💄 lighten light mode and paint charts with their own fill tokens
- 💄 scale the uptime ring to the full 0-100 range
- 🐛 harden backfill against config-load failures and fix vacuous test
- ✅ integration test for history backfill without notifications
- ✨ run history backfill at boot and on provider add
- ✨ add backfill service orchestrating history fetch
- ✨ derive synthetic samples from incident history
- ✨ show provider favicons inside the uptime rings
- 💄 match the dashboard's margins, colours and motion to the design prototype
- 🐛 never start an incident later than the poll that first saw it
- 🐛 stop the aggregate hiding a provider that is fully down
- 💄 add the settings view with env-referenced channel credentials
- 💄 add the history view with the uptime bars and month columns
- 💄 add the incidents list and the incident detail view
- 💄 add the providers table and the add-service modal
- 🚨 typecheck the dashboard JavaScript with checkJs
- 💄 add the dashboard shell with theme tokens, i18n and the router
- ✨ add the preferences and locale catalog endpoints
- ✨ add runtime configuration endpoints with env-name-only secrets
- ✨ add the history, incidents and notifications endpoints
- ✨ add the Express server with the health and status routes
- ✨ add the SQLite config source with env-name secret resolution
- ✅ cover the unknown-sample ranking rule in the bucket suite
- ✨ add server-side uptime and incident aggregation
- ✨ add the SQLite state store passing the shared contract suite
- 🗃️ add the SQLite schema, idempotent migration and default seed

### WEBPUSH

- ♻️ generate and store the VAPID pair instead of reading it from the environment
- ✨ add desktop push as a notification channel with device management

### HISTORY

- 🐛 compute the fleet delta over providers present in both windows
- 🐛 shorten the row delta and drop the drawer's duplicate window label
- 🐛 isolate a provider's own history query so its failure spares the view
- ✨ move each provider's detail into a drawer with an axis and a legend
- 💄 lead the view with a daily uptime trend and its delta
- ✨ aggregate the fleet's daily uptime and its previous window
- ✨ serve a per-day uptime series and a previous-window figure

### QUERIES

- 🔥 drop the push hooks a fix round swept in from an unrelated feature

### INCIDENT DETAIL

- 💄 move the page's blocks onto shared bento tiles
- 💄 lay the page out as a bento with a provider map tile

### SETTINGS

- ✨ show a channel's env-var name as a placeholder, not a value
- 💄 lay the page out as a bento grid of uniform tiles
- 🐛 read a stored map-view preference back into the control
- ✨ choose between the dotted map and the globe
- ✨ persist which geographic view the Overview draws

### MONTH COLUMNS

- 🐛 scale the bars to a domain where months actually differ

### INCIDENTS

- ✨ paginate the list server-side and move the filter onto it

### MOTION

- 💫 enter a view as one cascade once its data has landed

### IT LOCALE

- 📝 fix ungrammatical map-caption strings

### STATUS GLOBE

- 🐛 drive rendering with a real requestAnimationFrame loop
- 🐛 fix marker radius to match cobe's own sphere size

### MAP

- ♻️ review cleanup pass: dead filter, aria-label cap, docs
- ✅ fix a false floor-vs-round claim and add the test that pins it
- ✅ cover unlocated excluding a fully-located provider
- ✨ refresh located components on a lane of their own
- ✨ store latest-only snapshot of located components

### MAP LANE

- ✅ harden start() against overlap and cover it with fake timers

### GEO CARD

- ✨ surface the map snapshot's age as its staleness signal

### CHART CONFIG

- 🐛 stop worstStatus collapsing partial_outage into degraded

### API

- ✨ serve the located fleet on /map

### DB

- 🗃️ add map point and geo state tables at schema v4

### ADAPTERS

- ✨ carry component's status on list
- ✨ add the generic statuspage adapter with fixture tests

### GEO

- ✨ resolve component names to coordinates offline

### CLAUDE

- 📝 document react dashboard stack and shadcn CLI hazards

### TESTS

- ✅ retarget dashboard guards at react tree

### PROVIDERS

- 🔥 make the table read-only, editing lives in Settings
- 💫 animate the status filter pills on toggle
- 💄 align the table figures and outline the row actions

### DEV

- 🔨 serve the UI edition live from src without a rebuild

### COMPONENTS

- ✨ scope a provider to its selected components
- ✨ monitor individual provider components end to end

### GITIGNORE

- 🙈 ignore the .superpowers directory
- 🙈 ignore the design, superpowers and specs folders

### UI STORE

- ✨ add backfill write path and earliest-sample lookup

### ADAPTER

- ✨ fetch 90-day incident history from statuspage

### HEADER

- 💄 rework the top bar to match the design prototype
- 💄 split the meta line into pills with a live poll dot

### SKILLS

- 📝 forbid committing without an explicit user request
- ✨ add i18n-strings skill for English-first user-facing strings
- ✨ add commit style, code writing and testing discipline skills
- ✨ add StatusWatch workflow skills for adapters, notifiers, docker and core tests

### RAIL

- ✨ collapse the sidebar to a hover strip with a pinned toggle
- 💄 stretch the nav rows and give the counts a badge

### MODAL

- 💄 pair the dialog fields in two columns and animate the close

### PROJECT

- 🏷️ rename StatusWatch to IsItDown across the codebase

### README

- 📝 add status badges and an Italian translation
- 📝 restructure around running the service, and document verification
- 📝 document the UI edition endpoints, env vars and secret policy
- 📝 align the stack, Docker and structure sections with the build
- 📝 document the branch layout and the mergeclean policy
- 📝 spec dark mode toggle and multi-language support

### CORE

- ✅ enforce the shared-engine boundary with a test
- ♻️ build notifiers per cycle so channel changes need no restart
- ✨ add the notification dispatcher as the only caller of notifiers
- 🏗️ add the shared contracts, config schemas and logger

### LIGHT

- ✨ wire the edition entrypoint, healthcheck and end-to-end test

### SCHEDULER

- 🐛 keep the cycle timer referenced so the poller stays alive
- ✨ add the jittered cycle loop that reloads config every pass

### CONFIG

- ✨ add the YAML loader with env substitution and fatal validation

### POLLER

- ✨ add the polling cycle with retry, isolation and failure warnings

### NOTIFIERS

- ✨ add shared formatting with the telegram and webhook channels

### DIFF ENGINE

- ✨ add transition detection with the table-driven suite

### I18N

- 🌐 add the notification catalogs with the en source and fallback

### SCAFFOLD

- 🔧 add the TypeScript project, npm scripts and config templates

### Other

- Initial commit
