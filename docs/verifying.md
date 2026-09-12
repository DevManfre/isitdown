[← README](../README.md)

## 5. Verifying a deployment

Everything in this section has been run against the built containers. Expected
output is shown so a difference is obvious.

The examples pipe JSON through [`jq`](https://jqlang.github.io/jq/) for
readability. It is not required — drop the pipe to see the raw body, or use the
runtime you already have:

```bash
curl -s localhost:3000/status | jq '.providers[] | {id, overallStatus}'   # with jq
curl -s localhost:3000/status | node -e 'process.stdin.toArray().then(c => {
  for (const p of JSON.parse(Buffer.concat(c)).providers) console.log(p.id, p.overallStatus);
})'                                                                       # without
```

### 5.1 Smoke checks

```bash
docker ps --format "{{.Names}} {{.Status}}"
#   isitdown-light  Up 2 minutes (healthy)
#   isitdown-ui     Up 2 minutes (healthy)

docker exec isitdown-light node dist/light/healthcheck.js; echo "exit=$?"   # exit=0
docker exec isitdown-ui    node dist/ui/healthcheck.js;    echo "exit=$?"   # exit=0

docker logs -f isitdown-light
#   {"level":"info","msg":"isitdown light started",...}
#   {"level":"info","msg":"poll cycle finished","providers":3,"failed":0,"changes":0}
```

`changes:0` on the first cycle is correct: a first observation is a baseline, not
news.

Confirm the Light edition really runs no server:

```bash
docker ps --format "{{.Names}} ports={{.Ports}}" | grep light   # ports= is empty
docker exec isitdown-light sh -c "ps -o pid,args"            # only node dist/light/index.js
```

Confirm nothing secret was baked into an image:

```bash
docker history isitdown:ui --no-trunc --format "{{.CreatedBy}}" | grep -iE "TOKEN=|SECRET="
# no output
```

### 5.2 The dashboard

Open **http://localhost:3000** and walk the rail: Overview · Providers ·
Incidents · History · Delivery log · Settings. Then check the two runtime controls
in the header:

- the **theme** button cycles light → dark → system and survives a reload;
- the **EN / IT** switch changes every string with no page reload, including the
  time format (`7:36 PM` vs `19:36`) and decimal separator (`99.87%` vs `99,87%`).

The browser tab answers the same question without being looked at: while
something is wrong, the title counts the providers in trouble (`2 providers in
trouble · IsItDown`) and the favicon takes a dot in that severity's colour. A
calm fleet puts the page's own icon and title back, so a dot in the tab always
means there is something to open. A provider that has never been read
successfully is not "trouble" — a first cycle that has not landed yet must not
show a red tab — and a disabled provider is off the dashboard entirely.

Every view's toolbar follows one rule: a control that changes what is on screen
is a segmented tray — joined buttons in a tinted, bordered strip, with the
active one lifted out of it — and everything that takes the view away with you
sits behind a single **Download** menu. Before, a range toggle, two download
sentences and two format pairs were all ghost buttons of the same weight, and
nothing said which of them belonged together.

On **History**, clicking a provider's row opens its drawer: the three windows,
the daily bars with their colour key, and — roadmap 5.20 — a **year heat
calendar**, one cell per day coloured by that day's worst status. Retention can
run to 3650 days, while the widest chart stayed a 90-day bar row, so everything
older was stored and never shown; the calendar is that year. A day nobody
sampled is drawn muted rather than green, and hovering a cell says what the day
was and how much of it was up.

Above the list, **Compare** (roadmap 5.7) overlays two providers' daily uptime on
one pair of axes — the question a vendor decision actually asks, and the one the
worst-first ranking cannot answer because it never puts two rows on the same
scale. It opens on the two worst providers, either picker changes a side, and
picking the provider already on the other side swaps them. The two lines take
their own colours rather than status colours: the chart says which measured
better, not that one of them is operational and the other is not.

The same data over HTTP:

```bash
curl -s localhost:3000/history/calendar?provider=github | jq '.measuredDays, .uptime'
curl -s localhost:3000/status | jq '.providers[] | {id, overallStatus, uptime90}'
curl -s localhost:3000/history?days=7 | jq '{aggregateUptime, months}'
curl -s localhost:3000/config | jq '.channels'        # variable names only, never values
curl -s -X POST localhost:3000/poll                   # force a cycle now
```

Add a provider and confirm it is picked up on the next cycle without a restart:

```bash
curl -s -X POST localhost:3000/config/services -H 'content-type: application/json' \
  -d '{"id":"vercel","name":"Vercel","adapter":"statuspage","baseUrl":"https://www.vercel-status.com"}'

curl -s -X POST localhost:3000/config/services/vercel/test
#   {"ok":true,"overallStatus":"operational"}
```

A connection test reaches the provider but records nothing: no sample, no incident,
no notification. It is diagnostics, not history.

Removing a provider is undoable. The confirmation names what the removal will
eventually take (samples, incidents, maintenance windows, routing rules, and the
span of history behind them), then the provider leaves the dashboard while its
history waits out a restore window — `Settings → Recently removed` offers
**Restore** and **Remove now** until it closes:

```bash
curl -s -X DELETE localhost:3000/config/services/vercel
#   {"removed":"vercel","removedAt":"...","restoreUntil":"..."}
curl -s localhost:3000/config | jq '.removed[] | {id, restoreUntil}'
curl -s -X POST localhost:3000/config/services/vercel/restore    # undo
```

The **Delivery log** view is the other half of that honesty: every notification
that was attempted, failed ones first, each row expanding to the exact payload
sent and the channel's own error string. A credential that went stale shows up
there instead of as alerts that quietly stopped arriving.

A failed send is retried up to three times with exponential backoff and jitter,
so a rate limit or a restarting webhook receiver no longer loses an alert. One
row is written per *message*, not per attempt, and it carries how many attempts
it took: a send that landed on the second try reads as delivered, and one that
spent all three is badged **Dead letter** — the alert is gone, which is a
different statement from "failed". A delivery test from Settings is tried once
on purpose: the operator is waiting for the answer.

### 5.3 Configuration changes apply without a restart

**Light.** Edit `./config.yml` on the host — it is mounted read-only but re-read at
the start of every cycle. Add a provider and lower the interval:

```bash
docker logs -f isitdown-light
#   ..."poll cycle finished","providers":3      ← before
#   ..."poll cycle finished","providers":4      ← after, no restart
```

Measured: adding a fourth provider and changing `pollIntervalMinutes` from 3 to 1
took effect on the next cycle, and the following gap shrank to ~56s (one minute
minus jitter).

**UI.** Change the interval in Settings, or:

```bash
curl -s -X PATCH localhost:3000/config/settings \
  -H 'content-type: application/json' -d '{"intervalMinutes":10}'
curl -s localhost:3000/status | jq .pollIntervalMinutes    # 10
```

Confirm invalid configuration is refused loudly rather than half-applied:

```bash
docker run --rm isitdown:light
#   ..."isitdown light failed to start","error":"config file /app/config/config.yml
#      was not found — mount it or set CONFIG_PATH"   → exit 1

printf 'services: []\n' > /tmp/bad.yml
docker run --rm -v /tmp/bad.yml:/app/config/config.yml:ro isitdown:light
#   ..."error":"config file ... is invalid: services: at least one service is required"
```

### 5.4 End-to-end notification test

Waiting for a real outage is not a test. This gives you a provider whose status you
control, plus a sink that accepts the webhook — one throwaway container serves both.

```bash
mkdir -p /tmp/sw-test/html/api/v2
echo '{"status":{"indicator":"none"},"incidents":[]}' > /tmp/sw-test/html/api/v2/summary.json

cat > /tmp/sw-test/nginx.conf <<'CONF'
server {
  listen 80;
  location /api/v2/summary.json { root /usr/share/nginx/html; default_type application/json; }
  location /hook { access_log /dev/stdout; return 200 '{"received":true}'; }
}
CONF

docker run -d --name fake-provider --network isitdown_default \
  -v /tmp/sw-test/html:/usr/share/nginx/html:ro \
  -v /tmp/sw-test/nginx.conf:/etc/nginx/conf.d/default.conf:ro \
  nginx:alpine
```

Point the webhook channel at the sink. `WEBHOOK_URL` is read when the container
starts, so recreate it:

```bash
sed -i 's|^WEBHOOK_URL=.*|WEBHOOK_URL=http://fake-provider/hook|' .env
docker compose --profile ui up -d --force-recreate
```

Register the fake provider and enable the channel:

```bash
curl -s -X POST localhost:3000/config/services -H 'content-type: application/json' \
  -d '{"id":"fake","name":"Fake Provider","adapter":"statuspage","baseUrl":"http://fake-provider"}'
curl -s -X PATCH localhost:3000/config/channels/webhook \
  -H 'content-type: application/json' -d '{"enabled":true}'
```

Now drive the transitions:

```bash
# 1. baseline — must send nothing
curl -s -X POST localhost:3000/poll | jq '{changes}'        # {"changes": 0}

# 2. break it
cat > /tmp/sw-test/html/api/v2/summary.json <<'JSON'
{"status":{"indicator":"critical"},
 "incidents":[{"id":"fake-1","name":"Everything is on fire","impact":"critical",
               "status":"investigating","updated_at":"2026-08-19T18:00:00.000Z"}]}
JSON
curl -s -X POST localhost:3000/poll | jq '{changes}'        # {"changes": 2}

# 3. poll again with nothing changed — must stay silent
curl -s -X POST localhost:3000/poll | jq '{changes}'        # {"changes": 0}

curl -s localhost:3000/notifications | jq -r '.notifications[] | "\(.ok) \(.kind) \(.text | split("\n")[0])"'
#   true incident_opened 🔴 Fake Provider — MAJOR OUTAGE
#   true status_change   🔴 Fake Provider — MAJOR OUTAGE
```

The feed is newest first and persists in the data volume, so a database that has
seen earlier runs will show their entries below these two.


Recovery, and restart safety:

```bash
echo '{"status":{"indicator":"none"},"incidents":[]}' > /tmp/sw-test/html/api/v2/summary.json
curl -s -X POST localhost:3000/poll | jq '{changes}'        # {"changes": 2} → resolved + operational

docker compose --profile ui restart
curl -s -X POST localhost:3000/poll | jq '{changes}'        # {"changes": 0} — nothing re-notified
curl -s 'localhost:3000/incidents?state=resolved' | jq '.page.items[] | {incidentId, startedAt, resolvedAt}'
```

The same flow works on the Light edition: add the fake provider to `config.yml`,
set `webhook.enabled: true`, and the log shows the sends:

```
..."poll cycle finished","providers":4,"failed":0,"changes":2
..."notification sent","channel":"webhook","providerId":"fake","kind":"status_change"
..."notification sent","channel":"webhook","providerId":"fake","kind":"incident_opened"
```

Clean up:

```bash
docker rm -f fake-provider
curl -s -X DELETE localhost:3000/config/services/fake
curl -s -X PATCH localhost:3000/config/channels/webhook \
  -H 'content-type: application/json' -d '{"enabled":false}'
sed -i 's|^WEBHOOK_URL=.*|WEBHOOK_URL=|' .env
rm -rf /tmp/sw-test
```

### 5.5 Testing Telegram

Telegram is the channel most people actually want, and the one worth confirming for
real. Create a bot with [@BotFather](https://t.me/botfather), send it a message,
then read your chat id from
`https://api.telegram.org/bot<TOKEN>/getUpdates`.

In the UI edition, both values can be saved from **Settings → Telegram**, or
through the API — either way no restart is involved:

```bash
curl -s -X PUT localhost:3000/config/channels/telegram/secrets \
  -H 'content-type: application/json' \
  -d '{"fields":{"botToken":"123456:AA...","chatId":"-1001234567890"}}'

curl -s -X PATCH localhost:3000/config/channels/telegram \
  -H 'content-type: application/json' -d '{"enabled":true}'
curl -s -X POST localhost:3000/config/channels/telegram/test    # {"ok":true}
```

Through `env_file` instead, the container has to be recreated for it to read them:

```bash
sed -i 's|^TELEGRAM_BOT_TOKEN=.*|TELEGRAM_BOT_TOKEN=123456:AA...|' .env
sed -i 's|^TELEGRAM_CHAT_ID=.*|TELEGRAM_CHAT_ID=-1001234567890|' .env
docker compose --profile ui up -d --force-recreate
```

A failure comes back as `{"ok":false,"error":"telegram notification failed: HTTP 400 (chat not found)"}` —
the status code and Telegram's own description, never the token.

For the Light edition, set the same two variables, `telegram.enabled: true` in
`config.yml`, and restart the container so it picks the secrets up.

### 5.6 Troubleshooting

| Symptom | Likely cause |
|---|---|
| Light container exits immediately, exit 1 | Configuration. `docker logs` names the file, the path and the reason. |
| `the telegram channel is enabled but TELEGRAM_BOT_TOKEN is not set` | `.env` is not being passed. Check `env_file` and recreate the container — env is read at start. |
| Container stuck `starting` forever | The healthcheck never passed. Light: `state.json` is not being written, so no cycle completed. UI: `/ready` is answering 503 — its `reason` field names which of the three failures it is, and `docker inspect` carries it in the health log. |
| Dashboard loads but the grid is empty | No cycle has run yet. `POST /poll`, or wait one interval. |
| A provider shows `unknown` | It has never been polled successfully. UI edition: **Settings → the provider's row → Diagnose** shows the last reads with their errors and reads the page on demand (`GET /debug/adapters`, `POST /debug/adapters/<id>/probe`). A page that reads but parses into nothing — a scrape whose selector no longer matches — is called out there. |
| No notifications during the night, or one message instead of several | The delivery policy is doing its job. Check **Settings → Delivery** (or the `delivery` block): quiet hours drop what is under their floor, and the digest holds it for its window. |
| One provider is polled and another is not | Either its own `intervalMinutes` has not elapsed, or it answered `Retry-After` and is being left alone until the window it stated passes — `docker logs` carries `provider asked to be left alone` with the deadline. |
| Provider shows `degraded` but Incidents is empty | Correct. Statuspage derives the indicator from component state too; there may be no incident record. |
| Uptime reads `0%` for a provider | It has exactly one sample and it was not operational. It rises with the next cycles. |
| A month column shows `—` | No samples in that month. Deliberately not `0%`, which would read as a month-long outage. |
| No notifications ever arrive | Is the channel `enabled`, and does its variable resolve? `GET /config` shows `isSet` per field. Then `POST /config/channels/<id>/test`. |
| Notifications arrive repeatedly for the same thing | Should be impossible — the diff engine is the only thing that decides. Capture `docker logs` and the `/notifications` feed. |
| Dashboard shows raw keys like `nav.overview` | A key with no catalog entry — should be impossible, the locale-guard tests catch every literal `t("...")` call before it ships. A dynamically built key (`t(prefix + suffix)`) is the one shape those tests cannot see; check the call site. |

Turn up the detail with `LOG_LEVEL=debug`, which logs every individual poll attempt
including retries.

Logs go to stdout, which is what a container wants and what a bare-metal install
does not: set `LOG_FILE=/var/log/isitdown/isitdown.log` and the same lines are
also appended there, rotated at `LOG_MAX_BYTES` into `LOG_MAX_FILES` numbered
generations. The file is additional — stdout keeps carrying everything, so
`docker logs` still works on a container that has both. A path that cannot be
written disables the file after saying so once on stdout; polling and
notifications are never held up by a full or read-only disk.
