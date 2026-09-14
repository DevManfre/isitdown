import { createServer, type Server, type Socket } from "node:net";
import { readFileSync } from "node:fs";
import { createServer as createTlsServer, TLSSocket, type TlsOptions } from "node:tls";
import type { AddressInfo } from "node:net";

/**
 * A local stand-in for a submission server. Never a live one: an adapter test
 * may not touch a provider, and a notifier test may not touch a mail server.
 *
 * It speaks only as much SMTP as `src/notifiers/smtp.ts` does, and it records
 * every command it was given so a test can assert on the conversation rather
 * than on whether "it worked".
 */

export interface SmtpSession {
  /** Every command line the client sent, in order, DATA's payload excluded. */
  commands: string[];
  /** The message body, verbatim, between DATA and the closing dot. */
  data: string;
  /** True once the session was upgraded with STARTTLS. */
  upgraded: boolean;
}

export interface FakeSmtpOptions {
  /** Capability lines EHLO answers with, after the greeting line. */
  capabilities?: string[];
  /** Implicit TLS from the first byte, as a server on 465 does. */
  tls?: boolean;
  /** A reply to send instead of the usual one, keyed by the command's first word. */
  refuse?: Record<string, string>;
}

const CERT: TlsOptions = {
  cert: readFileSync(new URL("../fixtures/tls/cert.pem", import.meta.url)),
  key: readFileSync(new URL("../fixtures/tls/key.pem", import.meta.url)),
};

/**
 * Runs `run` against a fake server on a free port, and hands back what the
 * session recorded. The server is closed however the test ends.
 */
export async function withSmtpServer(
  options: FakeSmtpOptions,
  run: (address: { host: string; port: number }, session: SmtpSession) => Promise<void>,
): Promise<SmtpSession> {
  const session: SmtpSession = { commands: [], data: "", upgraded: false };
  const capabilities = options.capabilities ?? ["AUTH PLAIN LOGIN"];
  const refuse = options.refuse ?? {};

  const handle = (socket: Socket | TLSSocket): void => {
    let buffer = "";
    let inData = false;
    /** Which half of an AUTH LOGIN exchange the next line is. */
    let awaiting: "username" | "password" | null = null;
    socket.setEncoding("utf8");
    socket.write("220 fake.example ESMTP\r\n");

    const upgrade = (): void => {
      socket.removeAllListeners("data");
      const secure = new TLSSocket(socket, { isServer: true, ...CERT });
      session.upgraded = true;
      secure.on("secure", () => {
        /* nothing: the client speaks first */
      });
      handleLines(secure);
    };

    const handleLines = (stream: Socket | TLSSocket): void => {
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        buffer += chunk;
        for (;;) {
          const end = buffer.indexOf("\n");
          if (end === -1) return;
          const line = buffer.slice(0, end).replace(/\r$/, "");
          buffer = buffer.slice(end + 1);

          if (inData) {
            if (line === ".") {
              inData = false;
              stream.write("250 2.0.0 queued\r\n");
              continue;
            }
            session.data += `${line}\n`;
            continue;
          }

          session.commands.push(line);
          const verb = line.split(" ")[0]?.toUpperCase() ?? "";
          const canned = refuse[verb];
          if (canned !== undefined) {
            stream.write(`${canned}\r\n`);
            continue;
          }
          if (verb === "EHLO") {
            const offered = session.upgraded
              ? capabilities.filter((entry) => entry !== "STARTTLS")
              : capabilities;
            // A server with nothing to advertise answers one final line; a
            // continuation line with nothing after it is what a real client
            // would wait on forever.
            const lines =
              offered.length === 0
                ? ["250 fake.example"]
                : [
                    "250-fake.example",
                    ...offered.map((entry, index) =>
                      index === offered.length - 1 ? `250 ${entry}` : `250-${entry}`,
                    ),
                  ];
            stream.write(`${lines.join("\r\n")}\r\n`);
            continue;
          }
          if (verb === "STARTTLS") {
            stream.write("220 2.0.0 ready\r\n");
            upgrade();
            return;
          }
          if (verb === "AUTH") {
            // One line of AUTH PLAIN, or the two prompts LOGIN takes.
            if (line.toUpperCase().includes("PLAIN")) {
              stream.write("235 2.7.0 ok\r\n");
            } else {
              awaiting = "username";
              stream.write("334 VXNlcm5hbWU6\r\n");
            }
            continue;
          }
          if (awaiting === "username") {
            awaiting = "password";
            stream.write("334 UGFzc3dvcmQ6\r\n");
            continue;
          }
          if (awaiting === "password") {
            awaiting = null;
            stream.write("235 2.7.0 ok\r\n");
            continue;
          }
          if (verb === "DATA") {
            inData = true;
            stream.write("354 go ahead\r\n");
            continue;
          }
          if (verb === "QUIT") {
            stream.write("221 2.0.0 bye\r\n");
            stream.end();
            continue;
          }
          // MAIL, RCPT and anything else this fake has no opinion about.
          stream.write("250 2.1.0 ok\r\n");
        }
      });
    };

    handleLines(socket);
  };

  const server: Server = options.tls === true
    ? createTlsServer(CERT, (socket) => handle(socket))
    : createServer((socket) => handle(socket));

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run({ host: "127.0.0.1", port }, session);
  } finally {
    server.close();
  }
  return session;
}
