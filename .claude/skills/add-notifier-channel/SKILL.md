---
name: add-notifier-channel
description: Scaffold a new notification channel (e.g. Slack, Discord, email, SMS, PagerDuty) for IsItDown. Use whenever the user wants to add a way to be alerted about status changes beyond the existing Telegram/webhook channels, or asks "how do I get notified via X".
---

# Add Notifier Channel

Scaffolds a new notifier under `src/notifiers/` for delivering status-change alerts through a new channel. Notifiers are consumed by the Diff Engine's dispatcher — they must never be called from anywhere else (poller, adapters, routes).

## Step 1 — Implement the interface

Create `src/notifiers/<channel>.notifier.ts`:

```ts
import { Notifier, NotificationPayload } from "../core/notifier.interface";

export const <channel>Notifier: Notifier = {
  id: "<channel>",

  async send(payload: NotificationPayload): Promise<void> {
    const message = formatMessage(payload); // see formatting conventions below

    const res = await fetch("<channel API endpoint>", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ /* channel-specific payload shape */ }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`<channel> notification failed: ${res.status}`);
    }
  },
};
```

## Step 2 — Formatting conventions (keep consistent across channels)

Every channel should render the same information, adapted to its native format:

- **State transition to degraded/outage**: `🔴 <Provider> — <SEVERITY>` header, then incident name, current status (`investigating` / `identified` / `monitoring`), last-updated timestamp, and a link back to the provider's status page.
- **State transition to resolved**: `🟢 <Provider> — RESOLVED` header, plus which incident was resolved.
- Use the emoji/severity mapping already defined in `src/notifiers/formatting.ts` (color/emoji per `overallStatus` value) — don't invent a new severity vocabulary per channel.
- Keep messages short enough for a mobile push notification (a few lines) — link out to the provider's status page for full detail rather than dumping the entire incident body.

## Step 3 — Config schema

Add the channel to the notifications config schema (`src/light/config/schema.ts` for Light, or the equivalent settings model for UI):

```yaml
notifications:
  <channel>:
    enabled: true
    # channel-specific fields, e.g. webhookUrl, apiKey — always via env var substitution
```

Never require secrets to be written directly into `config.yml` — always support `${ENV_VAR}` substitution, and document the required env var in `.env.example`.

## Step 4 — Register and test

- Register the notifier in `src/notifiers/index.ts`'s dispatcher map.
- Add a unit test that mocks the outbound `fetch` call and asserts the correct payload shape is sent for: (a) a degraded/outage transition, (b) a resolved transition. Never call a real external API in tests.
- If the channel has rate limits (e.g. Discord webhooks), note them in a comment and make sure the Diff Engine's "notify once per transition" behavior is respected — don't add per-notifier throttling that could suppress a real alert.

## Step 5 — Document

Add the new channel to the notifications table in `README.md` and to `config.example.yml` (disabled by default, with placeholder env var names).
