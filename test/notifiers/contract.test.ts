import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { BUILT_IN_CHANNEL_IDS, buildNotifiers } from "../../src/notifiers/index.ts";
import { ChannelError } from "../../src/notifiers/errors.ts";
import { fitText } from "../../src/notifiers/formatting.ts";
import type { Notifier } from "../../src/core/notifier.interface.ts";
import type { NotificationPayload } from "../../src/core/types.ts";
import { stubFetch, type CapturedRequest } from "../helpers/fetchStub.ts";
import { CASES, EXEMPT, type ContractCase } from "./contract/cases.ts";
import {
  ALL_KINDS,
  GOLDEN_PAYLOADS,
  INCIDENT_TITLE,
  anotherIncident,
  flood,
  opened,
  payloadFor,
  resolved,
  service,
} from "./contract/fixtures.ts";

/**
 * The notifier contract (roadmap 3.8): what every channel promises, checked
 * the same way for all of them. Adapters have had a contract suite since the
 * first one; the channels had only their own tests, which each checked what
 * its author thought of. These are the properties none may forget:
 *
 *   - a valid payload of every kind is delivered without throwing;
 *   - a refused delivery throws a `ChannelError` naming the channel and the
 *     HTTP status, and never a credential;
 *   - every field the remote side caps is cut to fit, however long the message;
 *   - an on-call channel's de-duplication key is stable and shared by the
 *     alert and the recovery that closes it;
 *   - every rendering a person reads (plain and rich alike) says who and what;
 *   - and the exact bytes on the wire match the channel's golden file, so a
 *     change to what a channel sends is a diff someone looked at.
 *
 * `UPDATE_GOLDEN=1 node --test test/notifiers/contract.test.ts` rewrites the
 * golden files; review them like any other diff before committing.
 */

const GOLDEN_DIR = new URL("./golden/", import.meta.url);
const UPDATE = process.env.UPDATE_GOLDEN === "1";

function build(id: string, contract: ContractCase): Notifier {
  const [notifier] = buildNotifiers([{ id, enabled: true, settings: contract.settings }]);
  assert.ok(notifier !== undefined);
  return notifier;
}

/** Sends one payload with the remote side answering `respond`, and hands back what went out. */
async function deliver(
  notifier: Notifier,
  payload: NotificationPayload,
  respond: (request: CapturedRequest) => Response,
): Promise<CapturedRequest[]> {
  const stub = stubFetch(respond);
  try {
    await notifier.send(payload);
  } finally {
    stub.restore();
  }
  return stub.requests;
}

const last = (requests: CapturedRequest[]): CapturedRequest => {
  const request = requests.at(-1);
  assert.ok(request !== undefined, "the channel sent nothing");
  return request;
};

const refusal = (): Response =>
  new Response(
    JSON.stringify({ message: "boom", error: "boom", description: "boom", errors: ["boom"], errorDescription: "boom" }),
    { status: 500, headers: { "content-type": "application/json" } },
  );

test("every built-in channel is either under the contract or says why not", () => {
  for (const id of BUILT_IN_CHANNEL_IDS) {
    assert.ok(id in CASES || id in EXEMPT, `channel ${id} has no contract case and no exemption`);
  }
  for (const id of Object.keys(CASES)) {
    assert.ok(BUILT_IN_CHANNEL_IDS.includes(id), `contract case ${id} names no built-in channel`);
  }
});

for (const [id, contract] of Object.entries(CASES)) {
  test(`${id}: delivers a change of every kind without throwing`, async () => {
    const notifier = build(id, contract);
    for (const kind of ALL_KINDS) {
      await assert.doesNotReject(deliver(notifier, payloadFor(kind), contract.ok), `kind ${kind}`);
    }
    await assert.doesNotReject(deliver(notifier, flood, contract.ok), "a digest");
    await assert.doesNotReject(
      deliver(notifier, { ...opened, suppressedCount: 3, escalated: { afterMinutes: 15 } }, contract.ok),
      "a capped, escalated message",
    );
  });

  test(`${id}: a refused delivery is a ChannelError with the status and no credential`, async () => {
    const notifier = build(id, contract);
    await assert.rejects(deliver(notifier, opened, refusal), (error: unknown) => {
      assert.ok(error instanceof ChannelError, `threw ${String(error)}`);
      assert.equal(error.channel, id);
      assert.equal(error.status, 500);
      assert.match(error.message, new RegExp(`^${id} notification .*HTTP 500`));
      for (const secret of contract.secrets) {
        assert.ok(!error.message.includes(secret), `the error carries the credential ${secret}`);
      }
      return true;
    });
  });

  test(`${id}: every rendering a person reads names the provider and the incident`, async () => {
    const renderings = contract.readable(last(await deliver(build(id, contract), opened, contract.ok)));
    assert.ok(renderings.length > 0);
    for (const text of renderings) {
      assert.ok(text.includes(service.name), `a rendering omits the provider: ${text}`);
      assert.ok(text.includes(INCIDENT_TITLE), `a rendering omits the incident: ${text}`);
    }
  });

  test(`${id}: every capped field fits, however long the message`, async () => {
    const request = last(await deliver(build(id, contract), flood, contract.ok));
    for (const { field, text, max, unit } of contract.limits(request)) {
      // `ok` rather than `equal`: a failure here is a message tens of kilobytes
      // long, and the diff of two of those buries the one line that matters.
      assert.ok(fitText(text, max, unit) === text, `${field} runs past ${max} ${unit ?? "chars"}`);
    }
  });

  if (contract.dedupKey !== undefined) {
    const keyOf = contract.dedupKey;
    test(`${id}: the alert and its recovery share one stable de-duplication key`, async () => {
      const notifier = build(id, contract);
      const key = async (payload: NotificationPayload): Promise<string> =>
        keyOf(last(await deliver(notifier, payload, contract.ok)));
      const first = await key(opened);
      assert.ok(first !== "");
      assert.equal(await key(opened), first, "the same change keyed twice differently");
      assert.equal(await key(resolved), first, "the recovery does not close the alert it belongs to");
      assert.notEqual(await key(anotherIncident), first, "two incidents share one alert");
    });
  }

  test(`${id}: the bytes on the wire match the golden file`, async (context) => {
    // The clock is frozen rather than the timestamps masked afterwards: a
    // webhook signature is computed over the time it was sent, and a masked
    // timestamp beside an unmasked signature would differ on every run.
    context.mock.timers.enable({ apis: ["Date"], now: Date.parse(FROZEN_NOW) });
    const notifier = build(id, contract);
    const recorded: Record<string, unknown> = {};
    for (const [name, payload] of Object.entries(GOLDEN_PAYLOADS)) {
      recorded[name] = (await deliver(notifier, payload, contract.ok)).map(normalise);
    }
    const actual = `${JSON.stringify(recorded, null, 2)}\n`;
    const file = new URL(`${id}.json`, GOLDEN_DIR);
    if (UPDATE) {
      mkdirSync(GOLDEN_DIR, { recursive: true });
      writeFileSync(file, actual);
      return;
    }
    assert.ok(existsSync(file), `no golden file for ${id}: run UPDATE_GOLDEN=1 and review it`);
    assert.equal(actual, readFileSync(file, "utf8"), `${id} sends different bytes: UPDATE_GOLDEN=1 after review`);
  });
}

const FROZEN_NOW = "2026-10-20T08:00:00.000Z";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/**
 * A request as recorded in a golden file: what was sent, with the one thing
 * that differs on every run — a fresh random id — replaced by a marker. The
 * clock needs no such treatment; the test freezes it.
 */
function normalise(request: CapturedRequest): unknown {
  const stable = (text: string): string => text.replace(UUID, "<uuid>");
  const headers = Object.fromEntries(
    Object.entries(request.headers)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => [name, stable(value)]),
  );
  const raw = request.rawBody === undefined ? undefined : stable(request.rawBody);
  let body: unknown = raw;
  try {
    if (raw !== undefined) body = JSON.parse(raw) as unknown;
  } catch {
    // Not JSON — a form, or ntfy's bare text — and kept as the string it was.
  }
  return { method: request.method, url: stable(request.url), headers, body };
}
