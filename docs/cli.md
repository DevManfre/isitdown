[← README](../README.md)

## 10. Terminal client

A third entrypoint beside Light and UI, for whoever keeps a terminal panel
open next to their logs instead of a browser tab (roadmap 17.7). Its `watch`
command is a **read-only client** of the UI edition's HTTP API — not a second dashboard and
not a second engine — so everything it shows also appears at
`http://localhost:3000`, and none of it can change anything on the instance
it points at.

```bash
node dist/cli/index.js watch --url http://localhost:3000
```

or, from source, built once with `npm run build:cli` (see
[9.1](development.md#91-repo-structure) for where `src/cli/` sits and why it
never imports `src/ui`).

### 10.1 `isitdown watch`

```
usage: isitdown watch [--url <url>] [--token <token>] [--interval <seconds>]
```

| Option | Default | Meaning |
|---|---|---|
| `--url` | `http://localhost:3000` | The UI edition instance to read. |
| `--token` | `$API_TOKEN` | A read-only API token ([6](api.md#6-http-api)). Never printed, never logged — pass it as `--token` only where the environment isn't shared with something that would leak it. |
| `--interval` | `30` | Seconds between polling fallback reads while the live stream is unavailable. |

The view is one screen, redrawn in place: the fleet — provider, status, since
when it has held that status, and the timestamp of the last sample — and,
below it, a trailing queue of the most recent status changes as they arrive.
There is no navigation, no chart, and no second screen; that is deliberate,
not an interim state (see the parent issue's scope note). `Ctrl+C` quits.

### 10.2 `isitdown discover`

```
usage: isitdown discover [path...] [--yaml | --json]
```

The second command (roadmap 2.3), and the one that needs no instance: it reads
a project's own files and proposes the catalog providers the project depends
on. Offline — it reads the bundled catalog and nothing else, fetches nothing
and writes nothing.

| File | What it reads |
|---|---|
| `package.json` | dependency names — `@aws-sdk/*` is AWS, `openai` is OpenAI |
| `docker-compose.yml`, `compose.yaml`, `Dockerfile` | image registries — a bare `postgres:16` is Docker Hub, `ghcr.io/…` is GitHub |
| `.env`, `.env.*` | URLs and host names in values |
| `*.tf` | provider sources and blocks — `hashicorp/aws`, `provider "azurerm"` |
| `requirements*.txt`, `pyproject.toml`, `Pipfile` | package names — `boto3`, `anthropic` |
| `go.mod` | module paths |
| `hosts` | host names |
| other `.yml`, `.json`, `.toml`, … | any URL |

A host matches a provider when its registrable domain is the status page's —
`api.sendgrid.com` and `status.sendgrid.com` are both `sendgrid.com` — so that
half grows with the catalog. A small table of hints in
`src/adapters/discover.ts` covers the providers whose dependencies do not share
a domain with their status page. A directory is walked to a depth of eight,
leaving out `node_modules`, `.git`, `vendor`, build output and virtualenvs;
`localhost`, `.internal`, `.local` and bare IP addresses are never proposed.

Each provider is printed with every line that pointed at it, then the hosts no
catalog entry matched — candidates to add by URL if they have a status page.
`--yaml` prints a `services:` block a Light edition `config.yml` accepts as it
is; `--json` the whole result.

### 10.3 `isitdown import`

```
usage: isitdown import <file> [--from <tool>] [--yaml | --json]
```

The third command (roadmap 2.4), and like `discover` it needs no instance:
it reads another monitoring tool's export and says what each monitor becomes
here, before anything is added. Offline — the bundled catalog is the only other
thing it reads.

| Tool | The file |
|---|---|
| `uptimekuma` | the backup — Settings → Backup → Export, the JSON with a `monitorList` |
| `gatus` | its `config.yaml` — the inverse of the Gatus export ([6](api.md#6-http-api), `/export/gatus.yaml`) |
| `statping` | the output of `statping export` |
| `statusgator` | a board's monitor list, as its API answers it: `curl -H "Authorization: Bearer $TOKEN" https://statusgator.com/api/v3/boards/<board>/monitors` |

`--from` names the tool; without it, the shape of the file says which. Each
monitor lands in one of four places:

- **Probes** — HTTP, keyword, TCP and DNS checks become `http`, `tcp` and `dns`
  providers, with their expected status, body text, cadence and group.
- **Status pages the catalog recognises** — a URL whose host is a catalog
  entry's status page becomes that provider, read by its own adapter rather than
  probed as a web page. A StatusGator service monitor the catalog does not know
  is listed, to be added by URL so detection names its adapter.
- **Heartbeats** — Uptime Kuma push monitors, Gatus external endpoints with a
  heartbeat interval and Statping check-ins are jobs that call in, and become
  `heartbeat` providers ([3.19](configuration.md#319-heartbeats--the-dead-mans-switch)).
- **Not imported** — ping, gRPC, databases, a method other than `GET` or `HEAD`,
  a DNS record type the probe cannot ask for — each with the reason.

What does not carry over is said per monitor rather than guessed at: a Gatus
condition with no equivalent, a regular expression on the body, and headers,
authentication or a request body — credentials never travel into a config.
`--yaml` prints a `services:` block a Light edition `config.yml` accepts as it
is, heartbeats left out with a comment, since the Light edition has no URL a
job could call; `--json` the whole result. The UI edition answers the same
question at `POST /config/import/neighbour`.

### 10.4 How `watch` stays live

The client opens `GET /events` — the same server-sent-events stream
`src/ui/routes/events.routes.ts` serves the dashboard — and re-reads
`GET /status` on every `cycle` frame, not only the ones that name a changed
provider: a cycle with nothing to report still moves the "last sample" column,
and a view that only redrew on a change would look stalled on every quiet
cycle, which is most of them. The stream itself never carries a provider's
data, only the fact that a cycle finished; `/status` is the read that can never
drift from it.

If the stream cannot be opened at all, or drops after it was, the client falls
back to polling `/status` on `--interval` while it keeps trying the stream in
the background — a dropped connection becomes slower updates, never a frozen
screen, and reconnecting is silent: nothing has to be restarted by hand.

### 10.5 `watch` errors

A server that is unreachable, a token the instance rejects (`401`/`403`), or a
response that isn't the JSON this client expects all show up as the panel's
own connection line — never as a stack trace that breaks the layout. A
rejected token is the one case that stops rather than retries: no amount of
waiting fixes a wrong credential.

### 10.6 What `watch` deliberately does not do

Every request this client makes is a `GET`. It has no code path that writes —
no polling trigger, no mute, no configuration change — so a token handed to it
only ever needs read access, and pointing it at an instance can never be
mistaken for administering one. Adding write access or another view is out
of scope for this page; each would be its own roadmap row. `discover` (10.2)
and `import` (10.3) are separate commands that read local files, not the
instance.
