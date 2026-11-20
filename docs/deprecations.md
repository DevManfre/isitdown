[← README](../README.md)

## 13. Deprecations

IsItDown grows by adding, and a surface nobody uses still costs a test suite, a
translation and a review on every change near it. So surfaces also leave — but
never by surprise (roadmap 16.3). Each one:

1. keeps working for **one whole major version**, and says it is going — in the
   log, in the dashboard where it lives, and in this list;
2. is removed in the next major, with a line in that release's notes.

Everything below was deprecated in **2.46.0** and goes in **3.0.0**.

### 13.1 What is deprecated

| Surface | Why | Instead |
|---|---|---|
| The single-file Light binary (`isitdown-light-vX.Y.Z-linux-x64`, [Docker §4.5](docker.md#45-neither-the-single-file-light-edition)) | About 35 downloads across every release so far, and a release step of its own; the Light container image does the same job. | `ghcr.io/devmanfre/isitdown:light-latest`. The binary logs a warning at every start until then. |
| `GET /export/history.json` | Nothing in the dashboard links to it, and it repeats what the charts already read. | `GET /history` |
| `GET /export/trust.csv`, `GET /export/trust.json` | Not linked from the dashboard. | `GET /trust` |
| `GET /export/sla-evidence.json` | Not linked; the dashboard offers the Markdown. | `GET /export/sla-evidence.md` |
| `GET /export/report-card.json` | Not linked; the dashboard offers the Markdown. | `GET /export/report-card.md` |
| The **Wallboard** view (`/wallboard`) | An auxiliary page with no evidence of use. | The Overview in a full-screen browser window. The view now says it is going, at the foot of the screen. |
| **Install as an app** (Settings → Appearance) | The same: an auxiliary surface with no evidence of use. | The dashboard in a browser tab. Web push notifications are not affected — they keep their service worker. |

A deprecated export route answers exactly as before, plus two headers
([RFC 9745](https://www.rfc-editor.org/rfc/rfc9745)) a script can watch for —
`Deprecation: @1795046400` and a `Link` to this page with
`rel="deprecation"` — and the server logs `deprecated export served` once per
route per start. The OpenAPI document marks the five routes `deprecated: true`.

### 13.2 Telling us what you use

There is no telemetry, and there will not be. What decides the next list is
what operators choose to tell us, so there is a report built for exactly that:
counts and identifiers only — how many providers per adapter, which channels
and delivery features are on, which deprecated surfaces this installation has
touched — and never a provider name, a URL, a token or anything else that says
whose installation it is.

- **UI edition:** Settings → Data → **Usage report** → *Copy usage report*.
  The copy adds what only your browser knows (whether you opened the wallboard,
  whether this is the installed app), and *Open an issue with it* opens GitHub
  with the report filled in, for you to read before you post. The same JSON,
  without the browser's part, is `GET /config/usage-report`.
- **Light edition:** `node dist/light/check.js --usage [path]` prints it for
  your `config.yml`.

Nothing is sent by either. If a surface on your list is one you rely on, an
issue with the report attached is the way to keep it.
