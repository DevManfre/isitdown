# IsItDown — Home Assistant add-on

The UI edition, packaged as a Home Assistant add-on (roadmap 6.6). It runs the
same published image `docker compose` pulls; this folder only adds the script
that turns the add-on's options into the environment the server already reads.

## Installing it

Home Assistant discovers an add-on repository from the *root* of a Git
repository, and this one is a folder inside a project, so install it as a local
add-on:

1. Copy the `isitdown` folder into the `addons` share of your Home Assistant
   installation (`/addons/isitdown` — the Samba or SSH add-on both reach it).
2. **Settings → Add-ons → Add-on store → ⋮ → Check for updates**.
3. Open **IsItDown** under *Local add-ons*, and **Install**.

The install pulls `ghcr.io/devmanfre/isitdown:ui-latest` and layers one file on
top of it, so it takes about as long as a `docker pull`.

## Configuring it

Only credentials go in the add-on's configuration, one entry per variable a
channel asks for — `TELEGRAM_BOT_TOKEN`, `PUSHOVER_TOKEN`, and so on. Everything
else — which providers to watch, which channels to send through, quiet hours,
retention — is set in the dashboard, because the UI edition keeps its whole
configuration in SQLite rather than in a file.

A channel whose variable is unset stays disabled, and the dashboard's Settings
page names the variable each one is waiting for.

## Where the data is

In `/data`, the add-on's own persistent volume: `isitdown.db` holds the
providers, the channels, the history and the incidents. A Home Assistant backup
that includes this add-on includes that file, and the dashboard's **Settings →
Data → Backup** writes the same database as a download.

## Why a port and not ingress

Ingress serves an add-on under a generated path prefix. This dashboard is built
against an absolute one — its bundle and its API calls both start at `/` — so a
panel would open to a blank page. A published port is the honest option until
the dashboard can be served from a prefix.

The page has no login, in either arrangement. It is a single-operator dashboard;
publish it only on a network you trust.
