import { test } from "node:test";
import assert from "node:assert/strict";
import {
  previewChannels,
  PREVIEW_KINDS,
} from "../../src/ui/notificationPreview.ts";
import { renderMessage } from "../../src/notifiers/formatting.ts";
import type { RuntimeConfig } from "../../src/core/configSource.interface.ts";

const NOW = new Date("2026-08-20T18:00:00.000Z");

const config = (over: Partial<RuntimeConfig> = {}): RuntimeConfig =>
  ({
    locale: "en",
    services: [
      {
        id: "github",
        name: "GitHub",
        adapter: "statuspage",
        baseUrl: "https://www.githubstatus.com",
        enabled: true,
        components: [],
        scopeToComponents: false,
      },
    ],
    channels: [
      { id: "telegram", enabled: true, settings: {} },
      { id: "slack", enabled: false, settings: {} },
    ],
    polling: {
      intervalMinutes: 3,
      requestTimeoutSeconds: 8,
      maxRetries: 3,
      failureThreshold: 5,
    },
    rules: [],
    delivery: {},
    ...over,
  }) as unknown as RuntimeConfig;

test("a text channel's preview is byte for byte what it would post", () => {
  const preview = previewChannels(config(), "status_change", NOW);
  const telegram = preview.channels.find(
    (channel) => channel.channel === "telegram",
  );
  assert.ok(telegram?.text !== null && telegram?.text !== undefined);
  assert.equal(
    telegram.text,
    renderMessage({
      change: {
        kind: "status_change",
        providerId: "github",
        previousStatus: "operational",
        currentStatus: "major_outage",
        at: NOW.toISOString(),
      },
      service: {
        id: "github",
        name: "GitHub",
        statusUrl: "https://www.githubstatus.com",
      },
      locale: "en",
    }),
    "or the preview is a drawing of a message rather than the message",
  );
});

test("a channel that builds its own structure shows the parts, never an invented shape", () => {
  const preview = previewChannels(config(), "status_change", NOW);
  const slack = preview.channels.find((channel) => channel.channel === "slack");
  assert.equal(
    slack?.text,
    null,
    "a mock-up of a Slack block would be believed and could drift",
  );
  assert.ok((slack?.parts.heading ?? "").includes("GitHub"));
  assert.equal(slack?.parts.url, "https://www.githubstatus.com");
});

test("each channel renders in its own language, which is the point of the view", () => {
  const preview = previewChannels(
    config({
      channels: [
        { id: "telegram", enabled: true, settings: {}, locale: "it" },
        { id: "ntfy", enabled: true, settings: {} },
      ],
    } as unknown as Partial<RuntimeConfig>),
    "status_change",
    NOW,
  );
  const byId = new Map(
    preview.channels.map((channel) => [channel.channel, channel]),
  );
  assert.equal(byId.get("telegram")?.locale, "it");
  assert.equal(byId.get("ntfy")?.locale, "en", "the configured default");
  assert.notEqual(byId.get("telegram")?.text, byId.get("ntfy")?.text);
});

test("a disabled channel is previewed too, and says that it is disabled", () => {
  const preview = previewChannels(config(), "status_change", NOW);
  // Setting a channel up is exactly when it is not enabled yet.
  assert.deepEqual(
    preview.channels.map((channel) => [channel.channel, channel.enabled]),
    [
      ["telegram", true],
      ["slack", false],
    ],
  );
});

test("every previewable transition renders for every channel", () => {
  for (const kind of PREVIEW_KINDS) {
    const preview = previewChannels(config(), kind, NOW);
    assert.equal(preview.kind, kind);
    for (const channel of preview.channels) {
      assert.notEqual(
        channel.parts.heading,
        "",
        `${kind} on ${channel.channel}`,
      );
    }
  }
});

test("a fleet with no providers still previews, which is when channels get set up", () => {
  const preview = previewChannels(
    config({ services: [] }),
    "incident_opened",
    NOW,
  );
  assert.equal(preview.provider, "Example Provider");
  assert.ok(preview.channels[0]?.parts.heading.includes("Example Provider"));
});
