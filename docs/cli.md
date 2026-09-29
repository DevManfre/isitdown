[← README](../README.md)

## 10. Terminal client

A third entrypoint beside Light and UI, for whoever keeps a terminal panel
open next to their logs instead of a browser tab (roadmap 17.7). It is a
**read-only client** of the UI edition's HTTP API — not a second dashboard and
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

### 10.2 How it stays live

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

### 10.3 Errors

A server that is unreachable, a token the instance rejects (`401`/`403`), or a
response that isn't the JSON this client expects all show up as the panel's
own connection line — never as a stack trace that breaks the layout. A
rejected token is the one case that stops rather than retries: no amount of
waiting fixes a wrong credential.

### 10.4 What it deliberately does not do

Every request this client makes is a `GET`. It has no code path that writes —
no polling trigger, no mute, no configuration change — so a token handed to it
only ever needs read access, and pointing it at an instance can never be
mistaken for administering one. Adding write access, another view, or a
second command is out of scope for this page; each would be its own roadmap
row.
