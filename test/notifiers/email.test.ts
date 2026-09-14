import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmailNotifier } from "../../src/notifiers/email.notifier.ts";
import { bodyOf, encodeHeader } from "../../src/notifiers/smtp.ts";
import type { NotificationPayload } from "../../src/core/types.ts";
import { withSmtpServer } from "../helpers/smtpServer.ts";

const opened: NotificationPayload = {
  change: {
    kind: "incident_opened",
    providerId: "github",
    currentStatus: "major_outage",
    incident: {
      id: "i1",
      name: "API requests failing",
      impact: "major",
      status: "investigating",
      updatedAt: "2026-08-19T14:32:07.000Z",
    },
    at: "2026-08-19T14:32:07.000Z",
  },
  service: { id: "github", name: "GitHub", statusUrl: "https://www.githubstatus.com" },
  locale: "en",
};

const settings = (over: Record<string, string> = {}): Record<string, string> => ({
  host: "127.0.0.1",
  from: "isitdown@example.com",
  to: "ops@example.com",
  ...over,
});

/** What the server received, decoded back out of the base64 body. */
const bodyText = (data: string): string => {
  const blank = data.indexOf("\n\n");
  return Buffer.from(data.slice(blank + 2).replace(/\s+/g, ""), "base64").toString("utf8");
};

const headersOf = (data: string): Record<string, string> =>
  Object.fromEntries(
    data
      .slice(0, data.indexOf("\n\n"))
      .split("\n")
      .filter((line) => line.includes(": "))
      .map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 2)]),
  );

test("an opened incident is handed over as one submitted message", async () => {
  const session = await withSmtpServer({ capabilities: [] }, async ({ host, port }) => {
    await createEmailNotifier(settings({ host, port: String(port) })).send(opened);
  });

  const verbs = session.commands.map((line) => line.split(" ")[0]?.toUpperCase());
  assert.deepEqual(verbs, ["EHLO", "MAIL", "RCPT", "DATA", "QUIT"]);
  assert.ok(session.commands.includes("MAIL FROM:<isitdown@example.com>"));
  assert.ok(session.commands.includes("RCPT TO:<ops@example.com>"));
});

test("the subject is the heading every other channel puts first", async () => {
  const session = await withSmtpServer({ capabilities: [] }, async ({ host, port }) => {
    await createEmailNotifier(settings({ host, port: String(port) })).send(opened);
  });

  const headers = headersOf(session.data);
  // The heading carries an emoji, so the subject is an RFC 2047 encoded word.
  assert.equal(headers["Subject"], encodeHeader("🔴 GitHub — MAJOR OUTAGE"));
  assert.equal(headers["From"], "isitdown@example.com");
  assert.equal(headers["To"], "ops@example.com");
  assert.match(headers["Content-Type"] ?? "", /text\/plain; charset="utf-8"/);
});

test("the body carries the detail and the provider's own status page", async () => {
  const session = await withSmtpServer({ capabilities: [] }, async ({ host, port }) => {
    await createEmailNotifier(settings({ host, port: String(port) })).send(opened);
  });

  const text = bodyText(session.data);
  assert.match(text, /API requests failing/);
  assert.match(text, /https:\/\/www\.githubstatus\.com/);
  // The heading is the subject; repeating it as the first body line would read
  // as a duplicate in every mail client.
  assert.ok(!text.startsWith("🔴 GitHub"));
});

test("several recipients are one message with one envelope recipient each", async () => {
  const session = await withSmtpServer({ capabilities: [] }, async ({ host, port }) => {
    await createEmailNotifier(
      settings({ host, port: String(port), to: "ops@example.com, oncall@example.com" }),
    ).send(opened);
  });

  assert.deepEqual(
    session.commands.filter((line) => line.startsWith("RCPT")),
    ["RCPT TO:<ops@example.com>", "RCPT TO:<oncall@example.com>"],
  );
  assert.equal(session.data.match(/^Subject:/gm)?.length, 1);
});

test("a server offering STARTTLS is upgraded before anything else is said", async () => {
  const session = await withSmtpServer(
    { capabilities: ["STARTTLS", "AUTH PLAIN"] },
    async ({ host, port }) => {
      await createEmailNotifier(
        settings({
          host,
          port: String(port),
          username: "bot",
          password: "hunter2",
          allowSelfSigned: "true",
        }),
      ).send(opened);
    },
  );

  assert.equal(session.upgraded, true);
  const verbs = session.commands.map((line) => line.split(" ")[0]?.toUpperCase());
  // EHLO, STARTTLS, then EHLO again: the capability list before an upgrade does
  // not bind the server after it, and AUTH is usually only offered once
  // encrypted.
  assert.deepEqual(verbs.slice(0, 4), ["EHLO", "STARTTLS", "EHLO", "AUTH"]);
});

test("credentials are never sent over a connection that was never encrypted", async () => {
  const session = await withSmtpServer({ capabilities: ["AUTH PLAIN"] }, async ({ host, port }) => {
    await assert.rejects(
      createEmailNotifier(
        settings({ host, port: String(port), username: "bot", password: "hunter2" }),
      ).send(opened),
      /unencrypted/,
    );
  });

  assert.ok(!session.commands.some((line) => line.toUpperCase().startsWith("AUTH")));
  assert.ok(!session.commands.some((line) => line.includes("hunter2")));
});

test("a relay on this machine can be told to accept them anyway", async () => {
  const session = await withSmtpServer({ capabilities: ["AUTH PLAIN"] }, async ({ host, port }) => {
    await createEmailNotifier(
      settings({
        host,
        port: String(port),
        username: "bot",
        password: "hunter2",
        allowInsecureAuth: "true",
      }),
    ).send(opened);
  });

  const auth = session.commands.find((line) => line.toUpperCase().startsWith("AUTH"));
  assert.equal(auth, `AUTH PLAIN ${Buffer.from("\0bot\0hunter2", "utf8").toString("base64")}`);
});

test("a server that only offers AUTH LOGIN is answered in its own mechanism", async () => {
  const session = await withSmtpServer({ capabilities: ["AUTH LOGIN"] }, async ({ host, port }) => {
    await createEmailNotifier(
      settings({
        host,
        port: String(port),
        username: "bot",
        password: "hunter2",
        allowInsecureAuth: "true",
      }),
    ).send(opened);
  });

  assert.ok(session.commands.includes("AUTH LOGIN"));
  assert.ok(session.commands.includes(Buffer.from("bot", "utf8").toString("base64")));
});

test("implicit TLS talks to a server that expects it from the first byte", async () => {
  const session = await withSmtpServer({ tls: true, capabilities: [] }, async ({ host, port }) => {
    await createEmailNotifier(
      // The fixture certificate is self-signed, exactly like the one a
      // self-hosted mail server presents — which is the setting's own case.
      settings({ host, port: String(port), secure: "true", allowSelfSigned: "true" }),
    ).send(opened);
  });

  assert.equal(session.commands[0]?.startsWith("EHLO"), true);
  assert.match(session.data, /Subject:/);
});

test("a refused envelope throws with the server's own reply", async () => {
  await withSmtpServer(
    { capabilities: [], refuse: { RCPT: "550 5.7.1 relay denied" } },
    async ({ host, port }) => {
      await assert.rejects(
        createEmailNotifier(settings({ host, port: String(port) })).send(opened),
        /550 5\.7\.1 relay denied/,
      );
    },
  );
});

test("a server nothing is listening on fails rather than hanging", async () => {
  const { port } = await withSmtpServer({ capabilities: [] }, async (address) => {
    await Promise.resolve(address);
  }).then(() => ({ port: 1 }));

  await assert.rejects(
    createEmailNotifier(settings({ host: "127.0.0.1", port: String(port) })).send(opened),
    /smtp|ECONNREFUSED/,
  );
});

test("the channel refuses a configuration it could not send with", () => {
  assert.throws(() => createEmailNotifier({ from: "a@b.co", to: "c@d.co" }), /host/);
  assert.throws(() => createEmailNotifier(settings({ from: "not an address" })), /from/);
  assert.throws(() => createEmailNotifier(settings({ to: "nobody" })), /to/);
  assert.throws(() => createEmailNotifier(settings({ port: "smtp" })), /port/);
});

test("the channel reports its own id", () => {
  assert.equal(createEmailNotifier(settings()).id, "email");
});

test("a body line can never start the dot that would end the message early", () => {
  const message = bodyOf(
    { from: "a@b.co", to: ["c@d.co"], subject: "s", text: "\n.\n.\nnot the end" },
    new Date("2026-09-01T00:00:00.000Z"),
    "<id@isitdown>",
  );
  const lines = message.split("\r\n");
  const blank = lines.indexOf("");

  assert.ok(lines.slice(blank + 1).every((line) => !line.startsWith(".")));
  // And no line is long enough to be folded by a server on the way.
  assert.ok(lines.every((line) => line.length <= 998));
});
