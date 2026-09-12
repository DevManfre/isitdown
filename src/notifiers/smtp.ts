import { createConnection, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

/**
 * Just enough SMTP to hand one message to a server (roadmap 3.3).
 *
 * Email is the most-asked-for channel in a self-hosted tool and the only one
 * that would have added a real runtime dependency to a project whose pitch is
 * three of them. What it actually needs is a submission conversation — greeting,
 * EHLO, optional STARTTLS, optional AUTH, envelope, DATA — and that is this
 * file. What a library would add on top of it is address parsing, attachments,
 * connection pooling and a dozen transports, none of which a status
 * notification has any use for.
 *
 * Deliberately not here: no pooling (a notification is one message, minutes
 * apart), no retry (the dispatcher already owns retries and the dead letter),
 * and no HTML part — the message is the same text every other channel sends.
 */

export interface SmtpOptions {
  host: string;
  port: number;
  /** Implicit TLS from the first byte, as on port 465. Otherwise STARTTLS is used when offered. */
  secure: boolean;
  username?: string | undefined;
  password?: string | undefined;
  /**
   * Send credentials even when the connection was never encrypted. Off by
   * default, and the one setting here that can leak something: a password on a
   * cleartext socket is readable by anything between here and the server. It
   * exists for the local MTA on `127.0.0.1` that this audience actually runs.
   */
  allowInsecureAuth?: boolean | undefined;
  /**
   * Accept a certificate no public CA signed. Off by default; on is how a
   * self-hosted mail server with its own certificate is reached, which is the
   * common case for exactly the installs that run this.
   */
  allowSelfSigned?: boolean | undefined;
  /** Name sent in EHLO. A submission server rarely cares; some log it. */
  clientName?: string | undefined;
  timeoutMs: number;
}

export interface SmtpMessage {
  from: string;
  to: string[];
  subject: string;
  /** Plain text, UTF-8. Encoded as base64 on the way out — see `bodyOf`. */
  text: string;
}

interface Reply {
  code: number;
  /** Every line of the reply, the code and its separator stripped. */
  lines: string[];
}

const CRLF = "\r\n";

/** An SMTP failure, carrying the server's own code and words. */
export class SmtpError extends Error {
  readonly code: number;

  constructor(message: string, code: number) {
    super(message);
    this.name = "SmtpError";
    this.code = code;
  }
}

/**
 * One conversation's worth of socket: reads replies a line at a time, and turns
 * a close, an error or a silence into a rejection rather than a hang.
 *
 * The buffering matters more than it looks: a reply can arrive split across
 * packets or three replies can arrive in one, and a naive "one `data` event is
 * one reply" reader passes every test against a fast local server and then
 * misreads a real one.
 */
class SmtpConnection {
  private socket: Socket | TLSSocket;
  private readonly timeoutMs: number;
  private buffer = "";
  private waiting: { resolve: (reply: Reply) => void; reject: (error: Error) => void } | null = null;
  private failure: Error | null = null;

  constructor(socket: Socket | TLSSocket, timeoutMs: number) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.attach(socket);
  }

  private attach(socket: Socket | TLSSocket): void {
    socket.setEncoding("utf8");
    socket.setTimeout(this.timeoutMs);
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on("error", (error: Error) => this.fail(error));
    socket.on("timeout", () => this.fail(new Error(`smtp: ${this.timeoutMs}ms with no answer`)));
    socket.on("close", () => this.fail(new Error("smtp: the server closed the connection")));
  }

  private fail(error: Error): void {
    this.failure = error;
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.reject(error);
  }

  /** Hands over the first complete reply in the buffer, if there is one. */
  private drain(): void {
    const waiting = this.waiting;
    if (waiting === null) return;
    const reply = this.take();
    if (reply === null) return;
    this.waiting = null;
    waiting.resolve(reply);
  }

  /**
   * A reply is one or more lines, each `NNN-text` until the last, which is
   * `NNN text`. Returns null while the last line has not arrived yet.
   */
  private take(): Reply | null {
    const lines: string[] = [];
    let consumed = 0;
    for (;;) {
      const end = this.buffer.indexOf("\n", consumed);
      if (end === -1) return null;
      const line = this.buffer.slice(consumed, end).replace(/\r$/, "");
      consumed = end + 1;
      lines.push(line);
      // A line too short to carry a code is a server we cannot talk to; report
      // it as one rather than looping on the same bytes forever.
      if (line.length < 4) {
        this.buffer = this.buffer.slice(consumed);
        return { code: Number.parseInt(line.slice(0, 3), 10) || 0, lines: [line] };
      }
      if (line[3] !== "-") {
        this.buffer = this.buffer.slice(consumed);
        return {
          code: Number.parseInt(line.slice(0, 3), 10) || 0,
          lines: lines.map((entry) => entry.slice(4)),
        };
      }
    }
  }

  read(): Promise<Reply> {
    if (this.failure !== null) return Promise.reject(this.failure);
    return new Promise<Reply>((resolve, reject) => {
      this.waiting = { resolve, reject };
      this.drain();
    });
  }

  write(line: string): void {
    this.socket.write(`${line}${CRLF}`);
  }

  /** Writes a command and reads the reply it produces. */
  async command(line: string): Promise<Reply> {
    this.write(line);
    return this.read();
  }

  /** Replaces the socket with its TLS upgrade, keeping the same reader. */
  async upgrade(host: string, rejectUnauthorized: boolean): Promise<void> {
    const plain = this.socket;
    plain.removeAllListeners();
    plain.setTimeout(0);
    const secure = await new Promise<TLSSocket>((resolve, reject) => {
      const upgraded = tlsConnect({ socket: plain, servername: host, rejectUnauthorized }, () =>
        resolve(upgraded),
      );
      upgraded.once("error", reject);
    });
    this.socket = secure;
    this.buffer = "";
    this.attach(secure);
  }

  close(): void {
    this.socket.removeAllListeners();
    this.socket.destroy();
  }
}

/** Rejects with the server's own words when a reply is not the one expected. */
function expect(reply: Reply, codes: number[], what: string): void {
  if (codes.includes(reply.code)) return;
  throw new SmtpError(`smtp: ${what} was refused: ${reply.code} ${reply.lines.join(" ")}`, reply.code);
}

async function open(options: SmtpOptions): Promise<SmtpConnection> {
  const socket = await new Promise<Socket | TLSSocket>((resolve, reject) => {
    const connection = options.secure
      ? tlsConnect(
          {
            host: options.host,
            port: options.port,
            servername: options.host,
            rejectUnauthorized: options.allowSelfSigned !== true,
          },
          () => resolve(connection),
        )
      : createConnection({ host: options.host, port: options.port }, () => resolve(connection));
    connection.setTimeout(options.timeoutMs, () =>
      reject(new Error(`smtp: ${options.host}:${options.port} did not answer in ${options.timeoutMs}ms`)),
    );
    connection.once("error", reject);
  });
  return new SmtpConnection(socket, options.timeoutMs);
}

/** The capability words an EHLO answered with, upper-cased, first token only. */
function capabilitiesOf(reply: Reply): { has: (word: string) => boolean; auth: string[] } {
  const words = reply.lines.slice(1).map((line) => line.trim().toUpperCase());
  const auth = words
    .filter((line) => line.startsWith("AUTH"))
    .flatMap((line) => line.slice(4).trim().split(/\s+/))
    .filter((word) => word !== "");
  return {
    has: (word) => words.some((line) => line === word || line.startsWith(`${word} `)),
    auth,
  };
}

const base64 = (value: string): string => Buffer.from(value, "utf8").toString("base64");

/**
 * A header value that is not plain ASCII, as RFC 2047 encoded-words. A subject
 * carries a provider's own name and an emoji, so this is the common case rather
 * than the exotic one.
 */
export function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x20-\x7e]/.test(value)) return value;
  return `=?UTF-8?B?${base64(value)}?=`;
}

/**
 * The message as DATA takes it. Base64 rather than raw UTF-8 for three reasons
 * at once: no line can exceed the 998-octet limit, no line can begin with the
 * `.` that would end the data early, and no 8-bit byte reaches a server that
 * never advertised 8BITMIME.
 */
export function bodyOf(message: SmtpMessage, at: Date, messageId: string): string {
  const encoded = Buffer.from(message.text, "utf8")
    .toString("base64")
    .replace(/(.{76})/g, `$1${CRLF}`);
  return [
    `From: ${message.from}`,
    `To: ${message.to.join(", ")}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${at.toUTCString()}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encoded,
  ].join(CRLF);
}

async function authenticate(
  connection: SmtpConnection,
  options: SmtpOptions,
  capabilities: ReturnType<typeof capabilitiesOf>,
  encrypted: boolean,
): Promise<void> {
  const { username, password } = options;
  if (username === undefined || username === "") return;
  if (!encrypted && options.allowInsecureAuth !== true) {
    throw new Error(
      "smtp: refusing to send credentials over an unencrypted connection — enable TLS, or set allowInsecureAuth for a server on this machine",
    );
  }
  const secret = password ?? "";
  if (capabilities.auth.includes("PLAIN") || capabilities.auth.length === 0) {
    expect(await connection.command(`AUTH PLAIN ${base64(`\0${username}\0${secret}`)}`), [235], "AUTH PLAIN");
    return;
  }
  if (capabilities.auth.includes("LOGIN")) {
    expect(await connection.command("AUTH LOGIN"), [334], "AUTH LOGIN");
    expect(await connection.command(base64(username)), [334], "the username");
    expect(await connection.command(base64(secret)), [235], "the password");
    return;
  }
  throw new Error(`smtp: the server offers no mechanism we can use (${capabilities.auth.join(", ")})`);
}

/**
 * Hands one message over and returns once the server has accepted it. Throws on
 * anything else, carrying the server's own reply — the dispatcher logs that
 * message in the delivery log, so "550 5.7.1 relay denied" has to survive the
 * trip.
 */
export async function sendMail(options: SmtpOptions, message: SmtpMessage): Promise<void> {
  const connection = await open(options);
  let encrypted = options.secure;
  try {
    expect(await connection.read(), [220], "the greeting");

    const client = options.clientName ?? "isitdown";
    let hello = await connection.command(`EHLO ${client}`);
    expect(hello, [250], "EHLO");
    let capabilities = capabilitiesOf(hello);

    if (!encrypted && capabilities.has("STARTTLS")) {
      expect(await connection.command("STARTTLS"), [220], "STARTTLS");
      await connection.upgrade(options.host, options.allowSelfSigned !== true);
      encrypted = true;
      // The capability list before an upgrade is not binding on the server
      // after it — AUTH in particular is usually offered only once encrypted.
      hello = await connection.command(`EHLO ${client}`);
      expect(hello, [250], "EHLO after STARTTLS");
      capabilities = capabilitiesOf(hello);
    }

    await authenticate(connection, options, capabilities, encrypted);

    expect(await connection.command(`MAIL FROM:<${message.from}>`), [250], "the sender");
    for (const recipient of message.to) {
      expect(await connection.command(`RCPT TO:<${recipient}>`), [250, 251], `the recipient ${recipient}`);
    }
    expect(await connection.command("DATA"), [354], "DATA");

    const id = `<${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@isitdown>`;
    connection.write(bodyOf(message, new Date(), id));
    connection.write(".");
    expect(await connection.read(), [250], "the message");

    // Best effort: the message is already accepted, and a server that hangs up
    // on QUIT has still delivered it.
    try {
      await connection.command("QUIT");
    } catch {
      /* already sent */
    }
  } finally {
    connection.close();
  }
}
