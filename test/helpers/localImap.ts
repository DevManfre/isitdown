import { createServer, type Socket } from "node:net";
import type { AddressInfo } from "node:net";

/**
 * A loopback stand-in for a mail server — just the five IMAP commands the imap
 * adapter sends, answered the way RFC 3501 says. Never a live mailbox.
 */
export interface FakeMailbox {
  user: string;
  password: string;
  /** Mailbox name → messages, each the raw header block FETCH returns. */
  mailboxes: Record<string, string[]>;
  /** `silent` accepts the connection and never greets. */
  behaviour?: "normal" | "silent" | "bye" | undefined;
}

export interface ImapServerHandle {
  host: string;
  port: number;
  /** Every command line received, tag stripped, in order. */
  commands: string[];
}

function unquote(token: string): string {
  return token.replace(/^"|"$/g, "").replace(/\\(["\\])/g, "$1");
}

/** `LOGIN "a" "b"` → `["LOGIN", "a", "b"]`, honouring quoted strings. */
function words(line: string): string[] {
  return [...line.matchAll(/"(?:[^"\\]|\\.)*"|\S+/g)].map((match) => unquote(match[0]));
}

function serve(socket: Socket, box: FakeMailbox, commands: string[]): void {
  if (box.behaviour === "silent") return;
  if (box.behaviour === "bye") {
    socket.end("* BYE too many connections\r\n");
    return;
  }
  socket.write("* OK fake IMAP4rev1 ready\r\n");
  let selected: string[] | null = null;
  let authed = false;
  let pending = "";

  socket.on("data", (chunk: Buffer) => {
    pending += chunk.toString("latin1");
    let end: number;
    while ((end = pending.indexOf("\r\n")) !== -1) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 2);
      const [tag, ...rest] = words(line);
      const command = rest.join(" ");
      commands.push(line.slice(line.indexOf(" ") + 1));
      const verb = (rest[0] ?? "").toUpperCase();

      if (verb === "LOGIN") {
        authed = rest[1] === box.user && rest[2] === box.password;
        socket.write(authed ? `${tag} OK logged in\r\n` : `${tag} NO [AUTHENTICATIONFAILED] invalid credentials\r\n`);
      } else if (!authed) {
        socket.write(`${tag} BAD log in first\r\n`);
      } else if (verb === "EXAMINE") {
        selected = box.mailboxes[rest[1] ?? ""] ?? null;
        socket.write(
          selected === null
            ? `${tag} NO [NONEXISTENT] no such mailbox\r\n`
            : `* ${selected.length} EXISTS\r\n${tag} OK [READ-ONLY] examined\r\n`,
        );
      } else if (verb === "UID" && rest[1]?.toUpperCase() === "SEARCH") {
        const uids = (selected ?? []).map((_message, index) => index + 1);
        socket.write(`* SEARCH ${uids.join(" ")}\r\n${tag} OK search done\r\n`);
      } else if (verb === "UID" && rest[1]?.toUpperCase() === "FETCH") {
        const wanted = (rest[2] ?? "").split(",").map(Number);
        for (const uid of wanted) {
          const headers = selected?.[uid - 1];
          if (headers === undefined) continue;
          const bytes = Buffer.byteLength(headers, "utf8");
          socket.write(
            `* ${uid} FETCH (UID ${uid} INTERNALDATE "07-Oct-2026 10:00:00 +0000" BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {${bytes}}\r\n`,
          );
          socket.write(Buffer.from(headers, "utf8"));
          socket.write(")\r\n");
        }
        socket.write(`${tag} OK fetch done\r\n`);
      } else if (verb === "LOGOUT") {
        socket.end(`* BYE logging out\r\n${tag} OK logout done\r\n`);
      } else {
        socket.write(`${tag} BAD unexpected ${command}\r\n`);
      }
    }
  });
}

export async function withImapServer(
  box: FakeMailbox,
  run: (server: ImapServerHandle) => Promise<void>,
): Promise<void> {
  const commands: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    serve(socket, box, commands);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run({ host: "127.0.0.1", port, commands });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
