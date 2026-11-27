[← README](../README.md)

## 4. Docker

### 4.1 Images and build targets

One `Dockerfile`, four stages. `builder` compiles everything once; `light` and
`ui` are the two shipped runtime images; `dev` exists only for
[live development](development.md#93-live-development) and is never built by
`docker compose --profile ui up`.

```
builder  node:26-alpine   npm ci (incl. devDependencies), tsc, vite build, copy non-TS assets into dist
light    node:26-alpine   prod deps + dist/{core,adapters,notifiers,light,outpost}
                          VOLUME /app/config /app/data · no EXPOSE · no server
dev      FROM builder     keeps devDependencies · vite build --watch + node --watch · tagged isitdown:dev only
ui       FROM light       + dist/ui (dashboard and locales) · EXPOSE 3000
```

`builder` now also copies `tsconfig.web.json`, `vite.config.ts` and
`components.json` alongside the server tsconfigs, and `npm run build` runs `tsc`,
then Vite, then the asset copy — one `RUN` layer that both runtime stages below
it share. `light` and `ui` are otherwise unchanged: the `ui` stage still begins
`FROM light`, so the UI image is the Light image plus a single thin layer — base
image, production dependencies and the whole core engine are shared on disk and
in a registry.

`dev`, the third stage, is `FROM builder` rather than `FROM light` — live
development needs the devDependencies (Vite, React, the test tooling) that
`light`'s production `npm ci --omit=dev` deliberately drops, so it cannot run from
either shipped image. It is tagged `isitdown:dev`, never `isitdown:ui`, and only
`docker-compose.dev.yml` builds it; a target-less `docker build .` or
`docker compose --profile ui up` never touches it.

```bash
docker build --target light -t isitdown:light .
docker build --target ui    -t isitdown:ui    .
```

Measured: 12 of the UI image's 14 layers are byte-identical to the Light image.

Tag releases per edition rather than with a bare `latest`, which would not say
which edition it is. `.github/workflows/release.yml` pushes four tags per
release to GHCR, each a multi-arch manifest covering `linux/amd64` and
`linux/arm64`:

```
ghcr.io/devmanfre/isitdown:light-v1.0.0   ghcr.io/devmanfre/isitdown:light-latest
ghcr.io/devmanfre/isitdown:ui-v1.0.0      ghcr.io/devmanfre/isitdown:ui-latest
```

Every pushed image carries an SBOM and SLSA provenance, and is signed keylessly
with `cosign`, so what built it is verifiable rather than merely asserted:

```bash
cosign verify ghcr.io/devmanfre/isitdown:ui-latest \
  --certificate-identity-regexp '^https://github.com/DevManfre/isitdown/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

See [9.6](development.md#96-releasing) for how a release is cut.

### 4.2 Compose profiles

```bash
docker compose --profile light up -d           # mounts ./config.yml (ro) + a data volume
docker compose --profile ui    up -d           # data volume only, publishes :3000
docker compose --profile light --profile ui up -d      # both
docker compose --profile light --profile ui down       # stop; volumes survive
```

Both services declare a published `image:` and `pull_policy: missing`, so a
plain `up` pulls from GHCR and the file works with no source tree around it.
Adding `--build` builds the same target from this `Dockerfile` instead.

A third file, `docker-compose.dev.yml`, layers on top of the `ui` profile and runs
the edition straight from the source tree, rebuilding the dashboard bundle in the
background as files change rather than requiring a fresh image — see
[9.3](development.md#93-live-development).

### 4.3 Volumes, healthchecks, users

| | Light | UI |
|---|---|---|
| Mounts | `./config.yml:/app/config/config.yml:ro`, volume on `/app/data` | volume on `/app/data` |
| Ports | none | `127.0.0.1:3000:3000` |
| Healthcheck | age of `state.json` — every cycle rewrites it, three intervals without a write is unhealthy | `GET /ready` |
| Start period | 40s | 60s |
| User | `node`, unprivileged | `node`, unprivileged |

The `ui` service publishes `:3000` on the host's loopback only: the dashboard has no
login unless `API_TOKEN` is set, so by default only this machine can reach it. To
open it to the LAN, change the left side of the mapping in `docker-compose.yml` to
`0.0.0.0:3000` **and** set `API_TOKEN` (see
[`BIND_HOST` and `API_TOKEN`](configuration.md#312-reaching-the-api-from-another-host)).
Inside the container the server listens on `0.0.0.0` (`BIND_HOST`), since the
published port arrives on the container's own interface.

The Light edition has no server to probe, which is why its liveness signal is the
freshness of the state file rather than an HTTP response.

The UI edition's probe is **readiness**, not liveness. `GET /health` answers as
long as the process is up, which is all a liveness probe may ever mean — a
restart is not the answer to someone else's outage — and it left the one failure
an operator actually wants surfaced reported by nothing: an instance whose poll
cycle had been failing all day still looked healthy. `GET /ready` is that
reading, on the same three-intervals-of-slack rule as the Light edition's state
file, and it is what the container asks. Both are still there, so an
orchestrator that wants the two probes apart can have them (`livenessProbe` on
`/health`, `readinessProbe` on `/ready`). The longer start period is the cost:
readiness stays 503 until the history backfill and the first cycle are done.

Both containers stop cleanly on `SIGTERM`: the scheduler stops, the in-flight cycle
is awaited, the store is closed, exit 0.

---

### 4.4 Kubernetes

Both editions ship as manifests and as a Helm chart, under `deploy/`:

```bash
# Plain manifests, no Helm
kubectl apply -f deploy/k8s/ui.yaml
kubectl port-forward svc/isitdown-ui 3000:3000

# Or the chart, either edition
helm install isitdown deploy/helm/isitdown --set edition=ui
helm install isitdown-light deploy/helm/isitdown --set edition=light
```

One chart rather than two, because the two editions are one codebase and differ
in exactly three ways a chart cares about: the UI edition serves HTTP and so has
a Service and HTTP probes, the Light edition reads a `config.yml` and so has a
ConfigMap, and each has its own image tag. `edition` picks which, and an
unrecognised value fails the render rather than producing half a release.

Three properties are deliberate rather than defaults:

- **One replica, and `Recreate` rather than `RollingUpdate`.** Both editions own
  a file in the data volume — the UI edition's SQLite database, the Light
  edition's state file — so a second replica is a second poller writing the same
  file, and a rolling update would stall waiting for a `ReadWriteOnce` volume the
  outgoing pod still holds.
- **`livenessProbe` on `/health`, `readinessProbe` on `/ready`** (§4.3). A
  provider being unreachable must never restart the pod, and a pod whose cycles
  have been failing must not be sent traffic. The Light edition has no HTTP
  surface at all, so its liveness probe runs the same script the image's own
  `HEALTHCHECK` does.
- **The claim outlives the release.** The PVC carries
  `helm.sh/resource-policy: keep`: the history, the incidents and the credentials
  saved from the dashboard are not something a `helm uninstall` should take with
  it.

Credentials go in a Secret and reach the container as environment variables,
exactly as they do under Docker — `secrets:` in `values.yaml` for a quick start,
`existingSecret:` for a cluster where values end up in a repository. The Light
edition's `config.yml` is `config:` in `values.yaml`, rendered into a ConfigMap
and mounted read-only; `${VAR}` references in it resolve against that same Secret.
An edit to it rolls the pod, because a mounted ConfigMap changing on disk
restarts nothing on its own.

To keep credentials out of the pod's environment altogether, `secretFiles:`
mounts an existing Secret read-only at `/run/secrets/isitdown` and hands each key
over as `NAME_FILE` ([configuration §3.4](configuration.md#34-how-secrets-are-handled),
roadmap 9.4):

```yaml
secretFiles:
  secretName: isitdown-credentials
  keys:
    TELEGRAM_BOT_TOKEN: telegram-bot-token   # → TELEGRAM_BOT_TOKEN_FILE
```

### 4.5 Neither: the single-file Light edition

> **Deprecated in 2.46, not published from 3.0** ([Deprecations](deprecations.md)):
> run the Light container image instead. Until then the binary logs a warning
> at every start.

An operator who wants neither Docker nor a Node install can run the Light
edition as one executable — roadmap 6.7. Every release attaches it beside the
images, with a checksum:

```bash
gh release download vX.Y.Z --pattern 'isitdown-light-*-linux-x64*'
sha256sum -c isitdown-light-vX.Y.Z-linux-x64.sha256
chmod +x isitdown-light-vX.Y.Z-linux-x64
CONFIG_PATH=./config.yml DATA_PATH=./state.json ./isitdown-light-vX.Y.Z-linux-x64
```

It is the same edition, with the same `config.yml` and the same environment
variables — the two paths have no `/app` default to fall back on here, so both
are worth setting. Build one locally with `npm run build:sea`, which writes
`dist/sea/isitdown-light`.

Light only, deliberately: the UI edition serves a built dashboard out of
`dist/ui/public`, which is thousands of files a binary would have to carry and
an operator would have to be told about. The file is around 120MB, nearly all of
it Node itself — that is the shape of a Node single executable, not a sign
something went wrong — and the binary is built with the Node version in
`.nvmrc`. Linux x64 for now; macOS and Windows need a runner each, which is
worth adding when somebody asks rather than before.

The notification catalogs travel inside the binary as SEA assets, so it needs
nothing beside it but the config file and somewhere to keep its state.

### 4.6 Unraid and Home Assistant

Distribution rather than features (roadmap 6.6): both reach an audience that
runs exactly this kind of container, and neither changes a line of the
application.

**Unraid.** `deploy/unraid/isitdown-ui.xml` and `deploy/unraid/isitdown-light.xml`
are Community Applications templates for the two published images. Add the
template under **Docker → Add Container → Template repositories**, or point the
URL at the raw file. Each one carries the port, the paths and one masked
variable per channel credential, so the form asks the same questions the compose
file answers — a port and a data volume for the UI edition, a read-only
`config.yml` and a data volume for the Light edition.

**Home Assistant.** `deploy/homeassistant/isitdown/` is an add-on for the UI
edition. The Supervisor discovers an add-on repository from the root of a Git
repository and this one is a folder inside a project, so it installs as a local
add-on: copy the folder into the `addons` share, then **Settings → Add-ons →
Add-on store → ⋮ → Check for updates**. It layers one file onto
`ghcr.io/devmanfre/isitdown:ui-latest` rather than rebuilding anything, so
installing it costs a `docker pull`.

Two decisions worth knowing before installing it:

- **It publishes a port instead of using ingress.** Ingress serves an add-on
  under a generated path prefix, and the dashboard is built against an absolute
  one — its bundle and its API calls both start at `/`. A panel would open to a
  blank page, which is worse than a link.
- **Only credentials are add-on options.** Everything else is set in the
  dashboard, because the UI edition keeps its whole configuration in SQLite. The
  option names are the variable names the channels ask for, so the dashboard's
  "env missing" row and the add-on's configuration page say the same word. The
  database lives in `/data`, the add-on's own persistent volume, which is what a
  Home Assistant backup takes with it.

The Light edition has no add-on. There would be no page to open in Home
Assistant, which makes a plain container the better way to run it.

### 4.7 Outposts — a second point of view for probes

A probe that fails says "unreachable *from this container's network*", which is
not the same as "down" — a home router dropping a route looks exactly like the
service going away. An **outpost** (roadmap 1.7) is a second vantage point: a
stateless container on another network — a small VPS, a second site — that runs
one probe when asked and answers with what it saw. The poller asks every outpost
alongside its own reading and keeps what the majority agrees on
([how it works §7.10](how-it-works.md#710-outposts-and-consensus)).

It is the Light image under its own command, so there is no third image to pull:

```bash
# On the VPS: the outpost listens on :8080 and refuses to start without a token
echo "OUTPOST_TOKEN=$(openssl rand -hex 32)" > .env
docker compose --profile outpost up -d

# On the main instance (either edition), the same token and every outpost's URL
OUTPOSTS=https://vps-1.example.com:8080,https://vps-2.example.com:8080
OUTPOST_TOKEN=<the token above>
```

- **The main instance asks; the outpost never calls home.** The main instance
  usually sits behind NAT and the Light edition has no server at all, so the
  outpost is the one that listens. It keeps no configuration either: every
  request carries the whole probe, so one outpost can serve several
  installations and a restart loses nothing.
- **Probes only.** Probe adapters (`http`, `tcp`, `dns`, …) are sent; a status page reads the same
  from anywhere, so it never is. The outpost refuses any other adapter, which
  also keeps it from being a general-purpose fetcher for whoever holds the token.
- **Put TLS in front of it.** The token travels in an `Authorization` header and
  a probe's options in the body, so an outpost reachable over the internet
  belongs behind a reverse proxy terminating HTTPS, or on a private network
  (WireGuard, Tailscale).
- **Opt-in, and never in the way.** With `OUTPOSTS` unset nothing changes. An
  outpost that is down, slow or misconfigured abstains — logged as `outpost did
  not answer` and named in the provider's diagnostics note — and never counts as
  a "down" vote.

### 4.8 A database that will not open

The UI edition's state is one SQLite file, `/app/data/isitdown.db`, and a power
cut halfway through a write is the most ordinary failure a homelab has. The
database is opened in WAL mode with `synchronous = FULL`, so a cycle that
committed survives the cut; what can still happen is a disk that tore a page.
Every start runs `PRAGMA quick_check` before anything is written, and a file
that fails it stops the start: the container exits with code 1 and prints, on
stderr, what SQLite found, the path, and the three steps below — never a stack
trace, and the damaged file is left exactly as it was.

To recover with Docker Compose, using the most recent backup the dashboard
downloaded (Settings → Data → Database backup → Download database, a file named
`isitdown-<date>.db`, here in the current directory):

```bash
docker compose --profile ui stop ui
# Keep the damaged file and its -wal/-shm aside, then put the backup in its place.
# The -wal must go with it: left behind, it would be replayed onto the backup.
docker compose --profile ui run --rm --no-deps -v "$PWD:/restore:ro" --entrypoint sh ui -c '
  cd /app/data && mkdir -p damaged && mv isitdown.db* damaged/ &&
  cp /restore/isitdown-2026-11-14.db isitdown.db'
docker compose --profile ui start ui
```

An older backup is brought up to the current schema on start, as a restore from
the dashboard is. Two things a backup does not cover:

- **Rows written after it.** `sqlite3 damaged/isitdown.db .recover > recovered.sql`,
  run on a copy of the damaged file, salvages what SQLite can still read; it is
  worth a look before the file is thrown away.
- **`secrets.env`.** Channel credentials live beside the database, not in it
  ([3.4](configuration.md#34-how-secrets-are-handled)), so they are untouched by all of the above.

With no backup at all, starting with the damaged file moved aside begins an
empty database, seeded from nothing: the providers are added again from the
dashboard or with a `config.yml` import.

### 4.9 Resource envelope — what a fleet costs

"Will it run on my Raspberry Pi?" — measured, not guessed. `npm run
measure:envelope` ([9.4](development.md#94-tests-and-checks)) runs both editions,
built, against a local fake Statuspage at three fleet sizes, and prints this
table:

Measured on 2026-11-21, IsItDown v2.46.1, Node 26.13.1, 13th Gen Intel(R) Core(TM) i7-1355U (6 threads), 10 GB RAM.
Providers served by a local fake Statuspage (all operational), 2,000+ samples per size;
growth extrapolated at the default 3-minute interval.

| Edition | Providers | Startup to ready | Memory (RSS) | CPU per cycle | Cycle duration | Database after startup | Database per provider per month |
|---|--:|--:|--:|--:|--:|--:|--:|
| Light | 10 | 198 ms | 202 MB | 12 ms | 9 ms | — | — (state file) |
| UI | 10 | 18.3 s | 267 MB | 17 ms | 47 ms | 38.5 MB | 1.5 MB |
| Light | 100 | 444 ms | 255 MB | 158 ms | 137 ms | — | — (state file) |
| UI | 100 | 27.9 s | 255 MB | 80 ms | 271 ms | 392.1 MB | 1.5 MB |
| Light | 500 | 2.8 s | 304 MB | 1.6 s | 1.5 s | — | — (state file) |
| UI | 500 | 74.7 s | 296 MB | 386 ms | 1.4 s | 2030.3 MB | 1.5 MB |

How to read it:

- **Memory** is resident memory after at least a hundred cycles, when it has
  stopped climbing. Most of it is what V8 and the allocator hold in reserve:
  the JavaScript heap itself stays around 20 MB at 10 providers. Plan for
  about 300 MB per edition. Either edition fits on a 1 GB board.
- **CPU per cycle** is IsItDown's own work against a provider on loopback. A
  real fleet adds network round trips to the cycle's *duration*, not to its
  CPU. Even the worst figure, 1.6 s every 3 minutes, is under 1% of one core.
  The Light edition's cost grows faster than its fleet because it rewrites its
  whole JSON state file on every change.
- **Startup** for the UI edition is mostly history: a provider it has never
  seen gets 90 days of samples backfilled from its own incident list before
  the first cycle is reported, and `/ready` answers 200 only after that
  cycle. A restart with the history already in place is faster. The Light
  edition keeps no history, so it is ready after one cycle.
- **Database.** The backfill is why a new fleet starts at about 4 MB per
  provider. After that it grows 1.5 MB per provider a month and levels off at
  the retention (120 days by default): about 6 MB per provider, so ~60 MB for
  10 providers, ~600 MB for 100 and ~3 GB for 500. Lowering the retention in
  Settings shrinks that in proportion. The replay's whole readings are a
  fixed extra, capped at 100 per provider. The Light edition writes one
  small JSON state file.

### 4.10 Proxies and networks with no Internet

**Behind a proxy.** Set the usual variables on the container. Every HTTP
request IsItDown makes then goes through the proxy: status pages,
notification channels, the update check, the catalog, the heartbeat
([3.39](configuration.md#339-pinging-out--isitdowns-own-dead-mans-switch)).
Hosts in `NO_PROXY` are reached directly. Upper and lower case both work, and
credentials can go in the URL (`http://user:pass@proxy:3128`). The log says
once at start-up which proxy is in use, without the credential.

```yaml
services:
  isitdown:
    environment:
      HTTPS_PROXY: http://proxy.corp:3128
      HTTP_PROXY: http://proxy.corp:3128
      NO_PROXY: localhost,127.0.0.1,.lan,10.0.0.0/8
```

Things to know:

- **Put your LAN in `NO_PROXY`.** Without it, a request to `nas.lan` or to
  an outpost on the LAN goes to the proxy too, like it would with `curl`.
- **TCP, ping, DNS and IMAP checks do not use the proxy** — a proxy only
  carries HTTP. They connect straight from the container.
- **The egress policy ([3.38](configuration.md#338-the-egress-policy--what-a-probe-may-reach))
  still judges the destination, not the proxy.** One difference: a host
  name this container cannot resolve is passed on to the proxy instead of
  refused, because in a closed network often only the proxy can resolve
  public names.
- **The container's own healthcheck** talks to `localhost` and never goes
  through the proxy.

**With no way out at all.** IsItDown keeps working for whatever it can reach:
services on the LAN, TCP and ping checks, notification channels inside the
network (a webhook, Mattermost, a local ntfy or Gotify). What needs the
Internet degrades quietly — no error in the log every cycle:

| Feature | Without Internet |
|---|---|
| Public status pages (GitHub, Cloudflare…) | Read as failed, as they would be in any outage. Do not add them. |
| Provider icons in the dashboard | The browser cannot load them; each tile keeps its three-letter label. |
| Dashboard fonts (Google Fonts) | The browser falls back to the system font. |
| Remote provider catalog | The catalog built into the image is used. Failures go to the `debug` log only. |
| Update check | No "new version" notice. Failures go to the `debug` log only. |
| Web push | Needs the browser vendor's push service, so delivery fails and shows in the delivery log, like any channel that cannot send. |
| AI incident summaries | Need the model provider's API; summaries are not written. |


### 4.11 Scheduled backups

The download in Settings → Data is the backup somebody remembers to take. The
UI edition also takes one by itself, on a cron schedule, into a folder on the
server — off until a schedule is set.

| Variable | Default | What it does |
|---|---|---|
| `BACKUP_CRON` | — (off) | Five-field cron expression, read in the instance's time zone: `0 3 * * *` is every night at three. Set from Settings → Data → Scheduled backups too; the variable wins and locks the field. |
| `BACKUP_KEEP` | `7` | How many scheduled copies to keep (1–365). Older ones are deleted after each new one is written. Settable from the dashboard too, same rule. |
| `BACKUP_DIR` | `/app/data/backups` | The folder. Environment only: a path on the server is what a mount decides. |
| `BACKUP_WEBDAV_URL` | — | Also PUT every copy to this WebDAV folder (Nextcloud, a NAS). User and password, URL-encoded, in the URL: `https://me:pa%40ss@cloud.example/remote.php/dav/files/me/isitdown/`. |
| `BACKUP_S3_URL` | — | Also PUT every copy to S3 or anything that speaks it (MinIO, R2, B2), path style, keys in the URL, region as a parameter: `https://KEY:SECRET@s3.eu-south-1.amazonaws.com/my-bucket/isitdown?region=eu-south-1`. One signed PUT, no SDK. |

Each copy is `VACUUM INTO` a file named `isitdown-auto-<UTC time>-v<version>.db`,
checked with `PRAGMA integrity_check` before it is given its name — a disk
that fills half way leaves an error, never a file that looks like a backup and
is not one. Rotation touches only files with that prefix: the dashboard's own
downloads and the pre-upgrade copies of [4.12](#412-upgrading-and-rolling-back)
in the same folder are left alone. Like the download, a scheduled copy leaves
out `secrets.env` and the web-push key pair.

A folder inside the data volume survives a restart but not the disk it is on,
so mount it from somewhere else:

```yaml
services:
  ui:
    environment:
      BACKUP_CRON: "0 3 * * *"
      BACKUP_KEEP: "14"
    volumes:
      - isitdown-data:/app/data
      - /mnt/nas/isitdown-backups:/app/data/backups
```

Settings → Data → Scheduled backups shows the last copy that worked and when
the next one runs, and has a **Back up now** button that takes one on the same
path — folder, rotation, uploads. A copy that fails is said there, with the
reason, and turns the instance's own row ([3.40](configuration.md#340-the-instance-as-a-provider--isitdown-watching-itself)) degraded
on its Database component: the alert reaches you through the same channels,
routing and quiet hours as any provider's. The next copy that works clears it.

### 4.12 Upgrading and rolling back

Every upgrade that changes the database schema first copies the file to
`/app/data/backups/pre-v<schema>.db`, then upgrades it in one transaction.
If the copy cannot be made — a full disk — the upgrade does not start.

An older image started over a database a newer one has upgraded refuses to
start, before writing anything: rolling back is a normal operation, and an old
build reading a schema it does not know could write rows the new one cannot
trust. It exits with code 1 and says, on stderr, which schema the file is at,
which IsItDown wrote it, and the ways forward. There are two.

**Take the schema back down, keeping the data.** With the *newer* image — the
only one that knows what its steps did — run `--migrate-down` with the
schema the older one knows (the refusal names it), then start the older image:

```bash
docker compose --profile ui stop ui
docker compose --profile ui run --rm --no-deps ui node dist/ui/server.js --migrate-down 41
# now pin the older tag in compose.yml and start it
docker compose --profile ui up -d
```

It copies the file to `backups/pre-down-v<schema>.db` first, then drops what
the newer schema added — the columns and tables, with the rows in them — in one
transaction. Everything the older schema has a place for stays. Some old steps
cannot be undone (one cleared web-push subscriptions): `--migrate-down` stops
at the newest of those and says how far it can go.

**Or put the pre-upgrade copy back.** `backups/pre-v<schema>.db` is the
database exactly as the older version left it. Restore it the way
[4.8](#48-a-database-that-will-not-open) restores a backup; anything recorded
since the upgrade is not in it.
