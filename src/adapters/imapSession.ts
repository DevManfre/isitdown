import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";

/**
 * Just enough IMAP4rev1 (RFC 3501) to read the headers of recent mail —
 * roadmap 1.4. Not a client library: it logs in, opens one mailbox read-only,
 * asks for the messages since a day, fetches three header fields of each and
 * logs out. Nothing is written, flagged or marked seen, so the mailbox an
 * operator also reads by hand looks the same afterwards.
 *
 * Hand-rolled rather than a dependency because the surface used is five
 * commands, and the Light edition ships as a single binary (roadmap 6.7) whose
 * size every dependency pays for whether or not anyone configures a mailbox.
 */

export interface ImapEndpoint {
  host: string;
  port: number;
  /** Implicit TLS (993). Off only for a bridge or relay on the loopback. */
  tls: boolean;
  user: string;
  password: string;
  mailbox: string;
}

export interface MailHeaders {
  uid: number;
  /** The raw header block, unfolded later by the caller. */
  headers: string;
  /** The server's own receipt time, ISO 8601 — null when it sent none. */
  receivedAt: string | null;
}

/** The newest messages read per poll; older ones in the window are skipped. */
export const MAX_MESSAGES = 200;

const HEADER_FIELDS = "FROM SUBJECT DATE";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** RFC 3501 `date`: `7-Oct-2026`. Day granularity, so the caller re-filters. */
export function imapDate(at: Date): string {
  return `${at.getUTCDate()}-${MONTHS[at.getUTCMonth()]}-${at.getUTCFullYear()}`;
}

/**
 * A quoted string. Refuses what a quoted string cannot carry rather than
 * escaping it into something else: a password with a line break sent as-is
 * would end the command halfway and send the rest as a second one.
 */
export function quoted(value: string, what: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error(`imap ${what} contains a line break`);
  return `"${value.replace(/[\\"]/g, (char) => `\\${char}`)}"`;
}

/** One untagged or tagged response: its text with every literal cut out. */
interface Response {
  text: string;
  literals: Buffer[];
}

/**
 * Splits the byte stream into responses. A line ending in `{n}` announces a
 * literal of n bytes that may itself hold CRLFs, so lines cannot simply be
 * split on CRLF — the header block a FETCH returns is exactly such a literal.
 */
class ResponseReader {
  private buffer = Buffer.alloc(0);
  private pending: Response = { text: "", literals: [] };
  private literalBytes: number | null = null;
  readonly complete: Response[] = [];

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      if (this.literalBytes !== null) {
        if (this.buffer.length < this.literalBytes) return;
        this.pending.literals.push(this.buffer.subarray(0, this.literalBytes));
        this.buffer = this.buffer.subarray(this.literalBytes);
        this.literalBytes = null;
        continue;
      }
      const end = this.buffer.indexOf("\r\n");
      if (end === -1) return;
      const line = this.buffer.subarray(0, end).toString("latin1");
      this.buffer = this.buffer.subarray(end + 2);
      this.pending.text += line;
      const literal = /\{(\d+)\}$/.exec(line);
      if (literal !== null) {
        this.literalBytes = Number(literal[1]);
        continue;
      }
      this.complete.push(this.pending);
      this.pending = { text: "", literals: [] };
    }
  }
}

/** A connected session that sends one tagged command at a time. */
class Session {
  private readonly reader = new ResponseReader();
  private next = 1;
  private waiter: (() => void) | null = null;
  private failure: Error | null = null;

  private readonly socket: Socket;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => {
      this.reader.push(chunk);
      this.waiter?.();
    });
    const fail = (error: Error): void => {
      this.failure ??= error;
      this.waiter?.();
    };
    socket.on("error", fail);
    socket.on("close", () => fail(new Error("the server closed the connection")));
  }

  private async until(found: () => boolean): Promise<void> {
    while (!found()) {
      if (this.failure !== null) throw this.failure;
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
      });
      this.waiter = null;
    }
  }

  /** The server's opening line; a `BYE` greeting is a refusal. */
  async greeting(): Promise<void> {
    await this.until(() => this.reader.complete.length > 0);
    const first = this.reader.complete.shift()!;
    if (!/^\* (OK|PREAUTH)\b/i.test(first.text)) {
      throw new Error(`the server refused the connection: ${first.text}`);
    }
  }

  /**
   * Sends a command and returns its untagged responses. Anything but a tagged
   * `OK` throws with the server's own words, which are the part worth reading
   * — "authentication failed" and "mailbox does not exist" are both `NO`.
   */
  async command(line: string, label: string): Promise<Response[]> {
    const tag = `A${this.next++}`;
    this.socket.write(`${tag} ${line}\r\n`);
    const isTagged = (response: Response): boolean => response.text.startsWith(`${tag} `);
    await this.until(() => this.reader.complete.some(isTagged));
    const index = this.reader.complete.findIndex(isTagged);
    const untagged = this.reader.complete.splice(0, index + 1);
    const done = untagged.pop()!;
    const result = done.text.slice(tag.length + 1);
    if (!/^OK\b/i.test(result)) throw new Error(`${label} refused: ${result}`);
    return untagged;
  }
}

function open(endpoint: ImapEndpoint): Socket {
  return endpoint.tls
    ? tlsConnect({ host: endpoint.host, port: endpoint.port, servername: endpoint.host })
    : netConnect({ host: endpoint.host, port: endpoint.port });
}

/** `* SEARCH 4 9 12` → `[4, 9, 12]`. */
function searchResults(responses: Response[]): number[] {
  return responses.flatMap((response) => {
    const match = /^\* SEARCH\b(.*)$/i.exec(response.text);
    if (match === null) return [];
    return match[1]!
      .trim()
      .split(/\s+/)
      .filter((part) => /^\d+$/.test(part))
      .map(Number);
  });
}

function parseInternalDate(raw: string): string | null {
  // `07-Oct-2026 10:00:00 +0000` — Date.parse reads it once the dashes go.
  const parsed = Date.parse(raw.replace(/^(\s?\d{1,2})-(\w{3})-(\d{4})/, "$1 $2 $3"));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function fetchResults(responses: Response[]): MailHeaders[] {
  return responses.flatMap((response) => {
    if (!/^\* \d+ FETCH\b/i.test(response.text)) return [];
    const uid = /\bUID (\d+)/i.exec(response.text);
    const literal = response.literals[0];
    if (uid === null || literal === undefined) return [];
    const internal = /\bINTERNALDATE "([^"]+)"/i.exec(response.text);
    return [
      {
        uid: Number(uid[1]),
        headers: literal.toString("utf8"),
        receivedAt: internal === null ? null : parseInternalDate(internal[1]!),
      },
    ];
  });
}

/**
 * Reads the headers of every message received since `since` (by the day, as
 * IMAP searches), newest `MAX_MESSAGES` only. Throws on anything that stops
 * the read — refused login, missing mailbox, a server that never answers
 * within `timeoutMs` — since each of those means we cannot see the mailbox,
 * which says nothing about the vendor whose mail it holds.
 */
export async function readRecentHeaders(
  endpoint: ImapEndpoint,
  since: Date,
  timeoutMs: number,
): Promise<MailHeaders[]> {
  const socket = open(endpoint);
  const session = new Session(socket);
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs} ms`)), timeoutMs);
  });

  const read = async (): Promise<MailHeaders[]> => {
    await session.greeting();
    await session.command(`LOGIN ${quoted(endpoint.user, "user")} ${quoted(endpoint.password, "password")}`, "login");
    // EXAMINE, not SELECT: read-only, so nothing this does marks a message seen.
    await session.command(`EXAMINE ${quoted(endpoint.mailbox, "mailbox")}`, `mailbox ${endpoint.mailbox}`);
    const uids = searchResults(await session.command(`UID SEARCH SINCE ${imapDate(since)}`, "search"))
      .sort((a, b) => a - b)
      .slice(-MAX_MESSAGES);
    const messages =
      uids.length === 0
        ? []
        : fetchResults(
            await session.command(
              `UID FETCH ${uids.join(",")} (UID INTERNALDATE BODY.PEEK[HEADER.FIELDS (${HEADER_FIELDS})])`,
              "fetch",
            ),
          );
    // A server that drops the line instead of saying BYE has still answered.
    await session.command("LOGOUT", "logout").catch(() => undefined);
    return messages;
  };

  try {
    return await Promise.race([read(), deadline]);
  } finally {
    clearTimeout(timer);
    socket.removeAllListeners();
    socket.on("error", () => undefined);
    socket.destroy();
  }
}
