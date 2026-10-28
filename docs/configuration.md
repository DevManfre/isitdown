[← README](../README.md)

## 3. Configuration

### 3.1 Light edition — `config.yml`

One file, mounted as a volume, **re-read at the start of every cycle** — editing
it applies on the next poll with no restart. `config.example.yml` is the tracked
template; `config.yml` itself is git-ignored, since it is your provider list.

```yaml
pollIntervalMinutes: 3      # how often to poll every provider
requestTimeoutSeconds: 8    # per-request timeout
maxRetries: 3               # attempts per provider per cycle, with backoff
failureThreshold: 5         # consecutive failures before a "monitoring degraded" warning
adaptivePolling: true       # while a provider has an open incident, poll it on the cadence below
adaptiveIntervalMinutes: 1  # that cadence; never slower than the provider's own interval
confirmSamples: 1           # consecutive polls that must agree before a change notifies
correlationThreshold: 0     # providers that must go bad together before one shared-failure alert replaces them; 0 is off
correlationWindowMinutes: 10 # how wide "together" is
locale: en                  # language for notification messages: en | it

services:
  - name: GitHub
    id: github
    adapter: statuspage
    baseUrl: https://www.githubstatus.com

  - name: Cloudflare
    id: cloudflare
    adapter: statuspage
    baseUrl: https://www.cloudflarestatus.com

  - name: Anthropic
    id: anthropic
    adapter: statuspage
    baseUrl: https://status.claude.com

notifications:
  telegram:
    enabled: true
    botToken: "${TELEGRAM_BOT_TOKEN}"
    chatId: "${TELEGRAM_CHAT_ID}"
  webhook:
    enabled: false
    url: "${WEBHOOK_URL}"
    secret: "${WEBHOOK_SECRET}"   # optional: signs the request, see 3.6
  discord:
    enabled: false
    webhookUrl: "${DISCORD_WEBHOOK_URL}"
  slack:
    enabled: false
    webhookUrl: "${SLACK_WEBHOOK_URL}"
```

| Key | Default | Notes |
|---|---|---|
| `pollIntervalMinutes` | `3` | 1–1440. The real delay carries ±10% jitter. |
| `requestTimeoutSeconds` | `8` | Per HTTP request, not per cycle. |
| `maxRetries` | `3` | Attempts per provider per cycle, exponential backoff plus jitter. |
| `failureThreshold` | `5` | Consecutive failed cycles before one "monitoring degraded" warning. |
| `adaptivePolling` | `true` | While a provider has an open incident — or any status worse than operational — poll it on `adaptiveIntervalMinutes` instead of its own cadence. `false` leaves every provider on the cadence it was configured with. |
| `adaptiveIntervalMinutes` | `1` | 1–1440. Taken as a *minimum* against the provider's own interval, so it can only ever watch a provider more closely. A provider that has never answered stays on its configured cadence: `unknown` is not an incident. |
| `confirmSamples` | `1` | 1–10. Flap damping: how many consecutive polls must agree on a reading before the change is announced. `1` notifies immediately; `2` ignores a page that disagrees with itself for one cycle, at the cost of one poll of delay. |
| `correlationThreshold` | `0` | 0–100. Correlated-outage detection (roadmap 2.7): how many providers have to go bad inside `correlationWindowMinutes` before the cycle sends one "this looks like a shared failure" alert instead of one per provider. `0` and `1` are off, which is the default — this is the only setting here that *replaces* alerts. |
| `correlationWindowMinutes` | `10` | 1–1440. How wide that window is. Wider catches a shared failure that rolls across status pages slowly, and risks folding two unrelated bad days into one. |
| `locale` | `en` | `en` or `it`; anything unknown falls back to `en`. |
| `services[].id` | — | Required. Lowercase slug; it keys the stored state. |
| `services[].adapter` | — | Required. `statuspage` covers every Atlassian-hosted page; `instatus`, `betterstack`, `cachet`, `uptimekuma` and `uptimecom` cover those hosted and self-hosted platforms; `rss` reads any RSS or Atom incident feed; `imap` reads a vendor's notices out of a mailbox (see below); `html` scrapes a page that publishes neither and `watchdog` reports any change to a page's text (see below); `slack`, `aws`, `gcp` and `azure` read those providers' own shapes; `http` probes an endpoint of your own rather than a status page, `sequence` chains two or three requests for an API behind a login, and `tcp` and `dns` probe a port and a name that speak no HTTP at all (see below). |
| `services[].enabled` | `true` | `false` keeps the entry but stops polling it. |
| `services[].intervalMinutes` | — | 1–1440. This provider's own cadence; omit to follow `pollIntervalMinutes`. A cycle runs at the shortest cadence anything asked for, and the slower providers sit the extra cycles out. |
| `services[].intervalSeconds` | — | 10–3600, probes only (`http`, `sequence`, `tcp`, `dns`). The same cadence in seconds, for an endpoint that can be down for less than a minute; a status page stays on the minute floor and is refused at load. Never together with `intervalMinutes`. |
| `services[].crossChecks` | — | Only on a probe (`http`, `sequence`, `tcp`, `dns`) or a mailbox reading (`imap`): the id of the provider whose status page this probe is a second opinion on — silent-outage cross-check (roadmap 1.10). When the probe cannot reach the service and that provider's page still reports operational with no open incident, the disagreement is itself an alert. Optionally narrowed to one component with the same `provider#component` form a routing rule targets (roadmap 2.9); the component half only refines what the trust card (roadmap 8.1) compares the probe against, since the silent-outage check itself is about a page claiming nothing at all is wrong. |
| `services[].authority` | from the adapter | Which source is the record for this provider — `declared` (its own status page) or `observed` (our own reading), roadmap 9.1. Omitted is the normal case and is not a missing value: a probe (`http`, `sequence`, `tcp`, `dns`) reads `observed` because it *is* the reading, and everything that parses somebody's page reads `declared`. Set it only to disagree with that — a status page you have learned to distrust, or a probe you do not want treated as the record. It decides what the dashboard prints beside the adapter and how a silent-outage alert is worded, not which samples back a percentage. See [7.7](how-it-works.md#77-which-source-is-the-record). |
| `services[].mutedUntil` | — | ISO 8601. While it is in the future the provider is polled and recorded as usual but notifies nothing — "I know, stop telling me, until then". In the UI edition this is what the dashboard's **Mute** control writes. |
| `services[].options` | — | Adapter-specific extras. Six adapters take any today: `html` (`selector`, plus optional `operational` / `degraded` / `partial_outage` / `major_outage` word lists), `watchdog` (`baseline`, plus an optional `selector`), `http`, `tcp` and `dns`, and `imap` (see their own sections below). |

#### The `html` adapter

For the pages that publish no JSON and no feed at all. Give it the page URL, a
CSS selector for the element whose text says how the provider is, and — when the
page uses unusual wording — the words that mean what:

```yaml
  - name: Sorry-hosted provider
    id: example
    adapter: html
    baseUrl: https://status.example.com/
    options:
      selector: ".status-banner"
      operational: "all systems operational, everything is fine"
      major_outage: "outage, down"
```

The selector supports tag, `#id`, `.class` and `[attr]` / `[attr="value"]`
compounds with the descendant and child (`>`) combinators. Anything past that —
a selector list, a pseudo-class, a sibling combinator — is refused rather than
silently matching nothing.

Reading markup is fragile by nature, so the failure modes are deliberate:

- a selector that matches nothing **throws**, so a page whose structure moved
  fails like an unreachable provider (retries, then the monitoring-degraded
  warning) instead of settling into a reading nobody ordered;
- text matching no configured word reads `unknown`, never `operational`;
- the most specific wording wins, so "partial outage on the API, everything else
  operational" reads as the partial outage;
- there are no incidents, components or maintenance windows — a page that needed
  scraping has no structure to read them out of.

#### The `watchdog` adapter — any change to a page's text

For the page that is only prose ("All systems normal") and that not even the
`html` adapter's status words fit (roadmap 1.12). It reports any *change* in
the page's text against a baseline you write down, and never tries to say what
the change means:

```yaml
  - name: Prose-only provider
    id: example-prose
    adapter: watchdog
    baseUrl: https://status.example.com/
    options:
      baseline: "All systems normal."
      selector: ".notice"   # optional — the whole page when absent
```

- the text is compared with whitespace collapsed and capitals folded, so a
  re-wrapped line is not a change;
- a page matching its baseline reads `operational`; one that does not reads
  `degraded` — the least severe word that still is not "fine" — with one open
  incident whose title is the new text (cut to 280 characters). Its id is the
  text's fingerprint, so a page that changes again opens a second incident, and
  one that changes back resolves it;
- `baseline` is required and is configuration, not memory: an adapter that
  learned it from its first read would relearn it after a restart, and a page
  already changed by then would quietly become the new normal. Saving a
  watchdog without one is refused, and a poll without one fails with the text
  the page currently reads — ready to copy in;
- with no `selector` the whole document's text is watched (script and style
  bodies left out), which also notices a changed footer or date; name the
  element when the page carries anything that moves on its own.

#### The `http` adapter — probing your own endpoint

Every other adapter reads a page a provider publishes about itself. This one
reads the service directly: it makes the request, and the answer is the reading
(roadmap 1.8).

```yaml
  - name: My API
    id: my-api
    adapter: http
    baseUrl: https://app.example.com
    options:
      path: "/health"
      expectStatus: "200-299"
      expectBody: '"db":"up"'
      slowMs: "1500"
      header.Authorization: "Bearer ${API_TOKEN}"
```

| Option | Default | Meaning |
|---|---|---|
| `method` | `GET` | `GET` or `HEAD`. `POST` is refused: the poller retries a failed read, and a retried `POST` is not the same request twice. |
| `path` | — | Appended to `baseUrl` verbatim. Base URLs are stored without a trailing slash, so this is how an endpoint that needs one gets it — and how one host is probed at two paths from two services. |
| `expectStatus` | `200-299` | Single codes or inclusive ranges, comma-separated (`200-299,401`). Anything outside reads as an outage, so an API that is up and refusing us can still be healthy. |
| `expectBody` | — | Plain text that must appear anywhere in the response. |
| `absentBody` | — | Plain text that must **not** appear: how an error page served with a `200` is caught. |
| `slowMs` | — | An answer at or over this many milliseconds reads `degraded` instead of `operational`. |
| `followRedirects` | `yes` | `no` reads a `3xx` as itself, so a dead app redirecting to a login page is not read as healthy. |
| `tlsWarnDays` | — | A certificate expiring within this many days reads `degraded`. Off unless set: `fetch` exposes nothing about the connection it made, so the expiry costs a second handshake, and it is only asked for after a request that already succeeded. |
| `header.<Name>` | — | One request header per option. A `${VAR}` in the value is resolved from the environment at request time; an unset variable throws rather than sending the literal `${VAR}` and reporting your service down over a `401`. |

The readings this produces:

| What happened | Reading |
|---|---|
| Accepted status, body matches, under `slowMs` | `operational` |
| Accepted status and body, at or over `slowMs` | `degraded` |
| Accepted status and body, certificate inside `tlsWarnDays` | `degraded` |
| Status outside the set, missing/forbidden body text | `major_outage` |
| Refused, unresolvable, TLS rejected, or past the request timeout | `major_outage` |
| A bot challenge (`cf-mitigated`) at a status you did not accept | `unknown` |

Four things worth knowing before relying on it:

- a non-2xx and an unreachable host are **readings**, not failed reads. Every
  other adapter throws on those so the poller can retry, because a status page
  that will not answer has told us nothing; here it has told us everything.
- the reading is a severity and nothing more: no incidents, no components, no
  maintenance windows. There is no document to read them out of, and minting an
  incident per poll would open and resolve one every cycle. *When* it went down
  still comes from the status change and the history.
- it is one vantage point, this container. A local DNS or egress failure reads
  as every probed service being down at once. The poller says so when it can: a
  cycle in which *every* provider either failed or never answered logs a warning
  and adds "this looks like a failure on our side" to those reads in
  **Diagnose** — one status page answering normally is enough to rule it out. It
  changes no reading and silences no message, because from here those services
  really are unreachable. Collapsing a burst into one alert is what
  `correlationThreshold` does (the settings table above, and §7.3 in the manual);
  `confirmSamples` is still the
  setting for "a single blip is not worth a message".
- a probe that is not operational says why: **Settings → the provider's row,
  expanded → Diagnose** carries the sentence the reading has nowhere to hold — `answered
  HTTP 503, outside the accepted 200-299`, `no answer from …: connect
  ECONNREFUSED`, `the TLS certificate expires in 9 day(s)`. "Down" and "down
  because the name no longer resolves" are the same severity and different
  problems.
- it will probe **anything this container can reach**, private addresses
  included, and it has no allowlist. That is deliberate for a
  single-operator dashboard bound to `127.0.0.1` (`BIND_HOST`, and the compose port mapping); it is also the reason a
  read-only API token or a public read-only page (roadmap 4.15 and 5.1) would
  have to decide who may write a service definition before either ships. Two
  limits apply regardless: a response body is read up to **8 MiB** and a probe
  that streams more fails with `response exceeded 8388608 bytes`, and
  **link-local addresses** (`169.254.0.0/16`, `fe80::/10`, the `fd00:ec2::254`
  metadata address) are always refused, as is any redirect that lands on one.
  Set `OUTBOUND_BLOCK_PRIVATE=true` to refuse loopback and private ranges as
  well (`127/8`, `10/8`, `172.16/12`, `192.168/16`, `100.64/10`, `::1`,
  `fc00::/7`) — recommended whenever the dashboard is reachable beyond this
  host.
- **a bot challenge is not an outage.** Cloudflare and friends answer a client
  that cannot run their JavaScript with `403` and a `cf-mitigated` header — the
  "Just a moment…" page. The edge never asked your service anything, so the
  probe reads `unknown`, which wakes nobody, and says so in **Diagnose**. Your
  browser opens the same URL because it solves the challenge; this container
  cannot. Three ways out, in the order worth trying: probe a `path` the
  challenge skips (`/robots.txt`, a health endpoint), let this machine past the
  challenge (a WAF skip rule on its egress IP), or put the status in
  `expectStatus` — which reads "the edge is up" and stops saying anything about
  the service behind it. Every request this project sends names itself
  `IsItDown (+https://github.com/devmanfre/isitdown)`, so a skip rule can match
  on that; `header.User-Agent` replaces it when a host wants something else.
- a wrong option (`expectStatus: 2xx`, a `${VAR}` with nothing behind it, an
  `expectBody` on a `HEAD`) throws every cycle and shows up as a failing
  provider, never as a service quietly reading down. `node dist/light/check.js
  --probe` catches it before the poller does.

#### The `tcp` and `dns` adapters — probing what speaks no HTTP

The probe above needs a response to read. A database, an SMTP relay or a message
broker never sends one, and a name that has stopped resolving never gets that
far — so those two get an adapter each (roadmap 1.9).

```yaml
  - name: Primary database
    id: primary-db
    adapter: tcp
    baseUrl: https://db.internal
    options:
      port: "5432"
      slowMs: "250"

  - name: Our apex record
    id: apex-dns
    adapter: dns
    baseUrl: https://example.com
    options:
      recordType: "A"
      expectValue: "203.0.113.7"
      resolver: "1.1.1.1"
```

Both take their target from `baseUrl`, because that is the field the schema
validates and an `http`/`https` URL is what it accepts: `tcp` uses its host, and its scheme only to decide whether to speak TLS (see `check`), `dns` resolves its host and fetches nothing from it.

| Option | Adapter | Default | Meaning |
|---|---|---|---|
| `port` | `tcp` | the URL's, else the scheme's | The port to connect to. A value that is not a port throws rather than falling back, since a probe silently aimed at 443 would read healthy about the wrong thing. |
| `check` | `tcp` | `connect` | What to ask the port: `connect` (just open it), `tls` (a handshake, reading the certificate), `smtp` (a `220` greeting, then a `250` to `EHLO`, then `QUIT`), `websocket` (an `Upgrade` that must come back `101` with the accept token that matches the key sent) or `grpc` (the standard `grpc.health.v1.Health/Check`, which must say `SERVING`). Roadmap 2.15. |
| `tls` | `tcp` | from the URL's scheme | `yes` speaks TLS first, which a secure SMTP, WebSocket or gRPC port needs. Taken from an `https` scheme when unset; always on for `check: tls`. |
| `verify` | `tcp` | `yes` | `no` accepts a certificate this machine's trust store does not know — a private authority. Otherwise an untrusted or expired certificate reads `major_outage` with the reason in the note. |
| `tlsWarnDays` | `tcp` | — | Fewer days than this left on the certificate reads `degraded`. Needs a TLS handshake: `check: tls`, or `tls: "yes"`. The same slow fuse `tlsWarnDays` is on `http`, for a port that speaks no HTTP — IMAPS, LDAPS, a database. |
| `path` | `tcp` | `/` | The path of the WebSocket upgrade, for `check: websocket`. |
| `service` | `tcp` | empty | The service the gRPC health check asks about, for `check: grpc`. Empty asks about the server as a whole. |
| `slowMs` | both | — | A handshake or an answer at or over this many milliseconds reads `degraded` instead of `operational`. |
| `recordType` | `dns` | `A` | `A`, `AAAA`, `CNAME`, `MX`, `NS` or `TXT`. An `MX` answer is matched as `"<preference> <exchange>"` and a `TXT` one with its chunks joined — the way both are written down when someone says what they should be. |
| `expectValue` | `dns` | — | Text one of the records must contain. A record pointed at a decommissioned address still resolves, which is a different kind of bad day from not resolving at all. |
| `resolver` | `dns` | the system's | `1.1.1.1`, or `127.0.0.1:5353`. Asks one server directly — an authoritative one, say — instead of whatever this container's resolver has cached. Unset reads what the rest of the fleet experiences. |
| `domainWarnDays` | `dns` | — | Reads the registration's expiry over RDAP (roadmap 2.7): this many days or fewer left reads `degraded`, a lapsed registration `major_outage`. Asked of the registrable domain — `api.example.co.uk` → `example.co.uk` — and kept twelve hours. |
| `dnssec` | `dns` | — | `true` asks a validating resolver whether the name's DNSSEC chain holds (roadmap 2.7): `resolver` if set, else `1.1.1.1`. An address — `9.9.9.9` — asks that one instead, for a probe whose `resolver` is an authoritative server, which never validates. |

The readings they produce:

| What happened | Reading |
|---|---|
| `tcp`: the port accepted the connection, under `slowMs` | `operational` |
| `tcp`: it accepted, at or over `slowMs` | `degraded` |
| `tcp`: refused, reset, unresolvable, or past the timeout | `major_outage` |
| `tcp` with `tlsWarnDays`: the certificate expires within it | `degraded` |
| `tcp` with a `check`: the handshake completes (greeting and `EHLO` answered, upgrade accepted, health `SERVING`) | `operational` |
| `tcp` with a `check`: the handshake is refused, answered wrongly or never completes (`421` greeting, `200` instead of `101`, `NOT_SERVING`, an untrusted certificate) | `major_outage` |
| `dns`: records came back, matching `expectValue`, under `slowMs` | `operational` |
| `dns`: they came back at or over `slowMs` | `degraded` |
| `dns`: NXDOMAIN, SERVFAIL, no records at all, or nothing matching `expectValue` | `major_outage` |
| `dns` with `domainWarnDays`: the registration expires within it | `degraded` |
| `dns` with `domainWarnDays`: the registration has lapsed | `major_outage` |
| `dns` with `dnssec`: the resolver did not vouch for the name (unsigned zone, or a resolver that does not validate) | `degraded` |
| `dns` with `dnssec`: signatures present and failing — the name resolves only with validation off | `major_outage` |

Everything the `http` section says about a probe applies to these two as well —
readings rather than failed reads, a severity and nothing more, one vantage
point, a note in **Diagnose** saying why, and a wrong option throwing rather
than reading down. Two things are theirs alone:

- `tcp` by default connects and hangs up **without sending a byte**. "The port
  is open" is a smaller claim than "the service is healthy", and saying only the
  smaller one is what keeps the reading honest. `check` asks a slightly larger
  question of the services that have one standard way of answering it, and no
  more: it speaks just enough of the protocol to see the service answer in it,
  and never sends anything to a mailbox, a queue or a table.
- `dns` treats an empty answer as an outage rather than as a missing field.
  Every other adapter degrades on a missing field, because a provider dropping
  one is not an outage of ours — but here the answer *is* the reading, and a
  record that came back empty means nobody can reach the thing it names.

`domainWarnDays` and `dnssec` are the slow fuses beside the answer itself: a
registration that lapses and a signature chain that breaks both resolve
perfectly until the day nothing does. Each is checked only on a name that
resolved, and a lookup that could not answer — a registry with no RDAP service
(several ccTLDs, `.it` among them), a registry that publishes no expiry, a
resolver that timed out — is said in the note and never scored: it is our blind
spot, not the domain's fault.

#### The `sequence` adapter — a login, then the call that needs it

The `http` probe reads one answer. An API behind authentication needs two: a
login that hands back a token, then the call that spends it (roadmap 2.14).
`sequence` runs two or three requests in a row and carries a value from one
answer into the next. It is **not a browser** — no scripts, no rendering — which
is what keeps it inside the project's rule of no extra dependencies.

```yaml
- name: Orders API, authenticated
  id: orders-api
  adapter: sequence
  baseUrl: https://api.example.com
  options:
    step1.method: "POST"
    step1.path: "/login"
    step1.body: '{"user":"probe","password":"${PROBE_PASSWORD}"}'
    step1.extract: "token=json:data.token"
    step2.path: "/orders?limit=1"
    step2.header.Authorization: "Bearer {{token}}"
    expectBody: '"orders"'
    slowMs: "1500"
```

A step is a group of keys, numbered from 1 with no gap, two or three of them:

| Option | Default | Meaning |
|---|---|---|
| `stepN.method` | `GET` | `GET`, `HEAD` or `POST`. Nothing else: a probe that `PUT`s or `DELETE`s on a timer is a footgun. |
| `stepN.path` | empty | Appended to `baseUrl`. May use `{{name}}`. |
| `stepN.body` | — | The request body, `POST` only. Sent as JSON when it starts with `{` or `[`, otherwise form-encoded, unless you set `stepN.header.Content-Type`. |
| `stepN.header.<Name>` | — | A request header, like `header.<Name>` on `http`. |
| `stepN.extract` | — | One `name=rule` per line; every step but the last. The rule is `json:data.token` (dotted path, numbers index an array), `header:X-Csrf-Token`, or `regex:name="csrf" value="([^"]+)"` (the first group is the value, the whole match when there is none). |
| `stepN.expectStatus` | `200-299` | Same syntax as on `http`. |
| `expectBody`, `absentBody`, `slowMs`, `followRedirects` | | As on `http`; `expectBody` and `absentBody` are checked on the **last** step, `slowMs` on the whole sequence. |

`{{name}}` in a later step's path, body or header is replaced by what an earlier
step extracted, and `${VAR}` by an environment variable, the way every
credential travels here. Cookies a step sets ride the next one, nothing more: no
expiry, no domain matching.

The last step is the verdict. A sequence reads `operational` when every step
answered an accepted status, every `extract` found its value and the last
answer satisfied `expectBody` / `absentBody`; `degraded` when it ran to the end
but took `slowMs` or longer; `major_outage` when any step is refused, answers
the wrong status or never answers, or a rule finds nothing — the note names the
step ("step 2 of 2: answered HTTP 401…"). A typo — `{{toekn}}` that no step
extracts, a gap in the numbering, a `${VAR}` with nothing behind it — throws
instead of reading down, like on `http`.

Two things to know before you point it at something:

- a `POST` step changes something on the service every time the sequence runs,
  and the cadence can be as short as ten seconds. Use it for a login, never for
  an order. The poller never retries a probe on its own.
- an extracted value is never written anywhere: not in the note, not in the log,
  not on the dashboard. It is a credential as often as not, and a reading's
  explanation is stored.

Anything invalid stops the container at boot with the reason and the offending
path — a missing file, malformed YAML, a bad base URL, a duplicate service id, an
empty service list, or an enabled channel whose secret is unset. A container that
started with a half-understood configuration would look healthy while silently not
alerting, which is the one failure mode worth being loud about.

#### The `icmp` and `docker` adapters — the homelab's own boxes

Two probes for what has no page and often no port worth naming (roadmap 2.6):
a router, a NAS, the stack of containers on it.

```yaml
- name: Router
  id: router
  adapter: icmp
  baseUrl: http://192.168.1.1
  options:
    count: "3"
    slowMs: "50"

- name: NAS containers
  id: nas
  adapter: docker
  baseUrl: http://docker-socket-proxy:2375
```

**`icmp`** runs the system's own `ping` — busybox's in the image, iputils' on a
Linux host — against `baseUrl`'s host. Inside a container it needs no extra
capability: Docker allows unprivileged ICMP sockets by default. A host with no
`ping` at all says so in the reading's note.

| Option | Default | Meaning |
|---|---|---|
| `count` | `3` | Echo requests per reading, up to `10`. More than one, so a single dropped packet is a loss rate rather than an outage. |
| `slowMs` | — | An average round trip at or over this many milliseconds reads `degraded`. |

| What happened | Reading |
|---|---|
| Every request answered, under `slowMs` | `operational` |
| Every request answered, at or over `slowMs` on average | `degraded` |
| Some answered | `partial_outage` |
| None answered, or the host did not resolve | `major_outage` |

**`docker`** reads one Docker engine — `GET /containers/json?all=1`, one request
per reading — and its containers are the provider's components, picked in the
same picker as a status page's, grouped by compose project. How the engine is
reached is the one decision worth making carefully: the Docker API has **no
read-only mode**, and mounting `/var/run/docker.sock` with `:ro` does not make
it one — whoever holds the socket controls the daemon. So the recommended path
is a socket proxy that answers only the container list:

```yaml
  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy
    environment:
      CONTAINERS: 1          # GET /containers/* and nothing else
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

with `baseUrl: http://docker-socket-proxy:2375`. To read the socket directly
instead, mount it and set `baseUrl: http://localhost` with
`options.socket: /var/run/docker.sock`.

| Container | Selected as a component | The whole engine |
|---|---|---|
| running, healthy or with no health check | `operational` | counts as operational |
| running, health check still starting | `unknown` | abstains |
| running, unhealthy | `major_outage` | counts as down |
| restarting (a crash loop) | `major_outage` | counts as down |
| paused | `degraded` | counts as degraded |
| exited, created, dead — or gone | `major_outage` | abstains |

The two columns differ on purpose. A stopped container is as likely a one-shot
job that finished as a service that died, and an engine kept red forever by a
finished migration container teaches the operator to ignore it; a container
you selected was selected because it should be running. The engine's reading
folds like a status page's: some containers down is `partial_outage`, all of
them `major_outage`. An engine that cannot be reached is a failed read, not an
outage of every container.

### 3.2 UI edition — runtime settings

The UI edition mounts **no** `config.yml`; one on disk would be ignored.
Everything lives in SQLite at `/app/data/isitdown.db` and is edited from
**Settings** in the dashboard (or through [`/config`](api.md#6-http-api)):

- polling interval, request timeout, retries, flap damping
- the service list — add, edit, remove
- which notification channels are enabled, which environment variable carries
  each credential, and — write-only — the credential itself
- theme, dashboard language, notification language, time zone

The page opens as a bento of category tiles — Engine, Monitored services,
Notifications, Delivery, Data, Appearance, and Recently removed while anything
is restorable. Each tile carries a short motion band showing what that category
does (the engine sweeping its providers, the beam leaving for each delivery
channel, retention pruning its oldest day), drawn from the theme's own colours
and held still for anyone whose system asks for reduced motion. Clicking a tile
opens that category on its own page — `#/settings/engine`, so it can be linked
to and left with the browser's back button — with its rows, a rail listing the
other categories, and **All settings** back to the grid. Three controls go with
them: a **filter** over the grid that finds a single setting by name and says
which category holds it (on a category page the same field narrows that
category's rows), a **Detailed / Compact** switch that folds every hint away once they
have been read, and — over the provider list — **All / Polling / Paused /
Muted** chips carrying their own counts. Each provider row keeps its switch on
the line; **Mute**, **Diagnose**, **Edit** and **Remove** are one click away
inside the row. Channels with no environment variable set wait behind a single
"show the ones that are not set up" row, unless the filter is asking for them.

**Settings → Data** also carries the one maintenance job a SQLite file needs
(roadmap 6.13): **Check and compact** runs `PRAGMA integrity_check` and then
`VACUUM`, and reports the bytes it returned beside what the database weighs now.
The order is deliberate — a file whose pages are already wrong is reported, not
rewritten — and nothing is ever deleted: the daily prune is what removes rows
past the retention window, and this is what gives their pages back.

**Settings → Data → Check for updates** (roadmap 15.11a) is a **check for
updates**, off by default. Switched on, it reads GHCR's public tag list for
this project's UI image once a day — at most once a day per running process,
including a check at boot — and compares the newest `ui-v<semver>` tag it
finds against the version this process was built at; tags that are not
semver (`ui-latest`, `latest`, …) are ignored. If a newer tag exists, a
"`<version>` available" badge appears next to the setting; if this instance is
already on the newest tag, nothing changes on screen. Only reading the tag
list leaves the machine — no automatic download, no automatic install, and
nothing beyond the request itself: no configured provider, no count, no
instance identifier and no header describing this instance travel with it,
only what a plain anonymous read of a public registry reveals to GitHub (this
instance's IP address and the time of the request). A network error, a
timeout or an answer that does not parse never surfaces as an error in the
dashboard and never sends a notification through any channel — the setting
just falls back to "last check didn't go through, retrying tomorrow", logged
at debug level on the server and otherwise silent.

Writes take effect on the **next poll cycle**, with no restart, because the
scheduler re-reads its configuration every pass. A fresh database starts with
no providers: the first-run wizard asks which ones to watch and sends a real test
notification (roadmap 4.5).

### 3.3 Environment variables

| Variable | Editions | Default | Purpose |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | both | — | Telegram bot token. Required if the Telegram channel is enabled. |
| `TELEGRAM_CHAT_ID` | both | — | Target chat. Required with the above. |
| `WEBHOOK_URL` | both | — | Where the generic webhook POSTs. Required if that channel is enabled. |
| `DISCORD_WEBHOOK_URL` | both | — | Discord incoming webhook. Required if the Discord channel is enabled. |
| `SLACK_WEBHOOK_URL` | both | — | Slack incoming webhook. Required if the Slack channel is enabled. |
| `NTFY_TOPIC_URL` | both | — | ntfy topic URL, server included (`https://ntfy.sh/my-topic`). Required if the ntfy channel is enabled. |
| `NTFY_TOKEN` | both | — | Optional ntfy access token. Only a server with access control needs one. |
| `GOTIFY_URL` | both | — | Gotify server (`https://gotify.example.com`). Required if the Gotify channel is enabled. |
| `GOTIFY_TOKEN` | both | — | Gotify application token. Required with the above. |
| `PUSHOVER_TOKEN` | both | — | Pushover application API token. Required if the Pushover channel is enabled. |
| `PUSHOVER_USER_KEY` | both | — | Pushover user or group key. Required with the above. |
| `PUSHOVER_DEVICE` | both | — | Optional. One registered device; unset delivers to every device on the account. |
| `TEAMS_WEBHOOK_URL` | both | — | Microsoft Teams channel webhook. Required if the Teams channel is enabled. |
| `MATRIX_HOMESERVER_URL` | both | — | Matrix homeserver root (`https://matrix.example.org`). Required if the Matrix channel is enabled. |
| `MATRIX_ROOM_ID` | both | — | Internal room id (`!ops:example.org`), not an alias. Required with the above. |
| `MATRIX_ACCESS_TOKEN` | both | — | Access token for the user that posts. Required with the above. |
| `PAGERDUTY_ROUTING_KEY` | both | — | Integration key of an Events API v2 integration. Required if the PagerDuty channel is enabled. |
| `PAGERDUTY_REGION` | both | — | Optional. `eu` for an account in PagerDuty's EU service region. |
| `OPSGENIE_API_KEY` | both | — | Opsgenie API integration key. Required if the Opsgenie channel is enabled. |
| `OPSGENIE_REGION` | both | — | Optional. `eu` for an account on Opsgenie's EU instance. |
| `APPRISE_SERVER_URL` | both | — | Apprise API server (`http://apprise:8000`). Required if the Apprise channel is enabled. |
| `APPRISE_CONFIG_KEY` | both | — | Key of a configuration the Apprise server stores. Either this or `APPRISE_URLS` is required. |
| `APPRISE_URLS` | both | — | Apprise service URLs, comma-separated, for a stateless server. Either this or `APPRISE_CONFIG_KEY` is required. |
| `SPLUNK_ONCALL_API_KEY` | both | — | Splunk On-Call REST endpoint API key. Required if that channel is enabled. |
| `SPLUNK_ONCALL_ROUTING_KEY` | both | — | The routing key that picks the escalation policy. Required with the above. |
| `SQUADCAST_WEBHOOK_URL` | both | — | Squadcast Incident Webhook URL. Required if that channel is enabled. |
| `ZENDUTY_INTEGRATION_KEY` | both | — | Zenduty API integration key. Required if that channel is enabled. |
| `INCIDENT_IO_ALERT_SOURCE_ID` | both | — | incident.io HTTP alert source config id. Required if that channel is enabled. |
| `INCIDENT_IO_TOKEN` | both | — | That alert source's bearer token. Required with the above. |
| `GRAFANA_ONCALL_WEBHOOK_URL` | both | — | Grafana OnCall Formatted Webhook URL. Required if that channel is enabled. |
| `MATTERMOST_URL` | both | — | Mattermost server (`https://chat.example.com`). Required if that channel is enabled. |
| `MATTERMOST_TOKEN` | both | — | A bot account's access token. Required with the above. |
| `MATTERMOST_CHANNEL_ID` | both | — | The channel's id, not its name. Required with the above. |
| `ROCKETCHAT_URL` | both | — | Rocket.Chat server. Required if that channel is enabled. |
| `ROCKETCHAT_USER_ID` | both | — | The bot user's id. Required with the above. |
| `ROCKETCHAT_TOKEN` | both | — | A personal access token of that user. Required with the above. |
| `ROCKETCHAT_ROOM_ID` | both | — | The room's id, not its `#name`. Required with the above. |
| `ZULIP_SITE_URL` | both | — | Zulip organisation (`https://example.zulipchat.com`). Required if that channel is enabled. |
| `ZULIP_BOT_EMAIL` | both | — | The bot's email address. Required with the above. |
| `ZULIP_API_KEY` | both | — | The bot's API key. Required with the above. |
| `ZULIP_STREAM` | both | — | The channel (stream) to post in. Required with the above. |
| `ZULIP_TOPIC` | both | — | Optional. One fixed topic; unset gives each provider a topic of its own. |
| `GOOGLE_CHAT_WEBHOOK_URL` | both | — | A Google Chat space's incoming webhook. Required if that channel is enabled. |
| `TWILIO_SMS_ACCOUNT_SID` | both | — | Twilio account SID (`AC…`) for SMS. Required if the SMS channel is enabled. |
| `TWILIO_SMS_AUTH_TOKEN` | both | — | That account's auth token. Required with the above. |
| `TWILIO_SMS_FROM` | both | — | The Twilio number to text from, E.164. Required with the above. |
| `TWILIO_SMS_TO` | both | — | The number to text, E.164. Required with the above. |
| `TWILIO_CALL_ACCOUNT_SID` | both | — | Twilio account SID for voice calls. Required if the call channel is enabled. Its own variable, even for the same account: two channels never share one. |
| `TWILIO_CALL_AUTH_TOKEN` | both | — | That account's auth token. Required with the above. |
| `TWILIO_CALL_FROM` | both | — | The Twilio number to call from, E.164. Required with the above. |
| `TWILIO_CALL_TO` | both | — | The number to call, E.164. Required with the above. |
| `BARK_DEVICE_KEY` | both | — | The device key the Bark iOS app shows. Required if that channel is enabled. |
| `BARK_SERVER_URL` | both | — | Optional. A self-hosted bark-server; unset uses `https://api.day.app`. |
| `SIGNAL_API_URL` | both | — | A signal-cli-rest-api server (`http://signal-api:8080`). Required if that channel is enabled. |
| `SIGNAL_NUMBER` | both | — | The registered number messages are sent from, E.164. Required with the above. |
| `SIGNAL_RECIPIENTS` | both | — | Numbers or `group.…` ids, comma-separated. Required with the above. |
| `SYSLOG_URL` | both | — | `udp://host:514`, `tcp://host:601` or `tls://host:6514`. Required if that channel is enabled. |
| `SYSLOG_FACILITY` | both | `local0` | Optional. `local0` to `local7`. |
| `MQTT_BROKER_URL` | both | — | `mqtt://broker:1883`, or `mqtts://` for TLS. Required if that channel is enabled. |
| `MQTT_TOPIC` | both | `isitdown` | Optional. Topic prefix; messages go to `<prefix>/<provider>`. |
| `MQTT_USERNAME` | both | — | Optional. Only for a broker that wants credentials. |
| `MQTT_PASSWORD` | both | — | Optional. Sent only with a user name. |
| `MASTODON_INSTANCE_URL` | both | — | Mastodon instance (`https://mastodon.social`). Required if that channel is enabled. |
| `MASTODON_ACCESS_TOKEN` | both | — | An application token with `write:statuses`. Required with the above. |
| `MASTODON_VISIBILITY` | both | `public` | Optional. `public`, `unlisted` or `private`. |
| `BLUESKY_HANDLE` | both | — | The account's handle. Required if that channel is enabled. |
| `BLUESKY_APP_PASSWORD` | both | — | An app password, never the account's own. Required with the above. |
| `BLUESKY_SERVICE_URL` | both | `https://bsky.social` | Optional. The account's PDS. |
| `WEBHOOK_SECRET` | both | — | Optional shared secret for the generic webhook. Set it and every request is signed (see [3.6](#36-notification-channels)); leave it unset and requests go out unsigned, exactly as before. |
| `LOG_LEVEL` | both | `info` | `debug` · `info` · `warn` · `error`. |
| `PLUGINS_DIR` | both | — | A directory of adapter plugins to load at boot ([3.14](#314-adapter-plugins)). Unset — the default, in the images too — loads nothing. **A plugin runs with this process's own privileges.** |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | both | — | An OTLP/HTTP collector base URL; `/v1/traces` is appended. Setting it turns tracing on ([3.16](#316-traces)). Unset, nothing is traced and nothing is allocated. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | both | — | The traces endpoint exactly, when it is not `<base>/v1/traces`. Wins over the variable above. |
| `OTEL_EXPORTER_OTLP_HEADERS` | both | — | `key=value,other=value` — an API key a hosted collector wants. |
| `OTEL_SERVICE_NAME` | both | `isitdown` | What the collector labels this process. |
| `OUTPOSTS` | both | — | Outposts to ask for a second reading of every probe, comma-separated base URLs (`https://vps-1.example.com:8080`) — roadmap 1.7, see [Docker §4.7](docker.md#47-outposts--a-second-point-of-view-for-probes). Unset — the default — leaves every probe this container's reading alone. |
| `OUTPOST_TOKEN` | both, outpost | — | The bearer token every outpost was started with. Required beside `OUTPOSTS`; an outpost refuses to start without one. |
| `LOG_FILE` | both | — | Also append every log line to this file, rotated by size. Unset, logs go to stdout only. |
| `LOG_MAX_BYTES` | both | `5242880` | Size at which `LOG_FILE` rotates. |
| `LOG_MAX_FILES` | both | `5` | How many rotated generations (`.1` … `.5`) survive beside the live file. |
| `CONFIG_PATH` | Light | `/app/config/config.yml` | Where to read `config.yml`. |
| `DATA_PATH` | Light | `/app/data/state.json` | Where to keep the state file. |
| `DB_PATH` | UI | `/app/data/isitdown.db` | SQLite database. |
| `API_TOKEN` | UI | — | A read-only bearer token ([3.12](#312-reaching-the-api-from-another-host)). Unset — the default — leaves every route open, which is right for an instance bound to `127.0.0.1`. Set it and a request carrying it may `GET` from any host; writes stay local-only. |
| `API_LOCAL_BYPASS` | UI | `true` | Whether a request from this machine may skip `API_TOKEN`. Set it to `false` behind a reverse proxy, where every forwarded request looks local. |
| `ALLOWED_HOSTS` | UI | — | Comma-separated extra hostnames the dashboard may be served under (for example a reverse proxy's name). A write whose `Origin` or `Host` is neither the dashboard's own, `localhost` nor an IP literal is refused with `403`. No wildcard. |
| `TELEGRAM_CHATOPS` | UI | `false` | Set it to `true` to let the Telegram bot take commands as well as send alerts ([3.17](#317-chatops--commanding-the-bot-from-telegram)). Off by default: an inbound command channel is something you opt into. |
| `TELEGRAM_COMMAND_CHAT_IDS` | UI | — | Extra chat ids allowed to command the bot, comma-separated. The chat the Telegram channel already sends to is always allowed; this is for an installation alerted in one chat and commanded from another. |
| `PUBLIC_PAGE` | UI | `false` | Set it to `true` to publish a read-only status page at `/public` ([3.18](#318-the-public-status-page)). Off by default — it is the one surface strangers can read. |
| `PUBLIC_PAGE_TITLE` | UI | `Service status` | The heading and the browser title of that page. |
| `PUBLIC_PAGE_PROVIDERS` | UI | — | Which providers to publish, comma-separated by id. Unset publishes every enabled provider. A visitor cannot widen this: the page takes no request input at all. |
| `PUBLIC_PAGE_LOCALE` | UI | — | The language that page is written in. Unset follows the installation's own notification locale. |
| `PUSH_TOKEN` | UI | — | Turns on the provider-webhook endpoint ([3.15](#315-provider-push-instead-of-poll)) and is the credential in its URL. Unset, that route answers `404`. |
| `HEARTBEAT_TOKEN` | UI | — | Turns on the heartbeat ping endpoint ([3.19](#319-heartbeats--the-dead-mans-switch)) and is the credential in its URL. Unset, that route answers `404`. |
| `OUTBOUND_BLOCK_PRIVATE` | both | unset | `true` makes probes and status-page reads refuse loopback and private-range targets (and redirects to them), on top of the link-local addresses that are always refused. Anything else leaves private targets allowed. |
| `BIND_HOST` | UI | `127.0.0.1` | The address the dashboard listens on. Loopback by default, which is what keeps an instance with no `API_TOKEN` reachable only from this machine; the container images set `0.0.0.0` (the compose `ports` mapping then decides who can reach it, and publishes on `127.0.0.1` only). To reach the dashboard from another machine, publish on `0.0.0.0` (or set `BIND_HOST` on bare metal) **and** set `API_TOKEN` — see [3.12](#312-reaching-the-api-from-another-host) for what a request off this machine may then do. |
| `PORT` | UI | `3000` | HTTP port. |

Secrets arrive through `env_file` at runtime; nothing is baked into an image.
`docker history` on either image shows no `ENV` layer carrying a value.

### 3.4 How secrets are handled

The rule is the same in both editions — **the environment is the only place a
secret exists** — but the mechanics differ.

**Light.** `config.yml` holds `${VAR}` references, resolved at load. An enabled
channel whose variable is unset is a fatal startup error that names the variable:

```
config file /app/config/config.yml: the telegram channel is enabled
but TELEGRAM_BOT_TOKEN is not set in the environment
```

**UI.** The `channels` table stores the *name* of the variable
(`botTokenEnv: "TELEGRAM_BOT_TOKEN"`), never a value, and the name is resolved at
load. A value can be *set* from the dashboard, which writes it to
`secrets.env` beside the database — mode `0600`, in the data volume, one
`NAME=value` per line — and into the server's own environment, so the channel
starts working on the next request with nothing to restart. Consequences worth
knowing:

- Settings shows the variable name, whether it currently resolves, and a
  write-only value field. The field always renders empty and `Clear` forgets a
  saved value; nothing reads one back.
- `PATCH /config/channels/:id` still **refuses** a request carrying a literal
  secret: values go to `PUT /config/channels/:id/secrets`, and the database is
  never offered one.
- A saved value overrides the same variable coming from `env_file` — it is the
  later, explicit instruction — and every takeover is logged at boot.
- `DELETE /config/channels/:id/secrets/:field` only forgets what the file itself
  holds; a variable the container supplied answers `409` rather than pretending.
  Forgetting an entry that had overridden an `env_file` value falls back to that
  value rather than leaving the channel with nothing.
- No API response, DOM node, log line or error message contains a resolved secret.
  Tests assert this.
- A channel enabled in the database whose variable is unset is skipped for that
  cycle with a warning, rather than crashing the dashboard — unlike Light, there
  is a UI in which an operator can see and fix it.

The dashboard therefore accepts a credential, as the design prototype drew, but
only one way: in.

### 3.5 Monitored providers

If `https://<domain>/api/v2/summary.json` returns JSON with `status` and
`incidents`, the provider runs Atlassian Statuspage and needs **no code** — just an
entry with `adapter: statuspage`. Verified:

| Provider | `baseUrl` |
|---|---|
| GitHub | `https://www.githubstatus.com` |
| Cloudflare | `https://www.cloudflarestatus.com` |
| Anthropic / Claude | `https://status.claude.com` |

`status.anthropic.com` issues a 301 to `status.claude.com`. The adapter follows
redirects so either works; the canonical host avoids the extra hop.

In the UI edition the add dialog asks this in two steps. The first asks only
where the status comes from, and offers the three ways of answering that: the
**bundled catalog**, a pasted URL, or an adapter picked by hand. The second is
the fields — name, group, poll interval, components — with the answer to the
first carried in at the top and everything adapter-specific folded under
**Advanced**. Editing an existing service stays one page: its adapter is fixed,
and what is left is tuning.

The catalog (roadmap 5.11) is a grid of well-known providers, searchable by
name, and one pick fills in the adapter, the base URL and the id. Since roadmap
2.1 it is a generated artifact rather than a hand-written list: a weekly job
(`tools/build-catalog.mjs`, see [9.4](development.md#94-tests-and-checks)) reads a curated
seed and the public lists of status pages, runs every candidate through the
same detection the dashboard uses, then reads it once through its adapter, and
keeps only what answered — about two hundred providers, in
`src/adapters/catalog.json`. So what the grid offers is what an adapter actually
reads. Providers whose
status page refuses an automated read (Stripe, GitLab, Zendesk, Okta) are
deliberately absent rather than listed and broken — for those, and for anything
else the list does not have, paste the URL and let detection
(`POST /config/services/detect`) name the adapter. An entry already watched stays
in the grid, dimmed, rather than disappearing from it. Served as
`GET /config/catalog`.

**Catalog updates** (roadmap 2.2, **Settings → Data → Update the provider
catalog**, off by default) keep that list current without a new image. Switched
on, the UI edition downloads `catalog/catalog.json` from the project's `main`
branch once a day — and once straight away when the switch is turned on — and
checks its Ed25519 signature against the public key compiled into the build. A
list whose signature does not match, that is not a catalog, or that is no newer
than the one the image shipped is ignored; rows naming an adapter this build
does not have are dropped. The last good copy is kept in the database, so a
restart does not fall back. The request carries nothing about this instance
beyond what any anonymous read of GitHub reveals (its IP address and the time).

A downloaded list never changes a configured provider by itself. When a provider
you watch has the id of a catalog entry whose adapter or URL now differs —
"GitHub moved its status page" — the setting lists it with **Update** and
**Keep mine**. Update is an ordinary service edit; Keep mine remembers that
exact value, so you are asked again only if the catalog moves a second time.

**Finding providers from a project** (roadmap 2.3). `isitdown discover <path>`
([10.2](cli.md#102-isitdown-discover)) reads a project's `package.json`, compose
files, Dockerfiles, `.env`, Terraform, `requirements.txt`, `pyproject.toml`,
`go.mod` or a hosts file and proposes the catalog providers it depends on, each
with the line that gave it away; `--yaml` prints a `services:` block for
`config.yml`. The UI edition answers the same question at `POST /config/discover`.

The provider's own `status.indicator` maps onto the internal severity model:

| Statuspage indicator | IsItDown status |
|---|---|
| `none` | `operational` |
| `minor` | `degraded` |
| `major` | `partial_outage` |
| `critical` | `major_outage` |
| unrecognised | `major_outage` — never silently downgraded |
| absent | `unknown` |

An incident is *active* unless its status is `resolved` or `postmortem`.
`scheduled_maintenances` is read separately: a declared window is not a severity,
it silences the provider's alerts while it runs.

Note that a provider can report `degraded` with **zero** open incidents — Statuspage
derives the indicator from component state too. A degraded status grid alongside an
empty Incidents view is correct, not a bug.

#### Watching only part of a provider

A provider can expose hundreds of components: Cloudflare lists every data centre,
grouped by region (Africa, Asia, Europe, …). Select the components that matter and
tick **Report only the selected components** — `scopeToComponents: true` in the Light
edition's `config.yml` — to narrow the whole provider to that selection:

- an incident the provider attributes only to components outside the selection is
  dropped, so it neither notifies nor reaches the charts and the timeline;
- the provider's reported status becomes the worst status among the selected
  components instead of the page-wide `status.indicator`;
- an incident attached to no component at all is a page-wide notice and is always
  reported;
- with nothing selected the flag does nothing: scoping to an empty selection would
  mean silencing the provider.

Each group header in the picker carries its own checkbox, so a whole region is one
click.

#### The RSS / Atom adapter

A large tail of status pages publish a feed and nothing else. `adapter: rss`
reads any of them, with no code per provider:

```yaml
  - id: example
    name: Example
    adapter: rss
    baseUrl: https://status.example.com/history.rss
```

`baseUrl` **is the feed URL** — this adapter appends nothing to it.

A feed announces incidents; it never states an overall status, so the status is
derived, and the derivation is deliberately pessimistic — an entry that cannot be
dated or classified reads as trouble, never as recovery:

| Feed entry | Reading |
|---|---|
| Published in the last 24 hours, no closing word | An open incident |
| Says `resolved`, `completed`, `restored`, `closed` | Closed, whatever else it says |
| Older than 24 hours | No longer current |
| No date at all | Treated as current |
| No `guid`, `id` or `link` | Dropped: nothing stable to key the incident on |

Severity comes from the provider's own wording — `partial` → partial outage;
`outage`, `down`, `offline`, `unavailable`, `unreachable` → major outage;
anything else the provider bothered to announce → degraded.

Two consequences worth knowing before relying on it: the adapter offers no
component listing, because a feed has no components; and its incident history
never claims to be complete, because a feed is a window onto a history rather
than the history itself.

#### The IMAP adapter — the vendor's own email

Some vendors publish no status page anything can read and announce trouble by
mailing their customers. `adapter: imap` reads those notices out of a mailbox
(roadmap 1.4) — give it one that receives only vendor notices, a dedicated
address or a folder a mail rule files them into:

```yaml
  - id: acme-mail
    name: Acme (mail)
    adapter: imap
    baseUrl: https://imap.example.com     # the mail server; the scheme is ignored
    crossChecks: acme                     # optional: Acme's own page, see below
    options:
      user: ${ACME_IMAP_USER}
      passwordEnv: ACME_IMAP_PASSWORD     # the variable's name, never the password
      from: status@acme.example, acme.example
      mailbox: Vendors/Acme
```

| Option | Default | Meaning |
|---|---|---|
| `user` | — | Required. The mailbox login, as is or as a `${VAR}` reference. |
| `passwordEnv` | — | Required. The **name** of the environment variable holding the password. A `password` option is refused outright: the secret never sits in `config.yml` or in a settings export. A name rather than `${VAR}` because the Light edition resolves every `${VAR}` at load, after which the adapter could no longer tell a reference from a password typed in place. |
| `from` | — | Required. Sender addresses or domains, comma-separated; mail from anyone else is ignored. |
| `subject` | — | Words, comma-separated: only subjects containing one of them count. Unset reads every mail from the sender. |
| `mailbox` | `INBOX` | The folder to read. |
| `port` | `993`, or `143` with `tls: no` | |
| `tls` | `yes` | Implicit TLS. `no` only for a bridge or relay on the loopback — the login would otherwise cross the network in clear. |
| `windowHours` | `24` | How long an announcement counts as open when no mail closes it. |

The mailbox is opened **read-only** (`EXAMINE`, headers fetched with
`BODY.PEEK`): nothing is marked seen, moved or deleted, so a person reading the
same folder by hand sees it untouched. Each poll reads the From, Subject and
Date of the mail received in the window — the newest 200 at most — and nothing
else.

Mail is read the way the RSS adapter reads entries, with one improvement: mails
about one incident are grouped into a thread, by subject with reply prefixes,
`[tags]` and lifecycle words (`investigating`, `update`, `resolved`, …) left out,
so "[Acme] Resolved: API errors" closes "[Acme] Investigating: API errors".

| Latest mail of a thread | Reading |
|---|---|
| Received within `windowHours`, no closing word | An open incident |
| Says `resolved`, `completed`, `restored`, `closed`, `fixed` | Closed |
| Older than `windowHours` | No longer current |
| No date at all | Treated as current |

Severity comes from the subject's wording, as for a feed. An unreachable
server, a refused login or a missing mailbox is a **failed read**, not an
outage: it means IsItDown cannot see the mailbox, which says nothing about the
vendor.

With `crossChecks` naming the vendor's page, a mail announcing trouble while the
page still says operational becomes that page's **suspected status** (roadmap
1.3, [how it works §7.9](how-it-works.md#79-suspected-status)) and a single
silent-outage alert, exactly as a probe's reading does — the mail's subject is
the note shown beside it. Without `crossChecks` the mailbox is simply the
provider's status, for a vendor no other adapter can reach.

#### Slack adapter

Slack publishes its own small JSON API instead of running on Statuspage, so it
gets its own adapter:

```yaml
  - id: slack
    name: Slack
    adapter: slack
    baseUrl: https://slack-status.com
```

`baseUrl` is the host; the adapter appends `/api/v2.0.0/current` for what is
open now and `/api/v2.0.0/history` for the timeline. (`https://status.slack.com`
redirects there and works too.)

The payload carries no severity field — an incident is a title, a lifecycle word
and a list of affected service names — so severity is read from Slack's own
wording, exactly as the feed adapter does it. What that produces:

| Payload | Reading |
|---|---|
| `active_incidents` empty | Operational |
| An entry of `type: notice` | Listed as an incident, but does not move the provider's status on its own |
| Top-level `status: ok` with an entry still open | Trouble: the incident list is the dial, not the word |
| An entry with no `id` | Dropped: nothing stable to key the incident on |

Slack names the affected services on an incident but publishes no per-service
status list, so the adapter offers no component listing; and it exposes no
scheduled-maintenance data, so an entry announcing one stays an incident rather
than becoming a window that would silence the provider while it sat there.

#### AWS, Google Cloud and Azure

The three hyperscalers publish nothing Statuspage-shaped, and each is odd in its
own way, so each gets its own adapter:

```yaml
  - id: aws
    name: AWS
    adapter: aws
    baseUrl: https://health.aws.amazon.com
    options:
      regions: eu-west-1       # optional; omit to watch every region (see below)

  - id: gcp
    name: Google Cloud
    adapter: gcp
    baseUrl: https://status.cloud.google.com

  - id: azure
    name: Azure
    adapter: azure
    baseUrl: https://azure.status.microsoft
    options:
      locale: en-us            # optional; the feed is published per locale
```

**AWS** — the adapter appends `/public/currentevents`, a document of the events
open right now. Two things follow from that. There is no history to backfill
from, because a resolved event drops out of the document rather than being
marked closed; and every event is scoped to one region, so `options.regions`
narrows it to yours (see below). A global event — one the feed publishes with no region at
all — is always reported, since narrowing must not hide the class of event that
hits everything. Severity is AWS's own numeric code, not a guess from wording:

| Code | Reading |
|---|---|
| `0` | Closed; drops out rather than keeping a recovered region red |
| `1` | Informational: listed as an incident, does not move the status |
| `2` | Degraded |
| `3` | Major outage |
| anything else | Major outage — never silently downgraded |

The document is served as UTF-16, which `fetch`'s own `text()` decodes as UTF-8
and mangles; IsItDown decodes by the charset the response declared.

**Google Cloud** — the adapter appends `/incidents.json`, one flat list that is
both the current state and the history: an incident with no `end` is open, and
the provider's status is whatever the open ones add up to. Severity comes from
`status_impact` (`SERVICE_INFORMATION` → an announcement that does not move the
status, `SERVICE_DISRUPTION` → partial outage, `SERVICE_OUTAGE` → major outage,
anything unrecognised → major outage) rather than from the `severity` word beside
it, which disagrees with it.

**Azure** — the machine-readable half of `azure.status.microsoft` is an RSS
feed, so this adapter reads the feed at `/<locale>/status/feed/` and adds the
two things the generic feed adapter gets wrong about Azure: it knows
"mitigated" ends an incident, and it knows the feed is *empty* while Azure is
healthy, so an empty feed is operational rather than unknown. Its incident
history reaches only as far as the feed does, which for a provider that
publishes open communications only is not far.

**Narrowing to your regions and services** (roadmap 2.8). All three feeds
cover every region on earth, and an incident in `ap-south-1` is noise to a
fleet in Frankfurt. The same two options on `aws`, `gcp` and `azure`, both
comma-separated:

```yaml
    options:
      regions: eu-west-1, eu-central-1      # aws; gcp: europe-west1; azure: westeurope
      services: EC2, S3                     # optional
```

| Option | Matched against |
|---|---|
| `regions` | AWS: the event's region (`eu-west-1`). Google Cloud: the incident's affected location ids (`europe-west1`) — for a resolved one, the places it affected. Azure: the region at the end of the entry's title (`West Europe`). Compared with case, spaces and dashes folded away, so `westeurope` and `West Europe` are the same region. AWS's older `region` is still read when `regions` is absent. |
| `services` | AWS: the service's name (`Amazon Simple Storage Service`) or its short key (`s3`). Google Cloud: the affected products (`Cloud Storage`). Azure: the services named in the title (`Virtual Machines`). Folded the same way. |

An incident the feed places nowhere — global, "multiple regions", or simply
unlabelled — always passes the region filter, and one that names no service, or
"multiple services", always passes the service filter: those are exactly the
incidents a narrowing must not hide. Google Cloud's and Azure's incident
timelines are narrowed by the same rule.

#### Instatus and Better Stack

The two most common Statuspage competitors, each with one unauthenticated JSON
endpoint of its own:

```yaml
  - id: gcore
    name: Gcore
    adapter: instatus
    baseUrl: https://status.gcore.com

  - id: betterstack
    name: Better Stack
    adapter: betterstack
    baseUrl: https://status.betterstack.com
```

**Instatus** — the adapter appends `/summary.json` for the page's own word plus
its open incidents and declared maintenance windows, and `/v3/components.json`
for the component list. The second request is only made when the provider has
components selected: a provider nobody picked components for must not pay two
requests a cycle for a list nothing reads.

| Payload | Reading |
|---|---|
| `page.status: UP`, nothing open | Operational |
| An incident's `impact` | `DEGRADEDPERFORMANCE` → degraded, `PARTIALOUTAGE` → partial outage, `MAJOROUTAGE` → major outage |
| `page.status: HASISSUES` with nothing listed | Degraded: a page that has not published the incident yet must not read as calm |
| `page.status: UNDERMAINTENANCE` | Unknown — it abstains rather than claiming to be up |
| An impact word we do not know | Major outage; never silently downgraded |
| `activeMaintenances[].duration` | Minutes, so the window's end is derived from it — Instatus publishes no end timestamp |

`summary.json` does not attribute an incident to the components it affects, so
`scopeToComponents` narrows the reported components and the status folded from
them, but never drops an incident. And Instatus publishes no JSON incident
history, so there is nothing to backfill from — a page's RSS feed can be added
as a second provider on the `rss` adapter if you want its timeline.

**Better Stack** — the adapter appends `/index.json`, and that one document is
the whole page: the aggregate state, every resource (their word for a
component) with its own status, every report — theirs for both incidents and
scheduled maintenance — and every update posted on those. So components,
component scoping *including* incident attribution, and the incident history all
come out of a single read.

| Payload | Reading |
|---|---|
| `aggregate_state` | `operational`, `degraded` → degraded, `downtime` → major outage |
| `maintenance` or `not_monitored` | Unknown — abstains rather than reading as a recovery |
| A report with `report_type: manual` not in state `resolved` | An open incident |
| A report with `report_type: maintenance` | A maintenance window, not an incident |
| A report's `ends_at` | Often null even once resolved — Better Stack closes one by state — so the newest update on the report is the closure time |

Sorry™, the third page in this family, publishes no unauthenticated JSON at all:
its public pages are HTML and its API needs a key, so it needs the generic
HTML-scrape adapter (roadmap 1.6) rather than a small parser of its own.

#### Cachet, Uptime Kuma and Uptime.com

Three more small JSON shapes, and the first two are the ones this project's own
audience self-hosts — a fleet can include the status page next door:

```yaml
  - id: neighbour
    name: The neighbour's Cachet
    adapter: cachet
    baseUrl: https://status.neighbour.example

  - id: homelab
    name: Homelab
    adapter: uptimekuma
    baseUrl: https://uptime.example.com/status/demo

  - id: uptimecom
    name: Uptime.com
    adapter: uptimecom
    baseUrl: https://status.uptime.com/statuspage/uptime-status
```

**Cachet** — three reads per cycle, because Cachet publishes the three halves of
a status page in three documents and none stands in for another:
`/api/v1/components`, `/api/v1/incidents` and `/api/v1/schedules`. They
revalidate with `ETag` like every other read here, so a quiet cycle is three
`304`s. Cachet has no aggregate word — `/api/v1/status` answers a three-way
`success`/`info`/`danger` that cannot tell a partial outage from a major one —
so the reading is folded from the components, which is also what a scoped
provider is folded from.

| Payload | Reading |
|---|---|
| A component's `status` | `1` operational, `2` → degraded, `3` → partial outage, `4` → major outage |
| A number we do not know | Major outage; never silently downgraded |
| `enabled: false` | Not part of the reading: a disabled component is not on the page |
| An incident's `is_resolved` | Open until it is true; a Cachet too old to publish it closes on a `Fixed` update instead |
| `component_id: 0` | A page-wide incident, which reaches a scoped provider too |
| A schedule | A maintenance window; `status: 2` (completed) is dropped |
| A timestamp | Written with no zone at all, so it is read as UTC — which is what a container install runs on |

Every list is asked for at the API's ceiling of 100 rows: an instance with more
than 100 components is read as its first hundred, rather than walking the
pagination on every cycle. The component picker resolves group names from
`/api/v1/components/groups`, which only the dashboard ever fetches.

**Uptime Kuma** — a prober rather than a page someone writes, so it publishes no
aggregate word either. Two reads per cycle, both needed: the status page document
names the monitors and never says how they are doing, and the heartbeat document
says how they are doing and never names them. Give the page URL as you see it in
the browser (`…/status/<slug>`) and the slug is read out of it; a bare host reads
Kuma's own `default` page, and `options.slug` overrides either.

| Payload | Reading |
|---|---|
| A monitor's newest beat | `1` operational, `0` → major outage, `2` (retrying) → degraded, `3` (maintenance) → unknown |
| Every monitor up | Operational |
| Some up, some down | Partial outage — Kuma's own header rule, not a worst-of, so one monitor down out of ten does not read as a major outage |
| Every monitor down | Major outage |
| No beat at all, or all abstaining | Unknown |
| The pinned incident (`incident`, or `incidents` on 2.x) | One open incident carrying Kuma's own `style` word |
| `maintenanceList[]` | A window, placed on the clock with the entry's own `timezoneOffset`; it does not say which monitors it covers |

There is no incident history to backfill from: a Kuma page publishes beats and
one pinned notice, and nothing that amounts to a closed incident with a start and
an end.

**Uptime.com** — the page is server-rendered and the payload it is rendered from
is served as JSON beside it: `<page>/ajax` for the current state, `<page>/history`
for the closed incidents. Both answer inside a `{ error, fields, data }`
envelope. The base URL is the status page itself rather than the host, because an
account can publish several at `/statuspage/<slug>` each.

| Payload | Reading |
|---|---|
| A component's `status` | `operational`, `degraded-performance` → degraded, `partial-outage`, `major-outage`; punctuation and case are ignored |
| `under-maintenance` | Unknown — abstains rather than claiming to be up |
| A group | Read through its subcomponents, never twice: a group's status is a summary of exactly those |
| `global_is_operational: false` | Raises an otherwise operational reading to degraded — a page can carry an incident that has moved no component — but never lowers one |
| `incident_type: INCIDENT` | An open incident |
| `incident_type: SCHEDULED_MAINTENANCE`, or `upcoming_maintenance[]` | A maintenance window, not an incident |
| An incident's state | `latest_update_incident_state`, or the newest update's own state — the two endpoints fill in different ones |

Freshstatus, the fourth page considered for this family, is not readable without
credentials: its pages render client-side and its public API answers `403` to
anything but its own front end, so it needs the HTML-scrape adapter rather than a
parser of its own.

**Generic JSON (`json`)** — roadmap 11.1, and the thing to try before writing
code. An enormous number of status pages serve perfectly good JSON in a shape
nobody standardised: the data is stable and complete, and the only thing missing
is somebody to say which field means what. That is what this adapter takes.

```yaml
services:
  - name: Acme Cloud
    id: acme
    adapter: json
    baseUrl: https://status.acme.example
    options:
      path: /api/status
      statusPath: service.state
      statusMap: '{"UP":"operational","DEGRADED":"degraded","PARTIAL":"partial_outage","DOWN":"major_outage"}'
      incidentsPath: events
      incidentId: ref
      incidentName: title
      incidentStatus: phase
      incidentImpact: severity
      incidentUpdatedAt: changedAt
```

| Option | Meaning |
|---|---|
| `path` | Appended to `baseUrl`. Omit when the base URL is already the document. |
| `statusPath` | Where the overall status word is. **Required.** |
| `statusMap` | A JSON object mapping the provider's words to `operational`, `degraded`, `partial_outage`, `major_outage` or `unknown`. **Required.** Matching ignores case and surrounding space. |
| `incidentsPath` | An array of open incidents. Omit for a page that publishes a status and nothing else. |
| `incidentName` | The title, *within one entry*. Required whenever `incidentsPath` is set: an entry with no name is a blank row on the timeline, so one is dropped rather than shown. |
| `incidentId`, `incidentStatus`, `incidentImpact`, `incidentUpdatedAt` | The rest of one entry. Optional; an entry with no id of its own is identified by its position, so two reads agree about which incident is which. |

A **path** is names, dots, and `[n]` for an array index — `page.status`,
`components[0].state`. Deliberately not JSONPath: a path here is a lookup, and an
expression language is a surface with filters, wildcards and eventually a parser
of its own to maintain. A page that needs more than a lookup needs an adapter.

Two behaviours worth knowing. A status word the table does not cover reads
`unknown` rather than being guessed at by the word-matching heuristic the feed
adapter uses: the operator has described this provider's vocabulary, and a gap in
it is a thing to be *told* about. And a page reporting `operational` while
listing an open incident reads `degraded` — it is a page mid-update, and
reporting the calmer of the two would be reporting the one already known to be
out of date.

The mapping is validated when it is **saved**, not when it is read: `POST`/`PATCH
/config/services` answers `400` naming each problem, and `isitdown check` reports
them as errors. A typo in a path is a thing to fix while still looking at the
field it was typed into.

For a provider none of these fit, add an adapter under `src/adapters/`.

#### Other status platforms, other instances, and developer signals

Roadmap 2.11, 2.12 and 2.13. Each is one adapter; all but `registry` read through
the same conditional-request path as a status page, so `header.<Name>` and
`tokenEnv` work on them (see *Private and authenticated sources*).

| `adapter` | Base URL | Options | Reads |
|---|---|---|---|
| `isitdown` | The other instance's origin, `https://status.friend.example` | `provider` — one of its provider ids | Its `GET /status`: the providers become the components, the status is the worst of them |
| `upptime` | The repository, `https://github.com/owner/repo` | `branch` (default `HEAD`) | `history/summary.json`, one site per component |
| `statusio` | The endpoint, `https://api.status.io/1.0/status/<page id>` — or the host plus `pageId` | `pageId` | The public status API: overall code, components, incidents, maintenance |
| `githubactions` | The repository, `https://github.com/owner/repo` | `workflow` (a file name), `branch`, `apiBase` (Enterprise) | The newest *completed* run |
| `openstatus` | The page, `https://acme.openstatus.dev` | `slug` (default: the host's first label), `apiBase` | `GET /public/status/<slug>`: the overall word only |
| `sorry` | The page, `https://status.example.com` | — | `/api/v1/status`, `/components`, `/notices` |
| `cstate` | The page, `https://status.example.com` | — | `index.json` (cState API v2.0) |
| `registry` | The API origin: `https://registry.npmjs.org`, `https://pypi.org`, `https://hub.docker.com`, `https://crates.io`, `https://data.jsdelivr.com`, `https://api.cdnjs.com`, `https://unpkg.com` | `registry` (`npm`, `pypi`, `dockerhub`, `crates`, `jsdelivr`, `cdnjs`, `unpkg`) and `package`, both required; `pinned` | The metadata of a real package |

**`isitdown` — federation.** No new protocol: a peer already publishes `/status`
in the vocabulary this reads. The composite is the worst of the peer's *enabled*
providers (`unknown` abstains, the rule the dashboard's groups use), its open
incidents and maintenance windows come through prefixed with the provider's name,
and `scopeToComponents` folds only the providers you ticked. A peer provider that
disappears reads `unknown`, never operational. The peer's `/status` has to be
reachable from here: behind a reverse proxy, pass the credential as
`header.Authorization` or `tokenEnv`. The base URL is treated as private on the
public page, since it is usually yours.

**`upptime`** reads the repository's committed summary from
`raw.githubusercontent.com`. `up` is operational, `degraded` degraded, `down` a
major outage; the page is folded like Uptime Kuma's (some down is a *partial*
outage, all down a major one). Upptime keeps outages as GitHub issues, not in the
summary, so no incident is reported. 
**`openstatus`** reads the one word OpenStatus publishes at
`api.openstatus.dev/public/status/<slug>` (`operational`, `degraded_performance`,
`partial_outage`, `major_outage`, `incident`, `under_maintenance`); the public
endpoint has no components or incidents, so none are reported.

**`sorry`** reads a Sorry™ page's public API. Its three words map as
`operational`, `partially-degraded` degraded and `degraded` a partial outage. An
open `unplanned` notice is an incident and a `planned` one that is not complete or
cancelled a maintenance window; `general` notices are announcements and are
ignored.

**`cstate`** reads the Hugo-built page's `index.json`: `ok`, `disrupted`, `down`
per system and for the page. Systems are the components, named by name, and the
issues they list as unresolved are the incidents.

**incident.io** needs no adapter: its pages serve Statuspage's own
`/api/v2/summary.json`, so `statuspage` (and auto-detect) reads them. The same
holds for an Atlassian Statuspage *audience-specific* page — pass the credential
as `header.<Name>` or `tokenEnv`, the `statuspage` adapter sends it.

**Not covered, and why.** Hund.io has only an authenticated management API whose
status fields could not be checked against a real page; StatusCast and Statusfy
publish no documented public status endpoint. A page of any of them is still
readable with the generic `json` mapping, `rss` or `html` adapters.
**`statusio`** maps Status.io's own codes: 100 operational, 200 planned
maintenance (abstains), 300 degraded, 400 partial disruption, 500 disruption, 600
security event (partial). An unknown code reads as a major outage. The page id is
not in the page's public URL — copy it from the page's *API* tab.

**`githubactions`** turns "main is red" into a status. `success` is operational;
`failure` and `timed_out` a major outage; `action_required` and `startup_failure`
degraded; `cancelled`, `skipped` and `neutral` abstain. A failed run is reported as
one incident naming the run. The unauthenticated API allows 60 requests an hour
per address — give it `tokenEnv` when more than a couple of repositories are
watched. 

**`registry`** is a probe (`intervalSeconds` works): it asks the registry or CDN
for the metadata of a package you depend on, so a front page that loads while the API
returns 502 still reads down. A 2xx with a JSON body is operational; a 404 or a
2xx that is not metadata is degraded (the registry answered, the package is yours
to look at); a 429 abstains; anything else, including no answer, is a major outage. With `pinned` (`1` or
`1.4.2`) a *newer major release* than the pin reads degraded and opens one
incident — "left-pad 2.0.0 is out, you pin 1.4.2" — which is the release signal:
not downtime, but a breaking change to hear about. It clears when the pin is
raised. Docker Hub has no version to compare and refuses `pinned`.

```yaml
services:
  - id: friend-lab
    name: Friend's homelab
    adapter: isitdown
    baseUrl: https://status.friend.example
  - id: npm
    name: npm registry
    adapter: registry
    baseUrl: https://registry.npmjs.org
    options: { registry: npm, package: left-pad }
  - id: ci
    name: CI on main
    adapter: githubactions
    baseUrl: https://github.com/owner/repo
    options: { workflow: ci.yml, branch: main, tokenEnv: GITHUB_TOKEN }
```

#### Private and authenticated sources

Every adapter that reads a page over HTTP — all of them but the probes and
`imap` — can carry credentials, for a source that only answers somebody it knows:
Microsoft 365 Service Health on the Graph API, an authenticated Atlassian Cloud
page, Meraki, Zendesk, anything behind a token. Three shapes, set in the
provider's `options` and combinable:

| Option | What it sends |
|---|---|
| `header.<Name>` | One request header per option, exactly as on the `http` probe: `${VAR}` in the value is resolved from the environment at request time. Written last, so `header.Authorization` overrides the two below. |
| `tokenEnv` | `Authorization: Bearer <value>` — the *name* of the variable holding the token. |
| `oauthTokenUrl`, `oauthClientId`, `oauthClientSecretEnv`, `oauthScope` | OAuth 2.0 client credentials. The first three go together; `oauthScope` is optional. The token is requested on the first read, reused until a minute before it expires, and dropped on a `401`/`403` so the next read asks for a new one. |

A secret is only ever *named*: `tokenEnv` and `oauthClientSecretEnv` take a
variable's name, and an inline `token` or `oauthClientSecret` is refused when the
provider is saved (`400` from `POST`/`PATCH /config/services`, an error from
`isitdown check`), as are half an OAuth block and both `tokenEnv` and an OAuth
block at once. A variable that is unset when the read happens fails that read
with its name rather than sending an empty bearer and reporting the provider down
over a `401`. In the dashboard the fields sit under **Advanced → Credentials**.

Microsoft 365 Service Health for one tenant, through the generic JSON adapter above
and an app registration granted `ServiceHealth.Read.All`:

```yaml
services:
  - id: exchange-online
    name: Exchange Online
    adapter: json
    baseUrl: https://graph.microsoft.com/v1.0
    options:
      path: /admin/serviceAnnouncement/healthOverviews/Exchange%20Online
      statusPath: status
      statusMap: '{"serviceOperational":"operational","serviceRestored":"operational","investigating":"degraded","serviceDegradation":"degraded","restoringService":"partial_outage","extendedRecovery":"partial_outage","serviceInterruption":"major_outage"}'
      oauthTokenUrl: https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token
      oauthClientId: <application-id>
      oauthClientSecretEnv: M365_CLIENT_SECRET
      oauthScope: https://graph.microsoft.com/.default
```

#### Conditional requests

Every adapter reads through one HTTP helper that remembers the `ETag` (or
`Last-Modified`) a provider sent and offers it back on the next cycle. A page
that has not changed answers `304` with no body and the cached one is replayed,
which is most cycles: cheaper for the provider, and the difference between being
rate-limited and not on one with a tight budget. A `304` to a request that
carried no validator, a failed revalidation, or a page that stops sending
validators all drop the cache entry rather than pin a stale reading.

### 3.6 Notification channels

| Channel | Config key | Required variables |
|---|---|---|
| Telegram Bot API | `telegram` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| Generic webhook | `webhook` | `WEBHOOK_URL` |
| Discord | `discord` | `DISCORD_WEBHOOK_URL` |
| Slack | `slack` | `SLACK_WEBHOOK_URL` |
| ntfy | `ntfy` | `NTFY_TOPIC_URL` (`NTFY_TOKEN` optional) |
| Gotify | `gotify` | `GOTIFY_URL`, `GOTIFY_TOKEN` |
| Pushover | `pushover` | `PUSHOVER_TOKEN`, `PUSHOVER_USER_KEY` (`PUSHOVER_DEVICE` optional) |
| Microsoft Teams | `teams` | `TEAMS_WEBHOOK_URL` |
| Matrix | `matrix` | `MATRIX_HOMESERVER_URL`, `MATRIX_ROOM_ID`, `MATRIX_ACCESS_TOKEN` |
| PagerDuty | `pagerduty` | `PAGERDUTY_ROUTING_KEY` (`PAGERDUTY_REGION` optional) |
| Opsgenie | `opsgenie` | `OPSGENIE_API_KEY` (`OPSGENIE_REGION` optional) |
| Apprise | `apprise` | `APPRISE_SERVER_URL`, and one of `APPRISE_CONFIG_KEY` / `APPRISE_URLS` |
| Email (SMTP) | `email` | `SMTP_HOST`, `SMTP_FROM`, `SMTP_TO` (`SMTP_PORT`, `SMTP_SECURE`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_ALLOW_INSECURE_AUTH`, `SMTP_ALLOW_SELF_SIGNED` optional) |
| Splunk On-Call | `splunk-oncall` | `SPLUNK_ONCALL_API_KEY`, `SPLUNK_ONCALL_ROUTING_KEY` |
| Squadcast | `squadcast` | `SQUADCAST_WEBHOOK_URL` |
| Zenduty | `zenduty` | `ZENDUTY_INTEGRATION_KEY` |
| incident.io | `incident-io` | `INCIDENT_IO_ALERT_SOURCE_ID`, `INCIDENT_IO_TOKEN` |
| Grafana OnCall | `grafana-oncall` | `GRAFANA_ONCALL_WEBHOOK_URL` |
| Mattermost | `mattermost` | `MATTERMOST_URL`, `MATTERMOST_TOKEN`, `MATTERMOST_CHANNEL_ID` |
| Rocket.Chat | `rocketchat` | `ROCKETCHAT_URL`, `ROCKETCHAT_USER_ID`, `ROCKETCHAT_TOKEN`, `ROCKETCHAT_ROOM_ID` |
| Zulip | `zulip` | `ZULIP_SITE_URL`, `ZULIP_BOT_EMAIL`, `ZULIP_API_KEY`, `ZULIP_STREAM` (`ZULIP_TOPIC` optional) |
| Google Chat | `google-chat` | `GOOGLE_CHAT_WEBHOOK_URL` |
| SMS (Twilio) | `twilio-sms` | `TWILIO_SMS_ACCOUNT_SID`, `TWILIO_SMS_AUTH_TOKEN`, `TWILIO_SMS_FROM`, `TWILIO_SMS_TO` |
| Voice call (Twilio) | `twilio-call` | `TWILIO_CALL_ACCOUNT_SID`, `TWILIO_CALL_AUTH_TOKEN`, `TWILIO_CALL_FROM`, `TWILIO_CALL_TO` |
| Bark (iOS) | `bark` | `BARK_DEVICE_KEY` (`BARK_SERVER_URL` optional) |
| Signal | `signal` | `SIGNAL_API_URL`, `SIGNAL_NUMBER`, `SIGNAL_RECIPIENTS` |
| Syslog | `syslog` | `SYSLOG_URL` (`SYSLOG_FACILITY` optional) |
| MQTT | `mqtt` | `MQTT_BROKER_URL` (`MQTT_TOPIC`, `MQTT_USERNAME`, `MQTT_PASSWORD` optional) |
| Mastodon | `mastodon` | `MASTODON_INSTANCE_URL`, `MASTODON_ACCESS_TOKEN` (`MASTODON_VISIBILITY` optional) |
| Bluesky | `bluesky` | `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD` (`BLUESKY_SERVICE_URL` optional) |
| Desktop (Web Push) | `webpush` | none |

Desktop push needs nothing configured: the server generates its own VAPID key
pair the first time the channel is used and keeps it in the database, so
enabling the channel and pressing "enable on this browser" in Settings is the
whole setup. Each browser that is enabled appears in the card's device list and
can be removed from there.

The webhook POSTs `{ change, service, message }`, so a consumer can either display
the rendered text or route on the structured fields:

```json
{
  "change": {
    "kind": "status_change",
    "providerId": "cloudflare",
    "previousStatus": "operational",
    "currentStatus": "major_outage",
    "at": "2026-08-19T14:32:07.000Z"
  },
  "service": { "id": "cloudflare", "name": "Cloudflare", "statusUrl": "https://www.cloudflarestatus.com" },
  "message": "🔴 Cloudflare — MAJOR OUTAGE\n\nStatus changed from Operational to Major outage.\nUpdated: 2026-08-19 14:32 UTC\n\nhttps://www.cloudflarestatus.com"
}
```

**Signing.** Set `WEBHOOK_SECRET` (or `webhook.secret` in `config.yml`) and each
request carries two extra headers:

```
X-IsItDown-Timestamp: 2026-08-19T14:32:07.000Z
X-IsItDown-Signature: sha256=<hex>
```

The signature is HMAC-SHA256 over `` `${timestamp}.${body}` `` with the secret as
the key, computed on the exact bytes that were sent. Verify it by recomputing the
same string from the raw body — not from a re-serialised parse — and comparing in
constant time; the timestamp is inside the signed material so a receiver can also
reject a request that is too old to be genuine. With no secret set nothing is
added, so an existing receiver keeps working untouched.

Desktop (Web Push) is UI edition only, and the browser Push API refuses to
register a service worker unless the dashboard is served over localhost or HTTPS.
A toast carries the affected provider's own icon, so a stack of them is readable
at a glance.

Discord and Slack are both incoming webhooks: create one in the target
server/workspace, put its URL in `DISCORD_WEBHOOK_URL` or `SLACK_WEBHOOK_URL`,
and enable the channel. Both render the same words every other channel sends,
arranged natively — Discord as one embed whose title carries the severity and
links to the provider's status page, coloured by that severity; Slack as a
Block Kit section plus an "Open status page" button, with the heading repeated
as the notification preview text. Neither URL is ever logged or shown in the
dashboard: a rejected send reports the HTTP status and the service's own
reason.

**ntfy and Gotify** are the self-hosted push pair (roadmap 3.4). ntfy is one
POST: the topic URL carries the server, so `https://ntfy.sh/isitdown` and
`https://ntfy.example.com/isitdown` are the same setting, the heading becomes the
notification's title, the detail its body, and tapping it opens the provider's
status page. `NTFY_TOKEN` is only needed on a server with access control — a
public topic works without one. Gotify takes its server plus one application
token, posted to `/message` with the token in `X-Gotify-Key` rather than in the
URL, since a URL ends up in logs.

Both map the severity onto the channel's own priority scale, so what is allowed
to ring at night is a property of the reading rather than a rule rebuilt on every
phone: on ntfy's 1–5 scale a major outage is `5` and a recovery is `2`; on
Gotify's 0–10 scale, `9` and `3`. Neither credential is ever logged or shown in
the dashboard, and a rejected send reports the HTTP status with the server's own
reason.

**Pushover** (roadmap 3.5) is the hosted half of the same family: two
credentials — the application's API token and the user (or group) key — and one
form-encoded POST to `api.pushover.net`. Both are sent in the body rather than
the query string, since a URL ends up in logs. The heading is the notification's
title, the detail its body, and the status page is the tap target rather than a
line of text. Severity picks the priority: a partial or major outage goes out at
`1`, which bypasses the recipient's quiet hours; everything else at `0`, and a
reading we could not take at `-1`. Priority `2` is deliberately never used —
emergency priority re-alerts until someone acknowledges it, which is an on-call
escalation rather than a status change. `PUSHOVER_DEVICE` narrows delivery to one
registered device; unset, every device on the account hears it.

**Microsoft Teams** (roadmap 3.8) is one incoming webhook, like Discord and
Slack, carrying an Adaptive Card. The card travels in the `attachments`
envelope rather than as the older `MessageCard`: Microsoft retired the Office
365 connectors in favour of Workflows, and a workflow trigger only understands
this shape — a connector that is still alive renders it too, so there is one
body rather than a setting asking which era the webhook belongs to. The webhook
URL is created in the channel with **Workflows → "Post to a channel when a
webhook request is received"**. Severity is the heading's own colour, named
(`good` / `warning` / `attention`) rather than sent as a hex, so the card stays
legible in both of Teams' themes, and the same emoji every other channel shows
says it again for a client rendering in monochrome. The status page is a button,
not a line of text. The URL is the credential, so it never appears in an error.

**Matrix** (roadmap 3.6) posts into one room through the client-server API.
Two formats travel together, as Matrix expects: `body` is the plain text a
terminal client shows and `formatted_body` the HTML a graphical one renders,
both built from the same words, so neither can say something the other does
not. A Matrix message has no separate link affordance, so the status page is a
trailing line in the text and a link in the HTML — and a provider's own
incident title is escaped before it lands in that HTML rather than trusted.
`MATRIX_ROOM_ID` is the internal room id (`!ops:example.org`), not an alias: an
alias can be repointed at another room by anyone with the power to, which is
not a property an alert channel should have. Sends are `PUT`s carrying a fresh
transaction id, Matrix's own idempotency key, so a retried request is
de-duplicated by the homeserver instead of posting the alert twice. Editing is
native — an incident update rewrites the message it updates rather than adding
another one.

**PagerDuty and Opsgenie** (roadmap 3.7) are the on-call pair, and they are the
only channels that do more than deliver a message: an alert here enters an
escalation chain, so it also has to close again. Both key on the change —
PagerDuty's `dedup_key`, Opsgenie's `alias`, derived identically — so the
resolve a provider's own "resolved" update produces names the very alert its
"investigating" update opened. An incident keys on its own id, so a provider
with three open incidents holds three alerts that each close on their own;
a status, a component, a maintenance window and our own fetching each key on
what they are about, so a status that worsens twice updates one alert instead
of stacking. What counts as a close is the diff engine's lifecycle unchanged:
an incident that resolved, a maintenance window that ended, a status back to
operational. A digest never closes anything — its most severe member stands in
for the batch, and closing on a recovery that happened to be the worst of five
changes would silence the other four.

Severity becomes each service's own scale: PagerDuty's `critical` / `error` /
`warning` / `info`, Opsgenie's `P1`–`P3`. Set `PAGERDUTY_REGION` or
`OPSGENIE_REGION` to `eu` for an account provisioned in Europe; unset means the
default instance. Neither credential appears in a URL or an error — a rejected
send reports the status and the service's own message.

**Apprise** (roadmap 3.9) is a bridge rather than a channel of its own: one
notifier talking to an [Apprise](https://github.com/caronc/apprise) API server,
and through it to the ~80 services Apprise already knows how to reach. It is
the pragmatic answer for a destination this project will never write a notifier
for. The cost is an external service, so nothing about it is assumed: the
server URL is a setting with no default, and a server that is down fails the
delivery like any other channel rather than losing the alert quietly. Two
shapes are supported because Apprise offers two — with `APPRISE_CONFIG_KEY` the
server holds the service URLs and IsItDown never sees them, which is the better
arrangement since those URLs are credentials; with `APPRISE_URLS` they travel
on each request instead, for a stateless server. Set both and the stored
configuration wins, since that is the one an operator edits. Severity survives
the bridge as Apprise's own notification type (`failure` / `warning` /
`success` / `info`), and the status page is a line in the body: Apprise
flattens away whatever link affordance each downstream service has.

**Email** is SMTP submission, and it is written here rather than taken from a
library (roadmap 3.3): what a notification needs is one submission conversation
— greeting, `EHLO`, `STARTTLS`, `AUTH`, envelope, `DATA` — and that is
`src/notifiers/smtp.ts`, so the project still has the three runtime dependencies
it advertises. What a mail library would add on top of it — address parsing,
attachments, connection pooling, a dozen transports — a status alert has no use
for.

The subject is the heading every other channel puts first (`🔴 GitHub — MAJOR
OUTAGE`), so a lock screen shows the same sentence Telegram would; the body is
the detail and the provider's own status page, since a mail client has no
affordance to hang a link on. `SMTP_TO` takes one address or several separated
by commas, and one message goes out with one envelope recipient each.

Defaults are the ones a submission server expects: port 587 with `STARTTLS`
whenever the server offers it, and port 465 treated as implicit TLS whether or
not `SMTP_SECURE` says so. Two settings exist for the server on your own
machine, and both are off unless set: `SMTP_ALLOW_INSECURE_AUTH` is what it
takes to send credentials over a connection that was never encrypted — without
it the send fails rather than putting a password on a cleartext socket — and
`SMTP_ALLOW_SELF_SIGNED` accepts a certificate no public CA signed. A relay that
trusts this network needs no credentials at all, which is why both are optional.
A refused message reports the server's own reply (`550 5.7.1 relay denied`) into
the delivery log.

**On-call chains, again** (roadmap 3.9). **Splunk On-Call** (VictorOps),
**Squadcast**, **Zenduty**, **incident.io** and **Grafana OnCall** work exactly
like PagerDuty and Opsgenie above: each sends the same de-duplication key —
Splunk's `entity_id`, Squadcast's `event_id`, Zenduty's `entity_id`,
incident.io's `deduplication_key`, Grafana's `alert_uid` — so the recovery a
provider's own "resolved" update produces closes the alert its "investigating"
update opened, and a digest never closes anything. Severity becomes each one's
own vocabulary where it has one (Splunk's `CRITICAL` / `WARNING` / `INFO`,
Zenduty's `critical` / `error` / `warning` / `info`); Squadcast, incident.io and
Grafana carry the status as a tag or metadata field, which is what their own
routing rules read. The key or URL each takes is the credential, and none ever
appears in an error.

**Mattermost, Rocket.Chat and Zulip** (roadmap 3.9) go through each server's own
API with a bot's token rather than through an incoming webhook, for the one
thing a webhook cannot do: edit the message it posted. An incident's updates
rewrite the message that announced it, the way Telegram, Discord and Matrix
already do. Mattermost's own Slack-compatible webhook still works through the
Slack channel for anyone who does not want a bot. Zulip threads every message
under a topic, and unless `ZULIP_TOPIC` names one, each provider gets its own —
GitHub's whole history reads as one thread. **Google Chat** is an incoming
webhook and cannot edit, so it threads instead: every message about one incident
carries the same thread key and lands as a reply under the one that opened it.

**SMS and voice calls through Twilio** (roadmap 3.9) are two channels rather
than one with a mode, because routing is per channel: a text for every
degradation and a call only for a major outage is two routing rules. The SMS
is the message every plain-text channel sends, cut at Twilio's 1600 characters.
The call reads the heading and the detail aloud in the channel's language, twice
with a pause between, as automated calls are always read; emoji are dropped and
a provider's own words are escaped before they reach the TwiML. The call channel
rings for everything routed to it, so give it a rule with `minSeverity:
major_outage`. Each channel has its own variables, even for the same account:
two channels never share an environment variable in the dashboard.

**Bark** (roadmap 3.9) is push to an iPhone through the public Bark server or a
self-hosted one. What makes it a channel rather than an Apprise URL is the
interruption level: a major outage goes out `critical`, which rings through
silent mode and Focus; a partial outage `timeSensitive`; a reading we could not
take `passive`. **Signal** goes through a
[signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api) server,
the sidecar every self-hosted tool uses since Signal has no bot API. The server
holds the account's keys, so this side holds no credential — and that server
should not be reachable from anywhere but here.

**Syslog** (roadmap 3.9) sends one RFC 5424 message per change to the collector
everything else already goes to, over UDP, TCP or TLS (with the collector's
certificate verified). The message is one line — heading and detail, line
breaks folded — and the machine-readable part travels as structured data:

```
<130>1 2026-08-19T14:32:07.000Z host isitdown 1 incident_opened [isitdown@32473 provider="github" status="major_outage" key="isitdown/github/incident/inc-1" url="https://www.githubstatus.com"] 🔴 GitHub — MAJOR OUTAGE — Incident: API requests failing | Status: Investigating | …
```

`key` is the same de-duplication key the on-call channels use, so a SIEM rule
can group an incident's messages. Severity follows the status, from `crit` for a
major outage down to `notice`. A message is cut to 2048 bytes over UDP and 8192
over a stream, which is what every collector accepts by default.

**MQTT** (roadmap 3.9) is for home automation that is not Home Assistant —
Node-RED, openHAB, a microcontroller with a status light. Each change is one
JSON message on `<prefix>/<provider>` (`provider`, `kind`, `status`,
`previous`, `heading`, `detail`, `url`, `at`), digests on `<prefix>/digest`. A
change about the provider's own state — its status, an incident — is published
*retained*, so a subscriber that connects later still learns where each provider
stands; a component, a maintenance notice or our own monitoring is an event and
is not retained, or it would overwrite that state. MQTT 3.1.1 is spoken directly
over a socket — connect, one QoS 1 publish, wait for the broker's acknowledgement,
disconnect — so the channel adds no dependency to the Light image or the single
binary.

**Mastodon and Bluesky** (roadmap 3.9) post in public: paired with the public
status page, they are the status account a small team never got round to
running by hand. Public means the operator's impact and owner notes
([3.23](#323-why-a-provider-matters--impact-and-owner)) are never posted — they
are handover notes, not something for followers; a template is still posted as
written, since what it prints is the operator's explicit choice. Mastodon edits
a post in place when the incident it announced moves on; Bluesky has no editing,
so each change is a post. Bluesky wants an app password, never the account's
own.

**What every channel promises** (roadmap 3.8). One contract suite,
`test/notifiers/contract.test.ts`, holds every channel to the same properties:
a change of every kind is delivered without throwing; a refused delivery is a
typed error that names the channel and the HTTP status and never contains a
credential; every field the remote side caps is cut to fit — Pushover's 1024
characters, Telegram's 4096, a syslog datagram's bytes — with an ellipsis rather
than refused with a 400, which used to lose a long digest outright; an on-call
channel's key is stable and shared by the alert and its recovery; and the exact
bytes each channel puts on the wire for a fixed set of changes are recorded in
`test/notifiers/golden/`, so a change to what a channel sends is a diff someone
reviewed.

### 3.7 Notification routing

An ordered table of rules decides which enabled channels hear about a given
change. Each rule has four parts:

```yaml
routing:
  - provider: "*"            # a service id, `group:<slug>` (§3.10), `<id>#<component>`, or "*" 
    classes: [status, incident]  # any of: status, incident, maintenance, monitoring
    minSeverity: major_outage  # any | degraded | partial_outage | major_outage
    channels: [telegram]       # channel ids, or "*" for every enabled channel; [] mutes
```

Rules are evaluated top to bottom and the **first one that matches wins** —
later rules are never consulted for that change, so a narrow provider-specific
rule placed above a catch-all can mute or redirect it. A rule matches when the
change's provider, event class and severity all clear what it asks for; an
empty `channels: []` is a valid, deliberate way to silence a match rather than
an oversight. Severity is judged on the *worse* of where a change came from
and where it landed — a recovery from a major outage still carries the outage
floor, so a rule gating on `major_outage` still fires for the all-clear rather
than letting it slip through unrouted. An installation with no rules at all
behaves exactly as if one catch-all rule existed: every class, any severity,
every enabled channel — the behaviour both editions had before routing
existed, so upgrading never goes silent by accident.

A rule can also name **one component of one provider**, as `<id>#<component>`
— `github#8l4ygp009s5s`. A component's transition already carries the
component's own severity rather than the provider's, so this is all that was
needed to route one independently: put `github#api` above `github` and that one
component goes to a phone while everything else on the page goes to Slack, or
give it `channels: []` and mute one noisy component without going quiet about
the provider. A component target matches only that component's own transitions,
so a provider-level status change never matches one. The component id is the
provider's own — the same id the component picker stores — and removing a
provider deletes its components' rules along with its own.

The Light edition configures the table as the `routing` list in `config.yml`,
shown above; the UI edition edits it from **Settings**, where the provider
column lists each provider's selected components beneath it and a routing rules
editor also offers a dry run — pick a provider (and, where one is selected, a
component) plus a canned event, and it names which rule would win and which ones
were never reached, evaluated against the rules you currently have saved, not a
hypothetical set.

### 3.8 Delivery policy — quiet hours, digests, caps

The routing rules decide *who* hears about a change. Twelve further controls
decide *how much* of it actually goes out, and in how many messages. All of them
are off by default, so an installation that configures none of them behaves
exactly as it did before they existed.

```yaml
delivery:
  quietHours:
    enabled: true
    start: "23:00"          # inclusive
    end: "07:00"            # exclusive; the window may wrap midnight
    timeZone: "Europe/Rome" # an IANA name, or "auto" for the container's zone
    minSeverity: major_outage
  digest:
    enabled: true
    windowMinutes: 15
    immediateFloor: major_outage
  cap:
    enabled: true
    maxPerHour: 6
  updateInPlace: true
  maintenanceNotice:
    enabled: true
    leadMinutes: 120
  escalation:
    enabled: true
    afterMinutes: 15
    channel: pushover
    minSeverity: major_outage
  channelHealth:
    enabled: true
    afterFailures: 3
  incidentSummary:
    enabled: true
  coalesce:
    enabled: true
    windowMinutes: 2
  knownOutage:
    enabled: true
  attachChart: true          # UI edition only
  report:                    # UI edition only
    enabled: true
    frequency: weekly        # weekly | monthly
    channel: slack
```

**Quiet hours** are a routing *input*, not a filter bolted on after the rules:
inside the window, only changes clearing `minSeverity` reach anybody, and the
UI edition's dry run says when the hour — rather than a rule — is what decided.
A change held back is dropped, not deferred; deferring is the digest's job. The
window is read in `timeZone` and fails open on anything unusable (a malformed
time, an unknown zone, equal ends), because the one failure mode worth ruling
out here is a night of silence caused by a typo.

**Digest mode** collects everything *under* `immediateFloor` and sends it as one
message per window; anything at or above the floor still goes out the moment it
happens, so the window only ever delays what you said was not urgent. The batch
is flushed on the clock rather than when the next change arrives, which is why a
quiet window still ends in a message. Two honest limits: a channel switched off
while a window is open has its batch dropped (with a line in the log), and a
batch still collecting when the process stops is lost rather than arriving an
hour late.

**The cap** is a ceiling per provider per rolling hour, counted per *change*
rather than per channel — the operator reading them is one person however many
channels are enabled. What the cap holds back is counted, and the next message
that gets through carries a "further alerts were suppressed" line, so a cap can
never be mistaken for a channel that has stopped working. A digested change is
deliberately not charged against the cap: one batch is one message.

**`updateInPlace`** makes one incident one message that is rewritten as the
incident moves, on the channels that can edit what they sent — Telegram
(`editMessageText`) and Discord (a webhook message id). The id is remembered per
channel per incident, the message that closes an incident releases it, and an
edit the channel refuses (too old, deleted by hand) falls back to a fresh
message rather than losing the update. Slack's incoming webhook cannot edit at
all, so it keeps receiving a message per update.

**`maintenanceNotice`** says so *before* a maintenance window the provider has
declared opens, instead of only when it does — the one alert that lets somebody
act first ("GitHub maintenance in 2 h, expected 30 min"). A window is announced
once, on the first reading that finds it within `leadMinutes` of its start
(1–10080, default 120), and it routes as the `maintenance` event class, so a
rule that already carries maintenance carries the heads-up too. A mute on the
provider, or a window of its own already running, holds it back — and does not
spend it, so lifting the mute still gets you the notice. A window with no
declared end is announced without a duration. Like the digest and the cap, what
has been announced lives in memory: a restart inside the lead repeats one
heads-up rather than losing it.

**`escalation`** says a change again, on a different channel, when nobody has
taken it in charge. A status getting worse, a component getting worse, or an
incident opening or moving on — at or above `minSeverity` (default
`major_outage`) — starts a clock when it is sent. After `afterMinutes`
(1–1440, default 15), if nobody has pressed **I'm on it** (or typed `/ack`; see
[3.17](#317-chatops--commanding-the-bot-from-telegram)), the provider is still in
trouble and not muted, the same change is sent once to `channel` — and only to
it — ending in "Nobody took this in charge after 15 min". On Pushover that is
never below high priority. It is once per stretch of trouble, not once per later
update, and a stretch ends when the provider is operational with nothing open; a
recovery, a mute, or an acknowledgement before the wait is up cancels it. The
wait is measured in poll cycles, because that is when the dispatcher is asked:
an `afterMinutes` shorter than your cadence is no shorter than your cadence. If
the escalation channel is switched off the log says so, rather than the change
quietly going nowhere. The clocks live in memory like the cap and the digest, so
a restart clears them. **UI edition only**: the Light edition has no
acknowledgement to read, so with `escalation` enabled there it logs one line
saying nothing will be escalated and carries on.

**`channelHealth`** tells the other channels when one stops delivering. A
webhook answering 500 for a week otherwise shows up only as a red badge in the
delivery log, and the operator has to notice an absence. Once a channel has
refused `afterFailures` messages in a row (2–100, default 3) — each one already
past its own retries, so a dead letter — the other channels get one message:
"IsItDown — channel discord failing: 3 message(s) in a row could not be
delivered, since …, last error: HTTP 401". It routes as the `monitoring` class
through the same rules as everything else, minus the broken channel and any
other channel in a failing run of its own; with nowhere left to say it, the log
says it instead. Once per run: the alert is not repeated while the channel stays
broken, and the next message it does deliver ends the run, so a later breakage
is reported again. Quiet hours hold it back like any other monitoring change,
and it goes out after them rather than never. An operator's **Send test** does
not count. The runs live in memory like the cap, so a restart starts them over.

**`incidentSummary`** replaces the "resolved" messages of a shared failure with
one. When several providers go bad inside the correlation window, the alert
already says so once (`correlationThreshold`); this is the same story told at
its end. While that failure is open, each member's return to normal
is held back, and when the last one is back a single message says "the shared
failure is over: 6 providers affected, 47 min in all", naming the probable cause
if the providers declared one with `dependsOn`. It routes and edits in place like
the alert that opened it, and closes it on an on-call channel. A member that goes
bad again before the others recover is not counted as back, and one that never
recovers does not hold the rest for ever: after six hours the summary goes out
for the members that did recover and the others are reported on their own. The
open failure lives in memory, so after a restart each recovery is reported
individually.

**`coalesce`** sends only the last of a run of updates to the same incident. A
provider that posts four updates in ten minutes produces four messages, or four
edits; with this on, an update waits `windowMinutes` (1–60, default 2) and is
replaced by any newer one about the same incident, so what goes out is where the
incident stands, once. The window runs from the *first* update of the run, so a
provider that updates every minute still gets a message every `windowMinutes`
rather than none. An incident's opening is never held, and its resolution is
sent at once and cancels any update still waiting. What waits is judged by quiet
hours, the cap and the digest when it is released, not when it arrived; the
release happens on a poll cycle, so a window shorter than your cadence is no
shorter. Held updates are in memory, so a restart drops at most one window's
worth, and switching the option off releases whatever was waiting.

**`knownOutage`** keeps an outage you were already told about from paging you
again for every update. While a provider is in major outage, further updates of
its incident go to the digest window instead of going out — whether or not
`digest` itself is switched on — and arrive as one message. A change of status
(including the one into or out of major outage), the resolution, and an update
while the provider is below major outage still interrupt, and so does any
incident you follow.

**`attachChart`** adds the provider's last 24 hours to status and incident
messages as an SVG — forty-eight half-hour cells, each as bad as the worst
reading in it, grey where nothing was read, every cell titled so the colour is
never the only carrier. SVG is all it draws, deliberately: a rasteriser would add
a native dependency to every image. So it reaches only the channels that can
carry one: **email** attaches it as `<provider>-uptime-24h.svg`, and the
**webhook** adds a `chart: { contentType, svg }` field to its body. Every other
channel sends the message as it always did. It is drawn once per change, never
for a digest, a maintenance notice, a report or a channel alert, and a failure to
draw it costs the picture and not the alert. **UI edition only**: it is drawn
from stored readings.

**`report`** delivers the fleet's week or month on one `channel`, instead of
waiting for somebody to download the monthly report: fleet uptime, the three
weakest providers below 100%, how many incidents, and the error budget spent for
each provider with an `slaTarget`. `weekly` covers the last complete Monday-to-
Sunday week and `monthly` the last calendar month, both UTC like every other day
in the history; it is sent on the first poll after the period closes, once. The
budget in a monthly report is that month's; in a weekly one it is the month so
far, the figure the error-budget alert already warns about. It goes to the chosen
channel only — it is not an alert, so routing rules, the cap and the digest do
not apply — but it waits out quiet hours, and goes out after them rather than
never. Turning it on sends the report for the last closed period at the next
poll. A channel that is not enabled is said so in the log. **UI edition only**:
it reads the stored history, so the Light edition ignores the block.

**`onCall`** says who is on call this week, without becoming an on-call system:
PagerDuty and Opsgenie are already channels, and this does not replace them. It
is a rotation of [recipients](#321-recipients--one-person-several-channels) that
already exist — one per week, in turn, then it starts over — and whoever's week
it is hears every change at or above `minSeverity` (default `major_outage`) *in
addition to* whoever the routing rules already chose. It adds a reader and never
removes one, so a rotation that is wrong can only over-notify: one that names a
recipient nobody defined loses the extra reader, not the alert, and says so in
the log. The recipient is reached the way recipients always are — on the
preferred channel, falling back to the next only if that one fails. Weeks run
Monday to Sunday, UTC; `startsOn` is any day of the first week (empty counts from
1970), and a date that cannot be read counts the same way rather than stopping
an alert. Nothing is stored: who is on call is a function of the date, so a
restart changes nothing and the dashboard shows the same name the dispatcher
uses. Quiet hours still hold a change back first.

```yaml
delivery:
  onCall:
    enabled: true
    minSeverity: major_outage
    startsOn: 2026-10-05
    rotation: [alice, bob]   # recipient ids; week 1 is alice's
```

**`deliveryTest`** is a notification that proves the notification system still
works, not just on the day it was configured. Once a UTC week every enabled
channel gets a message that says, in the channel's own language, that it is the
routine weekly test and that nothing is wrong; a channel's template does not
replace that text. Each channel is tested on its own, so a result always belongs
to one channel. A failure is counted as a broken channel at once — one failed
test is the proof the real alerts need several failures to approach, since a
weekly message would otherwise take a month to say so — and the existing
[`channelHealth`](#38-delivery-policy--quiet-hours-digests-caps) alert tells the
other channels, when that is switched on. The test goes out on the first poll of
the week, waits out quiet hours, and is not retried. **UI edition only**: the
week it last ran is kept in the database.

The Light edition configures the `delivery` block above (with the caveats just
given for `escalation`, `attachChart`, `report` and `deliveryTest`); the UI edition edits them
under **Settings → Delivery**, where each row applies on its own without a
restart.

### 3.9 Validating a `config.yml` — the `check` command

Validating a file by starting the container and reading its logs tells you about
the first problem only, and costs a container to learn it. `check` reads the same
file through the same loader and prints *every* problem, then exits non-zero:

```bash
node dist/light/check.js ./config.yml
#   ./config.yml is valid — 4 services (3 enabled), channels: telegram, file only, no provider read

docker exec isitdown-light node dist/light/check.js; echo "exit=$?"
#   /app/config/config.yml is valid — 4 services (4 enabled), channels: telegram, ...
#   exit=0
```

With no path it reads `$CONFIG_PATH`, the way the container does. From a source
checkout, `npm run check:config -- ./config.yml` runs the same command without a
build.

What it reports, all in one pass:

| Finding | Level |
|---|---|
| File missing, unreadable, or not valid YAML | error |
| Anything the schema rejects (missing key, bad interval, malformed base url) | error |
| A `${VAR}` reference with no value in the environment — **every** one, named | error |
| The same service `id` declared twice | error |
| An enabled channel whose required setting is empty | error |
| A routing rule naming a provider or channel the file does not define | error |
| A service naming an `adapter` that does not exist, with the known ones listed | error |
| An `http` service whose probe options cannot be read (bad `expectStatus`, a `${VAR}` with nothing behind it, an `expectBody` on a `HEAD`) — offline, so it is caught without `--probe` | error |
| With `--probe`: a base url no adapter recognises. `http` services are skipped here: a probe's target is not a status page and is not meant to look like one | error |
| With `--probe`: a page that looks like a different adapter than the file names | warning |

Warnings are printed and do not fail the check — the `html` adapter is a
defensible choice for a page that also serves a Statuspage summary.

`--probe` reads each enabled provider's page (disabled ones are left alone, since
the file already says to) and asks which adapter recognises it, using the same
detection the UI edition's add-provider form uses. It is off by default: a check
that reaches the network is not something CI can depend on, and every other
finding above is answerable from the file alone.

Exit codes: `0` valid, `1` at least one error, `2` the command itself was called
wrong (unknown option, two paths). That makes it CI-able for the operator rather
than only for us:

```yaml
- run: docker run --rm -v ./config.yml:/app/config/config.yml:ro \
    ghcr.io/devmanfre/isitdown:light-latest node dist/light/check.js
```

### 3.10 Provider groups — "my stack"

A flat fleet answers "is GitHub healthy" and never "is my deploy path healthy",
which is the question an operator actually has: four providers they do not care
about individually, and one answer they do. A group is a slug a provider carries
(roadmap 2.6) — in `config.yml`:

```yaml
services:
  - name: GitHub
    id: github
    adapter: statuspage
    baseUrl: https://www.githubstatus.com
    group: deploy-path
  - name: Cloudflare
    id: cloudflare
    adapter: statuspage
    baseUrl: https://www.cloudflarestatus.com
    group: deploy-path
```

— and, in the UI edition, the **Group** field on a service, with the groups that
already exist offered as you type.

Two things follow from it:

- **A combined status.** The Overview grows a "My stack" band, one tile per
  group, in the group's own status: the worst member wins, and the tile names the
  members behind it. `unknown` is not a severity — the same rule the diff engine
  and the routing floors already follow — so one silent provider cannot hold a
  healthy stack at `unknown`, and only a group with nothing readable at all reads
  that way. A disabled provider leaves its group entirely: nobody is polling it,
  so it cannot make a stack unhealthy. The composite is derived by the server
  (`/status`'s `groups`), never recomputed in the browser, so the tile and the
  rows under it cannot disagree.
- **One routing rule for the whole stack.** A rule's `provider` accepts
  `group:deploy-path`, which covers every member — and keeps covering them when
  the stack gains a fifth provider, which four hard-coded ids never would. The
  dashboard's routing table offers the groups above the individual providers, and
  the dry run evaluates them with the picked provider's own group.

### 3.11 Per-channel locale and template

Two things about a channel are not transport: what language it writes in
(roadmap 3.20) and how the message is laid out (roadmap 3.15). Both are fields
on the channel itself — `notifications.<channel>.locale` and
`notifications.<channel>.template` in `config.yml`, and the **Message** block at
the bottom of the channel's row in **Settings → Notifications**.

```yaml
notifications:
  telegram:
    enabled: true
    botToken: "${TELEGRAM_BOT_TOKEN}"
    chatId: "${TELEGRAM_CHAT_ID}"
    # The chat reads Italian; the webhook below still speaks English.
    locale: it
  webhook:
    enabled: true
    url: "${WEBHOOK_URL}"
    template: |
      [{{severity}}] {{provider}} — {{title}}
      {{url}}
```

**The locale** falls back to the installation's own notification locale
(`locale:` at the top of the file, or **Settings → Appearance** in the UI
edition), which is what every channel did before this existed. It is the same
catalog the dashboard uses, so a channel can only name a language IsItDown
actually ships.

**The template** replaces the default rendering for that channel. It is
deliberately not a templating language:

- **Substitution only.** `{{provider}}` becomes a string. There is no `if`, no
  loop, no filter, and no expression of any kind.
- **A token with nothing behind it renders empty**, and a line made only of such
  tokens is dropped rather than left as a dangling label — so a template written
  for incidents stays readable on a status change that has no incident in it. A
  line carrying literal text keeps it: `Incident: {{title}}` renders as
  `Incident:`.
- **An unknown token is refused where it is saved**: the Light edition will not
  start on one and names it, and the dashboard answers `400` with the token in
  the message. A typo that survived would read as `{{provder}}` to whoever is
  being paged.
- **A digest is never templated.** A template describes one change; a digest is a
  batch of them, and it keeps its own rendering.
- **The suppressed-alerts line still follows the message**, templated or not: it
  is about what the operator did not get told, not about the change.

The tokens, which the dashboard also lists under the field:

| Token | What it is |
| --- | --- |
| `{{message}}` | The whole default message, exactly as the channel would otherwise have sent it — the token that makes "the usual text, with our prefix" a one-line template. |
| `{{emoji}}` | The severity's own emoji, the one the default message opens with. |
| `{{provider}}` | The provider's display name. |
| `{{providerId}}` | The provider's id, as configured. |
| `{{kind}}` | What happened, in the diff engine's own word: `incident_opened`, `status_change`, … |
| `{{severity}}` | The current severity, upper-cased — the heading word. |
| `{{status}}` | The current severity, in sentence case. |
| `{{previous}}` | The severity before this change; empty when there was no prior reading. |
| `{{component}}` | The component that changed; empty unless this is a component change. |
| `{{title}}` | The incident's or maintenance window's own title; empty when there is neither. |
| `{{incidentStatus}}` | The provider's own lifecycle word for the incident, translated where known. |
| `{{impact}}` | What breaks when this provider does, as written on it ([3.23](#323-why-a-provider-matters--impact-and-owner)); empty when not set. |
| `{{owner}}` | Who answers for this provider; empty when not set. |
| `{{url}}` | The provider's public status page. Empty on a channel that renders the link itself (a Discord embed), so it is never printed twice. |
| `{{at}}` | When it happened, UTC. |

Everything a token resolves to comes from the same catalog the default message
is assembled from, so a templated message and a default one say the same words
in the same language. A template rearranges them; it cannot invent new ones.

### 3.12 Reaching the API from another host

Every route in the UI edition is open, and that is the right answer for the
deployment this project documents: one container, bound to `127.0.0.1`, watched
by the person who runs it. It stops being the right answer the moment something
off this machine has to read it — a home page widget ([4.11](api.md)), a badge
in a README, a scrape job on the next box.

`API_TOKEN` is the smallest thing that unblocks those (roadmap 4.15):

```yaml
services:
  isitdown-ui:
    environment:
      API_TOKEN: "a-long-random-string"
```

With it set:

- **A request carrying the token may read, from anywhere.** `GET` and `HEAD`
  pass. Send it as `Authorization: Bearer <token>`, or as `X-API-Token: <token>`
  for a client whose configuration file has no room for a scheme.
- **The token grants nothing else.** Any other method answers `403`, from the
  holder of a valid token as much as from anyone — including from this machine.
  A token ends up pasted into a dashboard config, a cron job, a chat message;
  it must never be worth more than reading.
- **Everything else still has to be local.** A request with no token is answered
  only if it came from this machine, which is what keeps the dashboard itself
  working with no token in the browser.
- **`/health` and `/ready` are never gated.** A Kubernetes probe arrives from
  the node's address, not from loopback, and a liveness check that starts
  failing because a token was set is a restart loop.

Two things to be clear about:

- **`X-Forwarded-For` is ignored.** A header the client writes cannot decide
  whether the client is local. The consequence is that a reverse proxy running
  on this same host makes every request it forwards look local — so behind one,
  set `API_LOCAL_BYPASS=false` and require the token from everybody, this
  machine included.
- **This is not authentication.** One token, no identities, no expiry, and
  nothing to revoke but the variable. It is a door with one key. Multi-user auth
  remains a declared non-goal.

```bash
curl -H "Authorization: Bearer $API_TOKEN" http://isitdown.lan:3000/widget
```

### 3.13 SLA targets and error budgets

A 90-day uptime figure answers "how has this vendor been". The question somebody
has to answer in a review is "does this vendor meet what we were promised, this
month" — and that needs a number nobody had written down. `slaTarget` is that
number (roadmap 4.13): a monthly uptime percentage on the provider, in
`config.yml` or in the **Monthly uptime target** field of the add/edit dialog.

```yaml
services:
  - name: GitHub
    id: github
    adapter: statuspage
    baseUrl: https://www.githubstatus.com
    slaTarget: 99.9
```

Optional, and absent by default: most providers are watched without anybody
having promised anything, and a default would invent a promise and then report
against it. Between 50 and 100.

With a target set, the UI edition works out four things for the current calendar
month — a month, because that is the unit an SLA is written in — from the same
stored samples the History view is drawn from:

- **The budget.** 0.1% of a 31-day month is 44.6 minutes of downtime.
- **What is spent.** Measured downtime so far, on the same sample-count
  arithmetic the History view's own downtime figure uses.
- **The burn rate.** Spend against *elapsed* time: `1` is exactly on budget, `2`
  is spending it twice as fast as the month can afford. The number worth reading
  on a dashboard, because "13 of 44 minutes" needs the reader to know what day
  it is and this does not.
- **The projection.** The measured rate carried to the end of the month.
  Deliberately nothing cleverer: a weighted estimate would be a forecast, and a
  forecast that is wrong about a vendor's month is worse than none.

It shows as an **Error budget** card on the provider's own page, and the whole
fleet's is `GET /sla`.

**The alert.** When the projection first drops below the target, the provider
gets one `sla_burn` notification — through the diff engine and the dispatcher
like every other alert, so routing rules, quiet hours, the digest window and the
hourly cap all apply. Three things about it:

- It is routed as a **monitoring** event, not a status one. Nothing about the
  provider changed when it fires; it is a statement about a month of
  measurements, and a rule that exists to be woken by an outage should not be
  woken by arithmetic.
- It is said **once per provider per month**, and the marker is kept in the
  database rather than in memory — a restart on the 12th must not repeat it.
- It says nothing until at least six hours of that month have been measured. One
  bad hour on the 1st projects a month that is lost, and by the 3rd it is not.

A month that holds no samples reports `null` rather than 0%: nothing measured is
not a vendor that was down, and the whole history service already turns on that
distinction.

### 3.14 Adapter plugins

A provider with an unusual status page needs an adapter, an adapter needs a pull
request, and somebody who wants to watch one internal service should not have to
fork a monitoring tool to do it. `PLUGINS_DIR` is the answer (roadmap 1.13):
point it at a directory and every `.js`, `.mjs` and `.cjs` file in it is loaded
at boot and registered as an adapter.

```yaml
services:
  isitdown-ui:
    environment:
      PLUGINS_DIR: /plugins
    volumes:
      - ./plugins:/plugins:ro
```

A plugin is one module whose default export is an adapter — the same shape the
built-in ones implement:

```js
// plugins/acme.js
export default {
  // A lowercase slug, and not one a built-in already uses. This is what
  // `adapter:` names in config.yml, or what the dashboard's adapter field takes.
  id: "acme",

  // Throws on a network error, a non-2xx or an unparseable body; degrades
  // quietly on a missing individual field. `ctx.timeoutMs` is the configured
  // request timeout.
  async fetchStatus(service, ctx) {
    const response = await fetch(`${service.baseUrl}/health.json`, {
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
    if (!response.ok) throw new Error(`acme: HTTP ${response.status}`);
    const body = await response.json();
    return {
      provider: service.id,
      // One of: operational, degraded, partial_outage, major_outage, unknown.
      overallStatus: body.ok ? "operational" : "major_outage",
      activeIncidents: [],
      components: [],
      maintenances: [],
      fetchedAt: new Date().toISOString(),
    };
  },
};
```

`fetchIncidentHistory` and `listComponents` are optional; an adapter without
them simply has no backfillable history and offers no component picker. A named
`adapter` export works as well as a default one, for a file that also exports
helpers of its own.

> **A plugin is arbitrary code running inside the poller**, with its privileges
> and its access to every channel credential the configuration resolved. There
> is no sandbox, and there is not going to be one: Node has no in-process
> boundary worth the name, and a fake one would be worse than an honest absence.
> That is why nothing sets `PLUGINS_DIR` for you — not the images, not the
> compose file — and why every plugin loaded is announced in the log with the
> file it came from. Treat a plugin exactly as you would treat a patch to this
> codebase, because that is what it is.

Three rules the loader enforces, all so that one bad file cannot cost a fleet
its monitoring:

- **A plugin may not take an id that already exists** — not a built-in's, and
  not another plugin's. Overriding `statuspage` would change what every existing
  provider reads, and two plugins racing for one id would make behaviour depend
  on filenames. The file is refused and named.
- **A file that will not import, or that exports something that is not an
  adapter, is skipped and named** — the rest of the directory still loads.
- **A missing directory is a warning, not a failure.** Setting the variable
  before mounting the volume gets you a line in the log and a running poller.

`node dist/light/check.js` loads plugins before validating the file, so a
`config.yml` naming a plugin's adapter checks out, and a plugin that could not be
loaded is one of the errors it reports.

### 3.15 Provider push instead of poll

Atlassian Statuspage lets a subscriber register a URL and posts to it on every
change. Where that is reachable, the latency of a status change drops from a
cadence to seconds, and a quiet provider stops being read on a timer at all
(roadmap 2.10).

Set `PUSH_TOKEN` on the UI edition and register the URL on the provider's page
(**Subscribe → Webhook**, on most Statuspage instances):

```
https://isitdown.example.com/push/github?token=<PUSH_TOKEN>
```

You do not have to build that address by hand. Each Statuspage provider's page in
the dashboard carries a **Push from the provider** card (roadmap 1.2): with
`PUSH_TOKEN` unset it says how to turn push on; once it is set it shows the
address to paste, with a copy button and the steps for that provider's own page.
When the dashboard is open on `localhost` the card warns that Statuspage cannot
reach that host — substitute the address IsItDown is published at, same path.
The full token is shown only to the operator's own dashboard; a read-only
`API_TOKEN` holder sees `<PUSH_TOKEN>` in its place.

Statuspage sends no test event, so the card cannot verify a subscription the
moment it is made. It does the honest thing instead: it records every post that
arrives — in the database, so it survives a restart — and turns to **Working**,
with the time of the last post, when the provider's next real update comes in.

**What arrives is a trigger, not a reading.** This is the design decision worth
knowing about. IsItDown does not parse the webhook body into a status: it reads
the provider, right then, through the adapter that already knows how. Everything
after that — the diff engine, flap damping, routing, quiet hours, the delivery
log — is the same code a scheduled cycle runs. The alternative, parsing the
payload directly, would mean two ways a provider's state can be learned, two
parsers to keep in step with Statuspage, and two chances for a pushed incident to
be shaped differently from a polled one. The cost of doing it this way is one
HTTP request per event rather than zero, which is still far fewer than one per
cadence forever.

**Polling stays the fallback.** A push is an addition, never a replacement. The
standing schedule keeps running and this route does not delay it, so a homelab
install with no inbound URL — the reason this cannot be the only path — behaves
exactly as it does today. An instance that *is* reachable can lengthen that
provider's `intervalMinutes` to make the schedule a safety net rather than the
main path.

Three things about the endpoint:

- **The URL is the credential.** Statuspage sends no signature and no custom
  headers, so there is nothing else available. Treat the URL as a secret,
  rotate it by changing `PUSH_TOKEN`, and serve it over HTTPS. The token is
  compared in constant time, and a wrong one is a `401` with a line in the log.
- **It is the one route the read-only API token does not gate**
  ([3.12](#312-reaching-the-api-from-another-host)). Its caller is a provider
  rather than an operator: it cannot be handed a bearer token, and it is a
  `POST`, which that token refuses on principle. It carries its own credential
  instead.
- **Several posts about one change cost one read.** Statuspage posts the
  incident and then each affected component within seconds; anything arriving
  within ten seconds of a honoured push is answered `202 coalesced`.

A provider id nothing is watching, or one that is disabled, is a `404` — which
is also the answer when `PUSH_TOKEN` is unset, so an instance that has not opted
in does not advertise that the feature exists.

### 3.16 Traces

Point `OTEL_EXPORTER_OTLP_ENDPOINT` at a collector and IsItDown exports
OpenTelemetry traces (roadmap 6.10):

```yaml
services:
  isitdown-ui:
    environment:
      OTEL_EXPORTER_OTLP_ENDPOINT: http://tempo:4318
      OTEL_SERVICE_NAME: isitdown
```

Three spans, which is the whole instrumentation:

| Span | What it covers |
| --- | --- |
| `poll.cycle` | One cycle end to end — the configuration load, every provider read, and the dispatch that follows. `isitdown.manual` says whether it came from the **Poll now** button, `isitdown.narrowed` whether it was one provider answering a push ([3.15](#315-provider-push-instead-of-poll)). |
| `provider.read` | One provider, including the stagger wait it spent before its request — because a read that took fourteen seconds has to account for the seconds it spent deliberately waiting. Carries `isitdown.provider` and `isitdown.adapter`. |
| `notification.send` | One message to one channel, retries included: "how long did telling somebody take" is one answer, not three. Carries `isitdown.channel`, `isitdown.provider` and `isitdown.kind`. |

A span whose work throws is exported with the error on it and the error is
rethrown — so a trace shows the failed provider read, and the poller still
handles the failure exactly as it always did.

**The roadmap row that asked for this said "probably no", and the reason was
dependencies**: the usual way to get traces is an SDK and its thirty transitive
packages, in a project whose pitch is that it has three and you can read all of
them. So this ships with **no new dependency at all**. OTLP over HTTP is a JSON
document posted to `/v1/traces`, and that is precisely what
`src/core/tracing.ts` builds — no auto-instrumentation, no patched `fetch`, no
vendor. Any collector that speaks OTLP/HTTP (Tempo, Jaeger, the OTel Collector,
a hosted one) reads it.

The honest half of that trade:

- **Only the three spans above exist.** There are no automatic HTTP or SQLite
  spans underneath them. They happen to be the question the row asked — where a
  slow cycle went — and nothing more.
- **No metrics and no logs signal.** `/metrics` is already better at the first
  and the logger is already structured for the second.
- **No sampling and no retry.** Spans queue to a bounded 2048 and are dropped
  oldest-first past that; an export that fails is a warning, said once per
  outage, and those spans are gone. Telemetry must never be able to take
  monitoring down.

Tracing is off unless one of the two endpoint variables is set, and off it costs
nothing: every call site holds an object whose methods return immediately.

### 3.17 Chatops — commanding the bot from Telegram

The Telegram channel can take commands as well as send alerts. UI edition only,
and off unless you ask for it:

```bash
TELEGRAM_CHATOPS=true
```

The bot then answers, in the chat it already alerts:

| Command | What it does |
|---|---|
| `/status` | Every enabled provider, worst first, with open incidents and any running mute. |
| `/status <provider>` | One provider, plus its 90-day uptime. |
| `/history <provider> [7\|30\|90]` | Uptime over a window, the days actually measured, incidents, and the worst day. Defaults to 30. |
| `/mute <provider> <30m\|2h\|1d>` | Stops alerts for a while, up to `30d`. |
| `/unmute <provider>` | Starts them again. |
| `/ack <provider>` | Says you are on it: records who took the provider's current trouble in charge. |
| `/help` | The list above. |

**Buttons on the alert itself.** While chatops is on, a Telegram alert about
trouble that is still going — a status getting worse, an incident opening or
moving on — carries two buttons under it: **I'm on it** and **Mute 2h**. They are
the `/ack` and `/mute … 2h` commands without the typing, answered by the same
code, authorised by the same allowlist, and worded in the channel's own locale.
Pressing **I'm on it** posts who took it to the chat, so the rest of the team can
see; the first press wins, and a second one says who got there before. A
recovery, a maintenance notice, a slow page or a digest carries no buttons —
there is nothing to take in charge — and the message that closes an incident
loses the ones it had. A provider id too long to fit Telegram's 64-byte button
data gets the alert without buttons rather than a button for the wrong provider.

**Web push** toasts get the same two actions when the browser shows them. They
call `POST /providers/:id/ack` and `POST /providers/:id/mute` on this server,
the same routes the Telegram buttons end in. If that call fails — the dashboard
is unreachable, or an API token refuses the write — the click opens the
dashboard instead of failing silently, because a button that does nothing and
says nothing would leave you believing you had taken it in charge.

An acknowledgement is per provider, not per incident, and lets go by itself once
the provider is operational with nothing open. It is not part of a backup.

A provider can be named by its configured id or by the name on the dashboard,
whichever comes to mind. A mute set here is the *same* mute the dashboard sets —
it is written where the diff engine reads it, so it shows up on screen and lifts
itself when it expires.

**Who may command it.** The chats you configured, and nobody else. The allowlist
is the chat the Telegram channel already sends to, plus anything in
`TELEGRAM_COMMAND_CHAT_IDS`. A message from any other chat is ignored in
silence — not refused, because a refusal confirms the bot is there to whoever is
probing it. There is no enrolment step and no password, deliberately: a secret
typed into a chat to gain access to that chat protects nothing.

It long-polls rather than taking a webhook, so it works from behind a router
with no ports forwarded — the same assumption the rest of IsItDown makes.

Light edition has no chatops, because `/mute` would mean this process rewriting
your `config.yml` behind your back. Reading it from the UI edition's database is
a door onto a room that already exists.

### 3.18 The public status page

A read-only page, built from the fleet you already watch, for people who are not
the operator — "here is the health of everything we depend on". Off unless you
turn it on:

```bash
PUBLIC_PAGE=true
PUBLIC_PAGE_TITLE="Acme status"
PUBLIC_PAGE_PROVIDERS=github,cloudflare,stripe   # optional; unset publishes all
```

It serves two things and nothing else:

- **`GET /public`** — one self-contained HTML page: a banner, then a card per
  provider with the familiar 90-day daily strip, its open incidents and any
  running maintenance.
- **`GET /public/summary.json`** — the very same projection as JSON, CORS-open,
  for anyone who wants to build their own view on it.

Both are cached for a minute, and neither reads a query parameter, a header or a
body. There is no request input at all, so a visitor cannot ask to see a provider
you chose not to publish.

**What it deliberately cannot leak.** The published object is written out field
by field in `src/ui/publicPage.ts` rather than filtered down from the dashboard's
own payload — a filtered payload leaks the next field somebody adds to it. So
nothing about adapters, channels, routing rules, mutes, failure counts or
credentials has a line there, and the page carries **no JavaScript at all**: it
cannot call the dashboard's API because there is nothing on it that could call
anything. That also means it still renders during the outage it exists to report.

One case is worth knowing about. A provider's link points at the vendor's own
status page, which is public by definition — but for the `http`, `tcp`, `dns`,
`uptimekuma` and `imap` adapters the base URL is *yours*, an internal hostname. Those
providers still appear, under the name you gave them, with no link.

It is not authentication: anyone who can reach the port can read the page, which
is the point of it. Set `API_TOKEN` and the page stays open while the dashboard
does not — its readers are exactly the people who hold no token.

### 3.19 Heartbeats — the dead-man's switch

Every other provider is something IsItDown goes and asks. A `heartbeat` is
asked *of* it: a cron job calls a URL when it has run, and the alert is the call
that did not come — the backup that quietly stopped three weeks ago (roadmap
2.5). UI edition only: the Light edition has no URL a job could call, and refuses
a `heartbeat` provider in its `config.yml` as an unknown adapter.

```json
{
  "id": "nightly-backup",
  "name": "Nightly backup",
  "adapter": "heartbeat",
  "baseUrl": "https://heartbeat.invalid",
  "options": { "every": "24h", "grace": "1h" }
}
```

| Option | Meaning |
|---|---|
| `every` | Required. How often the job calls, ping to ping: `30m`, `24h`, `7d` — one number and a unit (`s`, `m`, `h`, `d`), between `1m` and `35d`. A bare number is refused rather than read as some unit. |
| `grace` | How late a ping may be before it is missed. Defaults to a tenth of `every`, never less than a minute; never longer than `every`. |

`baseUrl` is not read. By convention it is `https://heartbeat.invalid` — a
domain reserved never to resolve — which is what `isitdown import` writes.

Set `HEARTBEAT_TOKEN` and give the job its URL — the last line of a crontab:

```bash
0 3 * * * /usr/local/bin/backup.sh && curl -fsS "https://isitdown.example.com/heartbeat/nightly-backup?token=$HEARTBEAT_TOKEN"
```

`GET` and `POST` both count. The provider reads `operational` until `every` plus
`grace` has run out since the last ping, and `major_outage` from then on — the
verdict goes through the diff engine and the routing like any outage, so a
missed run notifies through the same channels and rules. A job that has never
called is measured from when the monitor was first read: it is late after its
first period, not pending forever. A ping also reads the provider straight
away, so a late job that has now called resolves in seconds; pings within ten
seconds of one another are recorded without another read (`202`).

`GET /config/heartbeats` lists every heartbeat's URL with when its job last
called and how many times — the only proof a crontab line is right. The token
appears in it only for a request that could also write; a read-only
`API_TOKEN` holder sees `<HEARTBEAT_TOKEN>` in its place. Like the push URL
([3.15](#315-provider-push-instead-of-poll)), the ping route is never gated by
`API_TOKEN` — its caller is a script — so treat the URL as the secret it is and
serve it over HTTPS. A ping that arrives while the instance itself is down is
lost: the next one puts the provider right.

### 3.20 Dependencies — "what this runs on"

Half of a fleet runs on the other half: Vercel on AWS, a thousand SaaS products
on Cloudflare. When several providers go bad together, the shared-failure alert
([`correlationThreshold`](#31-light-edition--configyml)) says *that* they did.
A `dependsOn` list is how an operator tells it *why* (roadmap 2.9) — in
`config.yml`:

```yaml
services:
  - name: Vercel
    id: vercel
    adapter: statuspage
    baseUrl: https://www.vercel-status.com
    dependsOn: [cloudflare]
  - name: Linear
    id: linear
    adapter: statuspage
    baseUrl: https://linearstatus.com
    dependsOn: [cloudflare]
```

When two or more of the providers in a shared failure name the same upstream,
the message gains a line — "Probable cause: cloudflare" — and so does the
digest entry. In the UI edition the field is `dependsOn` on
`POST /config/services` and `PATCH /config/services/:id` (`null` clears it);
the dashboard edits it as the **Depends on** row of the provider form.
While two enabled providers that name the same upstream are degraded or down,
the Overview draws a *Shared failure* card — the upstream in the middle, its
dependents around it — and it disappears the moment either recovers. The History
view's *Break together* card (roadmap 2.10, `GET /coincidence`) proposes pairs
that keep going down together; **Declare dependency** writes the same
`dependsOn`, **Dismiss** hides the pair on that browser only.

- **Declared, never inferred.** IsItDown does not guess a graph from outages: a
  coincidence would be called a cause.
- **Wording only.** It does not start a correlation the window did not find,
  and a provider that names an upstream nobody else names changes nothing.
- **The upstream need not be monitored here.** Name a cloud you only depend on
  and it is still named as the cause. The slug is not checked against the fleet.
- **Ties** go to the id that sorts first, so the same window always names the
  same cause.

### 3.21 Recipients — one person, several channels

Somebody on both Telegram and Discord hears every alert twice, so they mute one
of the two — and lose the redundancy the second channel was there for. A
*recipient* groups channels that reach the same person (or the same team), in
order of preference: a change goes to the first one, and to the next only when
that one has failed for good, retries spent.

```yaml
recipients:
  - id: alice
    name: Alice
    channels: [telegram, discord]   # preferred first, then fallbacks in order
```

- **The rules still decide who may hear.** A recipient only decides how many
  times. A change reaches the recipient's channels *that its rule reached*, in
  the recipient's order — so a rule that keeps a provider off Discord keeps it
  off Discord's fallback too.
- **Both sides are logged.** A fallback writes the preferred channel's failure
  and the fallback's delivery into the delivery log, so the log still shows the
  channel that needed it, and [`channelHealth`](#38-delivery-policy--quiet-hours-digests-caps)
  still counts that failure.
- **A digest** goes to the recipient's preferred channel, falling back the same
  way when its window closes.
- **The rules for a list**: at least two channels each, a channel in at most one
  recipient, and every channel one the configuration defines — the Light
  edition refuses to start on a recipient naming a channel `notifications` does
  not have, as it does for a routing rule.

The Light edition configures them as the `recipients` list above; the UI edition
edits them from **Settings → Notifications → Recipients**, saved as a whole
(`PUT /config/recipients`). Export and import carry them; web push has no place
in a `config.yml`, so it is left out of an exported recipient.

### 3.22 Following one incident

The provider you normally keep off your phone can have the incident you need to
hear every word of. **Follow** on an open incident's page sends every later
update of that incident to every enabled channel until it resolves, without
touching a routing rule; the resolution is the last message, and the follow ends
with it. It is about that incident only — the provider's other changes still go
where the rules send them. Quiet hours still apply: following says "tell me
every update", not "wake me for every update". Recipients
([3.21](#321-recipients--one-person-several-channels)) still collapse, so a
person with two channels hears each update once.

**UI edition only** — the Light edition has no page to press it on. The routes
are `PUT` and `DELETE /incidents/:providerId/:incidentId/follow`; a resolved
incident cannot be followed (409). A follow is not part of a backup, for the
reason an acknowledgement is not: restored, it would send every channel updates
about an incident nobody is watching any more.

### 3.23 Why a provider matters — impact and owner

At 3 a.m. "GitHub — MAJOR OUTAGE" is a status word; "deploys blocked, CI
stopped — ask @alice" is a handover note. Two optional fields on a provider say
that much:

```yaml
services:
  - name: GitHub
    id: github
    adapter: statuspage
    baseUrl: https://www.githubstatus.com
    impact: deploys blocked, CI stopped   # up to 200 characters
    owner: "@alice"                       # up to 80 characters
```

Both are added under every message about that provider — "Impact: …" and
"Owner: …", in the channel's language — and shown on its page in the dashboard.
A channel with a template ([3.11](#311-per-channel-locale-and-template)) places
them itself with `{{impact}}` and `{{owner}}`, so they are not appended twice. A
digest, which is about several providers, and a failing-channel alert, which
only names a provider because the lost message was about it, carry neither. In
the UI edition they are the **Why it matters** and **Owner** fields of the
provider form, and `impact` / `owner` on `POST /config/services` and
`PATCH /config/services/:id` (`null` clears either).

### 3.24 Customising the Overview

UI edition only. Everything under the Overview's headline is a list of widgets
the operator arranges: **Customise** (beside the headline's actions, or
**Customise the Overview** in ⌘K) turns the page into its own editor, with live
data, and nothing is stored until **Save**.

- **Widgets** are the blocks the Overview always drew — fleet rings, map, shared
  failure, groups, fleet list — plus a catalogue of twenty-four more, each built
  on data the dashboard already reads:

  | Widget | Shows | Points at |
  |---|---|---|
  | Open incidents | every open incident, worst first, and how long it has been open | a fleet slice |
  | Upcoming maintenance | announced windows in the next two weeks, on a lane with today on it | a fleet slice |
  | Error budget | this month's budget per SLA target ([3.13](#313-sla-targets-and-error-budgets)) against how much of the month is gone | a fleet slice |
  | Provider | one provider, large: status, uptime, last 30 days, the incident in progress | one provider, or the worst right now |
  | Last 30 days | daily uptime per provider on one scale, and the change on the 30 days before | a fleet slice |
  | Year calendar | a year of one provider, a square a day | one provider, or the worst |
  | When incidents start | incident starts by weekday and hour over 90 days, from ten incidents up | — |
  | MTTR and MTBF | repair time and time between failures over 90 days | a fleet slice |
  | Annotations and deploys | your markers on the same week as the incidents, and which incident followed which deploy | — |
  | Delivery health | whether the alerts arrived, per channel, hour by hour | — |
  | Job heartbeats | every dead-man's switch ([3.19](#319-heartbeats--the-dead-mans-switch)) and how close it is to going off | — |
  | Break together | providers that go down together, with a one-click `dependsOn` ([3.20](#320-dependencies--what-this-runs-on)) | — |
  | Who to call | every provider down right now, with the impact and owner written on it ([3.23](#323-why-a-provider-matters--impact-and-owner)) | a fleet slice |
  | Suspected | providers whose page reads fine while their probe does not | a fleet slice |
  | Degraded components | every broken component, including the ones an operational provider hides | a fleet slice |
  | Stale readings | providers whose adapter keeps failing, or whose page has stopped moving | a fleet slice |
  | Group status | each group's derived status, naming the member that is the reason ([3.10](#310-provider-groups--my-stack)) | — |
  | Poller pulse | when the last cycle ran, when the next is due, who did not answer | — |
  | Latest alerts | the last messages sent, per channel, and whether each landed | — |
  | Muted | muted providers and how long is left, with Unmute | — |
  | Who got worse | uptime over 30 days against the 30 before, biggest fall first | a fleet slice |
  | Noise ranking | incidents per provider over 30 days | a fleet slice |
  | Who says it first | how long each status page takes to admit a failure its probe saw | — |
  | Page honesty | of the failures a probe saw, how many the page ever admitted | — |

  Each can appear more than once, and each draws its summary at a third of the
  row rather than a squeezed copy of its full self.
- **Every number is a link** (roadmap 4.3). A count, a duration or an uptime on
  a widget opens the rows behind it, with the filters already applied: an
  incident count opens Incidents on that provider and window, an uptime or a
  repair time opens History with that provider's drawer, a failed-delivery count
  opens the delivery log on its failures. The filters travel in the address
  (`#/incidents?provider=github&days=30`), so the link is a bookmark too; the
  destination shows a **From the Overview** chip saying what it was narrowed to,
  and its ✕ goes back to the whole list.
- **Width** is one of full, two thirds, half or a third of the row; height is the
  widget's own. Below 768px every widget takes the full width.
- **Order** — drag the grip, press its ↑/↓ buttons, or focus the grip and use the
  arrow keys (Home and End send it to either end). Every move is announced.
- **Provider** — the provider tile and the year calendar point at one
  provider, or (the default) at whichever is worst right now.
- **Filter** — the fleet widgets take groups ([3.10](#310-provider-groups--my-stack))
  and individual providers, and show their union: "Cloud" beside "Payments", say.
  A filtered widget is captioned with what it shows. A provider or group deleted
  since is struck through in the filter, and a filter left with nothing in it
  says so — it never quietly widens to the whole fleet.
- **Reset to default** forgets the arrangement. An Overview nobody customised
  follows the built-in layout, so blocks added by later releases reach it on
  their own; a customised one keeps exactly what was saved.

**While you were away** (roadmap 4.4). Coming back after eight hours or more,
the Overview opens with one card above the widgets: what is still open, what
resolved, which maintenance ran and how many alerts were sent (and failed) since
the last visit. **Seen** stores that time in the instance's preferences, so
another browser does not replay it; collapsing it is this browser's own choice.
A first visit, a shorter absence or an absence nothing happened in draws no
card — the last visit just moves to now.

The headline above the widgets is fixed: it is the "is anything wrong?" answer,
and no arrangement hides it. Two tabs editing at once do not overwrite each
other — the later save is told and offered both copies. The layout lives in the
database, so a backup carries it; over the API it is `GET`/`PUT /dashboards/default`
([6](api.md)).

**Named dashboards.** The Overview can have more than one arrangement — "My
stack", "Vendors we pay", "Incident in progress" — each with its own widgets
under the same headline. The header's **⋯** menu beside the title makes a new
one, empty, as a copy of the one open, or on the built-in layout; once there is
a second, they are listed in the rail under **Overview** (a picker at the top of
the page below 768px, and in ⌘K). The same menu renames, duplicates, deletes
(with Undo) and makes one **home** — the one `#/overview` opens on; each has its
own address, `#/overview/<id>`, which a rename does not change. Names are unique
regardless of case, and there can be up to twenty.

**Export JSON** in that menu downloads one dashboard as a file
(`{ format: "isitdown.dashboard", version: 1, name, layout }`) to share or keep;
**Import from file** creates a new dashboard from one, from this install or
another. An imported name already in use is numbered, and a provider the file
names that does not exist here is shown as removed, as above.
