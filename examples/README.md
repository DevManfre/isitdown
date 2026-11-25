# Examples

Starting points for receiving IsItDown's generic webhook — the versioned event
described in [`docs/configuration.md` §3.6](../docs/configuration.md#36-notification-channels)
and published as [`schema/webhook-event.v1.json`](../schema/webhook-event.v1.json).

| File | Import into | What it does |
|---|---|---|
| `n8n-webhook-event.json` | n8n: *Workflows → Import from file* | A Webhook node on `POST /webhook/isitdown`, a check on `schemaVersion`, and a Switch on `change.kind` with one branch per common kind. |
| `node-red-webhook-event.json` | Node-RED: *Menu → Import* | An `http in` node on `POST /isitdown` that answers `204`, the same version check, and a switch on `change.kind` into debug nodes. |

Point the channel at the receiver (`WEBHOOK_URL`), then replace the placeholder
branches with what should happen. Both treat an unknown `schemaVersion` as its
own branch rather than guessing at a body they were not written for.

Neither verifies the signature: with `WEBHOOK_SECRET` set, check
`X-IsItDown-Signature` against the *raw* body before acting on it (see
**Signing** in the same section).
