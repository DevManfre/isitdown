import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAdapter } from "../../src/adapters/index.ts";
import {
  decodeEncodedWords,
  endpointOf,
  imapAdapter,
  imapConfig,
  messageOf,
  noteFromThreads,
  openThreads,
  parseMailStatus,
  threadOf,
  validateImapOptions,
  type MailMessage,
} from "../../src/adapters/imap.adapter.ts";
import { imapDate, quoted } from "../../src/adapters/imapSession.ts";
import type { FetchContext, ReadingNote, ServiceRef } from "../../src/core/adapter.interface.ts";
import type { StatusPageRead } from "../../src/core/http.ts";
import { normalizedStatusSchema } from "../../src/core/status.schema.ts";
import { withImapServer } from "../helpers/localImap.ts";

/**
 * The adapter contract kit is deliberately not run here, as for the DNS probe:
 * its harness serves a fake page over HTTP, and this adapter speaks IMAP. What
 * the kit pins for every other adapter — registered under its own id, a valid
 * reading in the documented shape, a refusal or a silent server rejected rather
 * than read as healthy, never hanging past the deadline — is pinned below,
 * against a fake mail server on the loopback.
 */

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/imap/${name}.eml`, import.meta.url), "utf8");

const ENV = { ACME_IMAP_USER: "watcher@example.com", ACME_IMAP_PASSWORD: "s3cret \"quoted\"" };

const options = (over: Record<string, string> = {}): Record<string, string> => ({
  user: "${ACME_IMAP_USER}",
  passwordEnv: "ACME_IMAP_PASSWORD",
  from: "status@acme.example",
  ...over,
});

const service = (over: Record<string, string> = {}, baseUrl = "https://imap.example.com"): ServiceRef => ({
  id: "acme-mail",
  name: "Acme (mail)",
  baseUrl,
  options: options(over),
});

const ctx: FetchContext = { timeoutMs: 2000 };

const NOW = new Date("2026-10-07T10:00:00Z");

const mail = (subject: string, at: string | null, from = "Acme Status <status@acme.example>"): MailMessage => ({
  id: subject,
  from,
  subject,
  // As `messageOf` hands it over: normalized ISO, milliseconds included.
  at: at === null ? null : new Date(at).toISOString(),
});

/** Runs with the credentials in the environment, restoring it afterwards. */
async function withEnv(run: () => Promise<void>): Promise<void> {
  const saved = Object.fromEntries(Object.keys(ENV).map((key) => [key, process.env[key]]));
  Object.assign(process.env, ENV);
  try {
    await run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("the adapter is registered under its own id", () => {
  assert.equal(getAdapter("imap"), imapAdapter);
});

test("the host comes from the url, the port from the option or the tls default", () => {
  assert.equal(imapConfig(service()).host, "imap.example.com");
  assert.equal(imapConfig(service()).port, 993);
  assert.equal(imapConfig(service()).tls, true);
  assert.equal(imapConfig(service({ tls: "no" })).port, 143);
  assert.equal(imapConfig(service({ port: "1143", tls: "no" })).port, 1143);
  assert.equal(imapConfig(service()).mailbox, "INBOX");
  assert.equal(imapConfig(service()).windowHours, 24);
});

test("the password is only ever named, never written", () => {
  assert.deepEqual(validateImapOptions(options()), []);
  assert.match(validateImapOptions(options({ password: "hunter2" })).join(), /password: never written here/);
  assert.match(validateImapOptions(options({ passwordEnv: "" })).join(), /passwordEnv: name the environment variable/);
  assert.match(validateImapOptions(options({ passwordEnv: "hunter 2!" })).join(), /not an environment variable name/);
  // A secret typed inline must not reach a mail server either: the read refuses.
  assert.throws(() => imapConfig(service({ password: "hunter2" })), /password/);
});

test("every unusable option is named, so the form can say which", () => {
  const problems = validateImapOptions({ passwordEnv: "X", port: "imap", tls: "maybe", windowHours: "0" });
  assert.equal(problems.length, 5, problems.join("\n"));
  for (const key of ["user", "from", "port", "tls", "windowHours"]) {
    assert.ok(problems.some((problem) => problem.startsWith(`${key}:`)), `${key} not named in ${problems.join("; ")}`);
  }
});

test("credentials are resolved from the environment, and an unset one throws", () => {
  const endpoint = endpointOf(imapConfig(service()), service(), ENV);
  assert.equal(endpoint.user, "watcher@example.com");
  assert.equal(endpoint.password, ENV.ACME_IMAP_PASSWORD);
  assert.throws(() => endpointOf(imapConfig(service()), service(), {}), /ACME_IMAP_USER, which is not set/);
  assert.throws(
    () => endpointOf(imapConfig(service()), service(), { ACME_IMAP_USER: "u" }),
    /passwordEnv names ACME_IMAP_PASSWORD, which is not set/,
  );
});

test("a quoted string escapes quotes and refuses a line break", () => {
  assert.equal(quoted('a "b" \\c', "password"), '"a \\"b\\" \\\\c"');
  assert.throws(() => quoted("a\r\nA2 DELETE INBOX", "password"), /line break/);
});

test("the search date is the IMAP day form", () => {
  assert.equal(imapDate(new Date("2026-10-06T23:59:00Z")), "6-Oct-2026");
});

test("headers are unfolded and encoded words decoded", () => {
  const message = messageOf({ uid: 7, headers: fixture("encoded"), receivedAt: null });
  assert.equal(message.id, "7");
  assert.equal(message.subject, "Disservizio parziale – dashboard");
  assert.match(message.from, /^Acme Stato </);
  assert.equal(message.at, "2026-10-07T08:30:00.000Z");
  assert.equal(
    messageOf({ uid: 1, headers: fixture("unrelated"), receivedAt: null }).subject,
    "Your invoice for September is ready",
  );
  assert.equal(decodeEncodedWords("=?x-unknown?B?Zm9v?="), "=?x-unknown?B?Zm9v?=");
});

test("a mail without a Date header falls back to the server's receipt time", () => {
  const message = messageOf({ uid: 1, headers: "Subject: hi\r\n\r\n", receivedAt: "2026-10-07T10:00:00.000Z" });
  assert.equal(message.at, "2026-10-07T10:00:00.000Z");
});

test("the lifecycle word and tags are not part of the thread", () => {
  assert.equal(threadOf("[Acme] Investigating: API requests failing"), "api requests failing");
  assert.equal(threadOf("Re: [Acme] Resolved - API requests failing"), "api requests failing");
  assert.equal(threadOf("[Acme]"), "[acme]");
});

test("no mail from the vendor reads operational", () => {
  const status = parseMailStatus([], imapConfig(service()), service(), NOW);
  assert.equal(status.overallStatus, "operational");
  assert.deepEqual(status.activeIncidents, []);
});

test("an open announcement is an incident with the vendor's severity words", () => {
  const status = parseMailStatus(
    [mail("[Acme] Investigating: API partial outage", "2026-10-07T08:00:00Z")],
    imapConfig(service()),
    service(),
    NOW,
  );
  assert.equal(status.overallStatus, "partial_outage");
  assert.equal(status.activeIncidents.length, 1);
  assert.equal(status.activeIncidents[0]!.id, "mail:api partial outage");
  assert.equal(status.activeIncidents[0]!.createdAt, "2026-10-07T08:00:00.000Z");
  normalizedStatusSchema.parse(status);
});

test("a later mail in the thread closing it clears the incident", () => {
  const config = imapConfig(service());
  const messages = [
    messageOf({ uid: 1, headers: fixture("investigating"), receivedAt: null }),
    messageOf({ uid: 2, headers: fixture("resolved"), receivedAt: null }),
  ];
  assert.equal(parseMailStatus(messages.slice(0, 1), config, service(), NOW).overallStatus, "degraded");
  assert.equal(parseMailStatus(messages, config, service(), NOW).overallStatus, "operational");
});

test("a follow-up keeps the incident's id and moves its update time", () => {
  const status = parseMailStatus(
    [
      mail("Investigating: login errors", "2026-10-07T08:00:00Z"),
      mail("Update: login errors", "2026-10-07T09:00:00Z"),
    ],
    imapConfig(service()),
    service(),
    NOW,
  );
  assert.equal(status.activeIncidents.length, 1);
  assert.equal(status.activeIncidents[0]!.id, "mail:login errors");
  assert.equal(status.activeIncidents[0]!.updatedAt, "2026-10-07T09:00:00.000Z");
  assert.equal(status.activeIncidents[0]!.createdAt, "2026-10-07T08:00:00.000Z");
});

test("an announcement older than the window no longer counts", () => {
  const old = [mail("Investigating: login errors", "2026-10-06T08:00:00Z")];
  assert.equal(parseMailStatus(old, imapConfig(service()), service(), NOW).overallStatus, "operational");
  assert.equal(
    parseMailStatus(old, imapConfig(service({ windowHours: "48" })), service(), NOW).overallStatus,
    "degraded",
  );
});

test("an undated announcement counts as open, never as recovery", () => {
  assert.equal(
    parseMailStatus([mail("Service down", null)], imapConfig(service()), service(), NOW).overallStatus,
    "major_outage",
  );
});

test("mail from another sender, or without a configured subject word, is ignored", () => {
  const config = imapConfig(service({ subject: "incident, outage" }));
  const messages = [
    mail("Outage in progress", "2026-10-07T09:00:00Z", "Someone <someone@else.example>"),
    mail("Your invoice is ready", "2026-10-07T09:00:00Z"),
  ];
  assert.equal(openThreads(messages, config, NOW).length, 0);
  assert.equal(openThreads([mail("Major outage", "2026-10-07T09:00:00Z")], config, NOW).length, 1);
});

test("the note names the worst open mail, and there is none when all is well", () => {
  const config = imapConfig(service());
  const open = openThreads(
    [mail("Slow dashboard", "2026-10-07T08:00:00Z"), mail("API down", "2026-10-07T09:00:00Z")],
    config,
    NOW,
  );
  assert.equal(
    noteFromThreads(open)?.text,
    "mail from Acme Status <status@acme.example> at 2026-10-07T09:00:00.000Z: API down",
  );
  assert.equal(noteFromThreads([]), null);
});

test("a live read logs in read-only and turns the mailbox into a reading", async () => {
  await withEnv(async () => {
    await withImapServer(
      {
        user: ENV.ACME_IMAP_USER,
        password: ENV.ACME_IMAP_PASSWORD,
        mailboxes: { "Vendor/Acme": [fixture("unrelated"), fixture("investigating")] },
      },
      async ({ host, port, commands }) => {
        const reads: StatusPageRead[] = [];
        const notes: ReadingNote[] = [];
        const status = await imapAdapter.fetchStatus(
          service({ port: String(port), tls: "no", mailbox: "Vendor/Acme", windowHours: "100000" }, `http://${host}`),
          { ...ctx, onRead: (read) => reads.push(read), onNote: (note) => notes.push(note) },
        );
        normalizedStatusSchema.parse(status);
        assert.equal(status.overallStatus, "degraded");
        assert.equal(status.activeIncidents.length, 1);
        assert.equal(reads.length, 1);
        assert.match(notes[0]!.text, /Investigating: API requests failing/);
        // Read-only: no SELECT, no STORE, nothing that marks a message seen.
        const verbs = commands.map((command) => command.split(" ")[0]!.toUpperCase());
        assert.deepEqual(verbs, ["LOGIN", "EXAMINE", "UID", "UID", "LOGOUT"]);
        assert.ok(commands[3]!.includes("BODY.PEEK["), commands[3]);
      },
    );
  });
});

test("an empty mailbox reads operational without fetching anything", async () => {
  await withEnv(async () => {
    await withImapServer(
      { user: ENV.ACME_IMAP_USER, password: ENV.ACME_IMAP_PASSWORD, mailboxes: { INBOX: [] } },
      async ({ host, port, commands }) => {
        const status = await imapAdapter.fetchStatus(service({ port: String(port), tls: "no" }, `http://${host}`), ctx);
        assert.equal(status.overallStatus, "operational");
        assert.ok(!commands.some((command) => / FETCH /.test(command)));
      },
    );
  });
});

test("a refused login, a missing mailbox or a BYE is a failed read, not an outage", async () => {
  await withEnv(async () => {
    const cases: [Parameters<typeof withImapServer>[0], RegExp][] = [
      [{ user: "someone", password: "else", mailboxes: { INBOX: [] } }, /login refused: NO/],
      [{ user: ENV.ACME_IMAP_USER, password: ENV.ACME_IMAP_PASSWORD, mailboxes: {} }, /mailbox INBOX refused/],
      [{ user: "", password: "", mailboxes: {}, behaviour: "bye" }, /refused the connection/],
    ];
    for (const [box, message] of cases) {
      await withImapServer(box, async ({ host, port }) => {
        await assert.rejects(
          imapAdapter.fetchStatus(service({ port: String(port), tls: "no" }, `http://${host}`), ctx),
          message,
        );
      });
    }
  });
});

test("a server that never greets is given up on at the deadline", async () => {
  await withEnv(async () => {
    await withImapServer(
      { user: "", password: "", mailboxes: {}, behaviour: "silent" },
      async ({ host, port }) => {
        const started = Date.now();
        await assert.rejects(
          imapAdapter.fetchStatus(service({ port: String(port), tls: "no" }, `http://${host}`), { timeoutMs: 150 }),
          /no answer within 150 ms/,
        );
        assert.ok(Date.now() - started < 2000);
      },
    );
  });
});

test("nothing listening is a failed read", async () => {
  await withEnv(async () => {
    await assert.rejects(
      imapAdapter.fetchStatus(service({ port: "9", tls: "no" }, "http://127.0.0.1"), { timeoutMs: 500 }),
      /imap for acme-mail/,
    );
  });
});
