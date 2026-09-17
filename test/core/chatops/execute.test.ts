import { test } from "node:test";
import assert from "node:assert/strict";
import { handleMessage } from "../../../src/core/chatops/execute.ts";
import type {
  ChatHistory,
  ChatopsBackend,
  ChatProvider,
} from "../../../src/core/chatops/backend.interface.ts";

const provider = (over: Partial<ChatProvider> = {}): ChatProvider => ({
  id: "github",
  name: "GitHub",
  status: "operational",
  openIncidents: 0,
  uptime90: 99.98,
  mutedUntil: null,
  underMaintenance: false,
  ...over,
});

const history = (over: Partial<ChatHistory> = {}): ChatHistory => ({
  providerId: "github",
  name: "GitHub",
  days: 30,
  uptime: 99.5,
  measuredDays: 30,
  incidents: 2,
  worstDay: { day: "2026-09-02", uptime: 91.2 },
  ...over,
});

function backend(over: Partial<ChatopsBackend> = {}): ChatopsBackend & { muted: string[] } {
  const muted: string[] = [];
  return {
    muted,
    listProviders: async () => [provider()],
    history: async () => history(),
    mute: async (id, until) => {
      muted.push(`${id}:${until}`);
    },
    unmute: async (id) => {
      muted.push(`${id}:off`);
    },
    ...over,
  };
}

const ask = (text: string, deps: ChatopsBackend, now = new Date("2026-09-17T10:00:00.000Z")) =>
  handleMessage({ backend: deps, locale: "en", text, now });

test("chatter is answered with silence rather than an error", async () => {
  assert.equal(await ask("did anyone see that outage", backend()), null);
});

test("/status lists the fleet worst first, not alphabetically", async () => {
  const deps = backend({
    listProviders: async () => [
      provider({ id: "aws", name: "AWS", status: "operational" }),
      provider({ id: "zoom", name: "Zoom", status: "major_outage", openIncidents: 1 }),
      provider({ id: "cloudflare", name: "Cloudflare", status: "degraded" }),
    ],
  });
  const reply = (await ask("/status", deps)) ?? "";
  const lines = reply.split("\n").filter((line) => line.startsWith("🔴") || line.startsWith("🟡") || line.startsWith("🟢"));
  assert.deepEqual(
    lines.map((line) => line.split(" ")[1]),
    ["Zoom", "Cloudflare", "AWS"],
  );
  assert.match(reply, /2 of 3/);
});

test("a fleet with nothing wrong says so, rather than counting zero outages", async () => {
  const reply = (await ask("/status", backend())) ?? "";
  assert.match(reply, /All 1 provider\(s\) are operational/);
});

test("/status names a provider by its display name as well as its id", async () => {
  const byName = (await ask("/status GitHub", backend())) ?? "";
  const byId = (await ask("/status github", backend())) ?? "";
  assert.equal(byName, byId);
  assert.match(byName, /90-day uptime: 99\.98%/);
});

test("a mute running is reported beside the status, so /status explains its own silence", async () => {
  const deps = backend({
    listProviders: async () => [provider({ mutedUntil: "2026-09-17T12:00:00.000Z" })],
  });
  assert.match((await ask("/status github", deps)) ?? "", /muted until 2026-09-17 12:00 UTC/);
});

test("/mute writes the deadline the duration asked for", async () => {
  const deps = backend();
  const reply = (await ask("/mute github 2h", deps)) ?? "";
  assert.deepEqual(deps.muted, ["github:2026-09-17T12:00:00.000Z"]);
  assert.match(reply, /muted until 2026-09-17 12:00 UTC/);
});

test("/unmute clears it", async () => {
  const deps = backend();
  assert.match((await ask("/unmute github", deps)) ?? "", /no longer muted/);
  assert.deepEqual(deps.muted, ["github:off"]);
});

test("a command naming something we do not watch says so instead of failing", async () => {
  assert.match((await ask("/mute stripe 2h", backend())) ?? "", /not watching anything called stripe/);
});

test("/history reports uptime, incidents and the worst day", async () => {
  const reply = (await ask("/history github 30", backend())) ?? "";
  assert.match(reply, /last 30 day\(s\)/);
  assert.match(reply, /99\.50% over 30 measured day\(s\)/);
  assert.match(reply, /Incidents: 2/);
  assert.match(reply, /2026-09-02 at 91\.20%/);
});

test("an unmeasured window says nothing was measured rather than 0%", async () => {
  // 0.00% is what an outage looks like. A provider added yesterday has not had
  // a bad 30 days, it has not had 30 days.
  const deps = backend({ history: async () => history({ uptime: null, measuredDays: 0 }) });
  assert.match((await ask("/history github", deps)) ?? "", /Nothing has been measured/);
});

test("a backend that throws becomes a sentence, because somebody is waiting for a reply", async () => {
  const deps = backend({
    listProviders: async () => {
      throw new Error("database is locked");
    },
  });
  assert.match((await ask("/status", deps)) ?? "", /did not work: database is locked/);
});

test("the reply is translated, like every other string a person reads", async () => {
  const reply = await handleMessage({ backend: backend(), locale: "it", text: "/help" });
  assert.ok(reply !== null);
  assert.ok(!reply.includes("this message"), "the Italian help text should not be the English one");
});
