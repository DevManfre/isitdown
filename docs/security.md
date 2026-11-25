[← README](../README.md)

## 11. Security

What IsItDown trusts, what it keeps and where, and what someone in a given
position can do to it. This page is the threat model; how to report a
vulnerability is in [SECURITY.md](../SECURITY.md).

### 11.1 The deployment this model assumes

One operator, one instance, on a machine they control. The UI edition's
dashboard is meant for the loopback or a LAN the operator trusts; the
Compose file publishes it on `127.0.0.1:3000` and nowhere else. The Light
edition has no HTTP server at all.

Everything below follows from that. Where a feature reaches past it — a token
for another host, a public page, a provider's push — it is opt-in, off by
default, and named in [11.4](#114-surfaces-reachable-from-off-the-machine).

### 11.2 What is trusted

| Who or what | Trusted with | Why |
|---|---|---|
| Whoever can reach the UI edition's port, with no `API_TOKEN` set | Everything: every route, read and write | The port *is* the boundary. Bound to `127.0.0.1`, that is the operator. |
| A request from the loopback, with `API_TOKEN` set | Everything (unless `API_LOCAL_BYPASS=false`) | Keeps the operator's own dashboard working with no token in the browser. |
| The holder of `API_TOKEN` | Reading: `GET` and `HEAD`, from any host | One key, no identities, no expiry; it must never be worth more than reading ([configuration §3.12](configuration.md#312-reaching-the-api-from-another-host)). |
| Whoever writes `config.yml` (Light) | Everything, including private addresses | Only the operator writes it. |
| A plugin in `PLUGINS_DIR` | Everything the poller can do, every resolved credential | It is code, loaded into the process ([configuration §3.14](configuration.md#314-adapter-plugins)). |
| A provider's status page | Nothing | Every response is validated with zod before use; a malformed one is an error on that provider. |
| The host and the container runtime | Everything | Whoever controls the host reads the data volume. |

Not trusted: `X-Forwarded-For` (a client writes it, so it never decides whether a
request is local), a browser `Origin` that is not the dashboard's own (writes are
refused with `403`), a `Host` that is not `localhost`, an IP address or a name in
`ALLOWED_HOSTS`.

### 11.3 What is stored where

| What | Where | At rest |
|---|---|---|
| Channel credentials, `AI_API_KEY` (UI) | `secrets.env` beside the database, mode `0600` | Plain text, protected by file mode and the volume |
| Channel credentials (Light) | The container's environment; `config.yml` holds only `${VAR}` references | Wherever the environment comes from (`.env`, `env_file`) |
| Configuration, history, incidents, notes, delivery log (UI) | SQLite in the data volume | Plain text. Holds variable *names*, never credential values |
| Web-push key pair (UI) | Two rows in the database | Plain text |
| State (Light) | The state file in the data volume | Plain text, no credentials |
| Downloaded and scheduled backups | Wherever they are saved or uploaded | A copy of the database, with `secrets.env` and the web-push key pair left out |
| Backup upload credentials | `BACKUP_WEBDAV_URL`, `BACKUP_S3_URL`, in the environment | As above for environment variables |

Nothing is encrypted by IsItDown itself: disk encryption, if wanted, is the
host's. No API response, page, log line or error message contains a resolved
secret, and tests assert it; the dashboard can *set* a credential but never read
one back ([configuration §3.4](configuration.md#34-how-secrets-are-handled)).

### 11.4 Surfaces reachable from off the machine

Each is off until the operator turns it on.

| Surface | Turned on by | Protected by | What it gives |
|---|---|---|---|
| The API with a token | `API_TOKEN` | The token, read-only | Every `GET`: configuration (without credential values), history, incidents |
| `/public` | `PUBLIC_PAGE=true` | Nothing — it is public on purpose | The providers in `PUBLIC_PAGE_PROVIDERS` (all enabled ones when unset); it takes no request input |
| `/push/:id` | `PUSH_TOKEN` | The token in the URL; `404` when unset | A trigger to read that provider *now* — the body is never parsed into a status |
| `/heartbeat/:id` | `HEARTBEAT_TOKEN` | The token in the URL | A ping recorded for one heartbeat provider |
| The outpost's `POST /probe` | Running the outpost | `OUTPOST_TOKEN`, required to start | One probe run from the outpost's network; status-page adapters are refused |
| `/health`, `/ready` | Always | Nothing | Whether the process is up; never gated, for container probes |

A token in a URL (`/push`, `/heartbeat`) ends up in the provider's settings and
in any proxy's access log: treat it as a credential and rotate it by changing the
variable.

### 11.5 What each attacker can do

**On the LAN, with the dashboard published beyond the loopback and no token.**
Everything the operator can: read the configuration, add or delete providers,
change channels, restore a backup, send notifications through the configured
channels. This is why the Compose file binds to `127.0.0.1`; publishing the port
wider is the operator's decision, and the answer is a reverse proxy with its own
authentication in front, plus `API_TOKEN` and `API_LOCAL_BYPASS=false`.

**With the API token.** Read everything a `GET` returns. Write nothing: any other
method answers `403`, from this machine as much as from anywhere.

**With write access to the dashboard.** Beyond changing the configuration, two
things worth knowing:

- *Reaching the network through the probes.* A provider or probe address is
  checked against the egress policy on the address it resolves to, on every
  redirect hop: the UI edition refuses private, loopback and link-local
  addresses (cloud metadata included) unless `EGRESS_ALLOW` lists them
  ([configuration §3.38](configuration.md#338-the-egress-policy--what-a-probe-may-reach)).
  The Light edition reads private and loopback addresses, because only the
  operator writes its configuration; `OUTBOUND_BLOCK_PRIVATE=true` makes it
  refuse too. Link-local is refused in both.
- *Reading credentials.* Not possible through the dashboard: values go in, never
  out. A credential can be *replaced*, so a channel can be pointed elsewhere.

**With the Docker socket mounted.** The Docker API has no read-only mode, and
`:ro` on the socket does not make one: whoever holds it controls the daemon, and
so the host. Use the socket proxy the `docker` adapter's documentation shows,
which answers only the container list.

**With a plugin in `PLUGINS_DIR`.** Anything the process can do. A plugin is
installed by the operator, on the operator's judgment, like any other code.

**Upstream, as a provider or a probed host.** It can send a malformed or
hostile response; the adapter's zod schema rejects what it does not expect, and
the worst outcome is a wrong reading of that one provider. With incident
summaries on ([configuration §3.36](configuration.md#336-incident-summaries--settings--ai-implementation)),
a provider's incident text reaches the model the operator named; the summary is
shown as the model's text, never acted on.

**Receiving the webhook.** Anyone who learns the webhook URL can post to the
receiver. Set `WEBHOOK_SECRET` and verify `X-IsItDown-Signature` and its
timestamp, so a forged or replayed request can be told apart
([configuration §3.6](configuration.md#36-notification-channels)).

### 11.6 Out of scope

- **Several users.** No accounts, no roles, no per-user audit. One operator is a
  declared non-goal.
- **Exposure to the Internet without a proxy.** The dashboard has no
  authentication of its own; putting it on a public address without an
  authenticating reverse proxy in front is outside what this model covers.
- **A compromised host or container runtime.** Whoever has it has the data
  volume, `secrets.env` included.
- **Encryption at rest.** Left to the host's disk encryption.
- **Status pages behind a login.** Only public status pages are read.
