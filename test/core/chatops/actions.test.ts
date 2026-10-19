import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACTION_MUTE_MINUTES,
  CALLBACK_DATA_LIMIT_BYTES,
  encodeAction,
  parseAction,
} from "../../../src/core/chatops/actions.ts";
import { handleCallback } from "../../../src/core/chatops/execute.ts";
import { parseCommand } from "../../../src/core/chatops/commands.ts";
import type { ChatopsBackend, ChatProvider } from "../../../src/core/chatops/backend.interface.ts";

const provider = (over: Partial<ChatProvider> = {}): ChatProvider => ({
  id: "github",
  name: "GitHub",
  status: "major_outage",
  openIncidents: 1,
  uptime90: 99.9,
  mutedUntil: null,
  underMaintenance: false,
  ...over,
});

function backend(over: Partial<ChatopsBackend> = {}): ChatopsBackend & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    listProviders: async () => [provider()],
    history: async () => null,
    mute: async (id, until) => void calls.push(`mute:${id}:${until}`),
    unmute: async (id) => void calls.push(`unmute:${id}`),
    ack: async (id, by) => {
      calls.push(`ack:${id}:${by}`);
      return { newly: true, by, at: "2026-09-17T10:00:00.000Z" };
    },
    ...over,
  };
}

const NOW = new Date("2026-09-17T10:00:00.000Z");
const press = (data: string, deps: ChatopsBackend, by = "telegram:42") =>
  handleCallback({ backend: deps, locale: "en", data, by, now: NOW });

test("an action survives the trip through a button's callback data", () => {
  assert.equal(encodeAction({ kind: "ack", providerId: "github" }), "ack:github");
  assert.equal(
    encodeAction({ kind: "mute", providerId: "github", minutes: ACTION_MUTE_MINUTES }),
    `mute:github:${ACTION_MUTE_MINUTES}`,
  );
  assert.deepEqual(parseAction("ack:github"), { kind: "ack", providerId: "github" });
  assert.deepEqual(parseAction("mute:github:120"), { kind: "mute", providerId: "github", minutes: 120 });
});

test("a provider id with a colon in it still round-trips", () => {
  const data = encodeAction({ kind: "mute", providerId: "team:payments", minutes: 120 });
  assert.deepEqual(parseAction(data!), { kind: "mute", providerId: "team:payments", minutes: 120 });
  assert.deepEqual(parseAction("ack:team:payments"), { kind: "ack", providerId: "team:payments" });
});

test("data that is not one of ours, or is malformed, is not an action", () => {
  for (const data of ["", "ack:", "ack", "mute:github", "mute:github:soon", "mute:github:0", "mute:github:-5", "nuke:github", "mute:github:99999999"]) {
    assert.equal(parseAction(data), null, JSON.stringify(data));
  }
});

test("an id that would not fit Telegram's limit gets no button rather than a broken one", () => {
  const long = "x".repeat(CALLBACK_DATA_LIMIT_BYTES);
  assert.equal(encodeAction({ kind: "ack", providerId: long }), null);
  assert.equal(encodeAction({ kind: "mute", providerId: long, minutes: 120 }), null);
  const fits = "y".repeat(CALLBACK_DATA_LIMIT_BYTES - "mute:".length - ":120".length);
  assert.equal(Buffer.byteLength(encodeAction({ kind: "mute", providerId: fits, minutes: 120 })!), CALLBACK_DATA_LIMIT_BYTES);
});

test("/ack names a provider, like the other commands that act on one", () => {
  assert.deepEqual(parseCommand("/ack GitHub"), { ok: true, command: { kind: "ack", providerId: "github" } });
  assert.deepEqual(parseCommand("/ack@isitdown_bot github"), { ok: true, command: { kind: "ack", providerId: "github" } });
  assert.deepEqual(parseCommand("/ack"), { ok: false, key: "chatops.error.provider-required" });
});

test("pressing Ack records who took it, and says so", async () => {
  const deps = backend();
  const reply = await press("ack:github", deps);
  assert.deepEqual(deps.calls, ["ack:github:telegram:42"]);
  assert.match(reply ?? "", /GitHub/);
  assert.match(reply ?? "", /in charge|taking|on it/i);
});

test("pressing Ack on something already taken says who has it and changes nothing", async () => {
  const deps = backend({
    ack: async () => ({ newly: false, by: "web", at: "2026-09-17T09:00:00.000Z" }),
  });
  const reply = await press("ack:github", deps);
  assert.match(reply ?? "", /web/);
  assert.match(reply ?? "", /already/i);
});

test("pressing Mute 2h mutes through the same backend call the /mute command uses", async () => {
  const deps = backend();
  const reply = await press("mute:github:120", deps);
  assert.deepEqual(deps.calls, ["mute:github:2026-09-17T12:00:00.000Z"]);
  assert.match(reply ?? "", /muted/i);
});

test("a button for a provider that no longer exists is answered, not thrown", async () => {
  const deps = backend({ listProviders: async () => [] });
  assert.match((await press("ack:ghost", deps)) ?? "", /ghost/);
  assert.deepEqual(deps.calls, []);
});

test("a press that is not one of ours gets silence", async () => {
  assert.equal(await press("something:else", backend()), null);
});

test("a backend that throws becomes a sentence, because somebody is waiting on the button", async () => {
  const deps = backend({
    ack: async () => {
      throw new Error("database is locked");
    },
  });
  assert.match((await press("ack:github", deps)) ?? "", /database is locked/);
});
