import type { Adapter, FetchContext, ReadingNote, ServiceRef } from "../core/adapter.interface.ts";
import type { Incident, NormalizedStatus, OverallStatus } from "../core/types.ts";
import { readRecentHeaders, type ImapEndpoint, type MailHeaders } from "./imapSession.ts";
import { severityFromWords, worstStatus } from "./severity.ts";

/**
 * The vendor's email, read from a mailbox — roadmap 1.4.
 *
 * Plenty of SaaS vendors publish no status page anything can read and announce
 * trouble by mailing their customers instead. This adapter reads a mailbox
 * dedicated to those notices, keeps the messages from the vendor's sender, and
 * reads them the way the feed adapter reads entries: an announcement is open
 * while it is recent and its thread has not announced its own closure, and its
 * severity comes from the words the vendor used.
 *
 * Two ways to use it, both through config the rest of the project already has:
 *
 * - on its own, for a vendor no other adapter can reach — the mail *is* the
 *   status, as much as a feed is;
 * - with `crossChecks` naming the vendor's page, for a vendor whose page is slow
 *   to admit what its support desk already mailed. The disagreement then
 *   becomes the page's suspected status (roadmap 1.3), the way a probe's does.
 *
 * Not a probe: an unreachable mailbox or a refused login means *we* cannot see,
 * not that the vendor is down, so those throw and the poller counts a failed
 * read like any page that did not answer.
 *
 * The mailbox host is the `baseUrl`'s host — the scheme is ignored, as for the
 * TCP probe, because the schema only takes http(s) and IMAP has no URL of its
 * own worth inventing. The password comes from the environment only:
 * `passwordEnv` holds the *name* of the variable, never the secret, the way a
 * UI channel's `botTokenEnv` does — so a config file or a settings export never
 * holds one. A name rather than a `${VAR}` reference because the Light edition
 * resolves every `${VAR}` in `config.yml` at load, and the adapter could then
 * no longer tell a resolved reference from a password typed in place.
 */

/** The option keys this adapter reads, for the settings form and the docs. */
export const IMAP_OPTION_KEYS = [
  "user",
  "passwordEnv",
  "from",
  "subject",
  "mailbox",
  "port",
  "tls",
  "windowHours",
] as const;

/** How long an announcement keeps counting as open, as for a feed entry. */
const DEFAULT_WINDOW_HOURS = 24;

/** Words a vendor closes an incident with — the feed adapter's, plus "fixed". */
const CLOSED = /\b(resolved|completed|restored|closed|fixed)\b/i;

/**
 * What a vendor varies between the mails of one incident and keeps otherwise:
 * reply prefixes, bracketed tags and the lifecycle word. Stripped so
 * "Investigating: API errors" and "[Resolved] API errors" land in one thread,
 * and the later mail can close the earlier one.
 */
const REPLY_PREFIX = /^\s*((re|fw|fwd|aw|r|tr|wg)\s*:\s*)+/i;
const LIFECYCLE =
  /\b(resolved|completed|restored|closed|fixed|investigating|identified|monitoring|update|updated|ongoing|in progress|incident|notice|alert)\b/gi;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ImapConfig {
  host: string;
  port: number;
  tls: boolean;
  /** As configured: a literal, or a `${VAR}` reference resolved at read time. */
  user: string;
  /** The name of the environment variable holding the password. */
  passwordEnv: string;
  mailbox: string;
  /** Lowercased; a sender matches when its From header contains any of them. */
  from: string[];
  /** Lowercased; empty means every subject from the sender counts. */
  subject: string[];
  windowHours: number;
}

export interface MailMessage {
  id: string;
  from: string;
  subject: string;
  /** ISO 8601, or null when neither the header nor the server dated it. */
  at: string | null;
}

const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim();
  return text === undefined || text === "" ? undefined : text;
};

const list = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== "");

/**
 * Why these options cannot work, one sentence each — roadmap 11.1. The
 * environment is not consulted: the variable a `${VAR}` names is the running
 * instance's business, and it is checked when the mailbox is read.
 */
export function validateImapOptions(options: Record<string, string> | undefined): string[] {
  const problems: string[] = [];
  const option = (key: string): string | undefined => trimmed(options?.[key]);

  if (option("user") === undefined) problems.push("user: the mailbox login is required");
  const passwordEnv = option("passwordEnv");
  if (passwordEnv === undefined) {
    problems.push("passwordEnv: name the environment variable that holds the password");
  } else if (!ENV_NAME.test(passwordEnv)) {
    problems.push(`passwordEnv: "${passwordEnv}" is not an environment variable name`);
  }
  if (options?.["password"] !== undefined) {
    problems.push("password: never written here — put it in an environment variable and name it in passwordEnv");
  }
  if (list(option("from")).length === 0) {
    problems.push("from: name at least one sender address or domain to read mail from");
  }
  const port = option("port");
  if (port !== undefined && !(/^\d+$/.test(port) && Number(port) >= 1 && Number(port) <= 65_535)) {
    problems.push(`port: "${port}" is not a port between 1 and 65535`);
  }
  const tls = option("tls")?.toLowerCase();
  if (tls !== undefined && !["yes", "true", "1", "on", "no", "false", "0", "off"].includes(tls)) {
    problems.push(`tls: must be yes or no, not "${tls}"`);
  }
  const window = option("windowHours");
  if (window !== undefined && !(/^\d+$/.test(window) && Number(window) > 0)) {
    problems.push("windowHours: must be a positive whole number of hours");
  }
  return problems;
}

/**
 * The configuration to read with, or a thrown error naming what is wrong.
 * Exported so the option surface is exercised without a mailbox.
 */
export function imapConfig(service: ServiceRef): ImapConfig {
  const problems = validateImapOptions(service.options);
  if (problems.length > 0) throw new Error(`imap for ${service.id}: ${problems.join("; ")}`);
  const options = service.options ?? {};

  let url: URL;
  try {
    url = new URL(service.baseUrl);
  } catch {
    throw new Error(`imap for ${service.id}: baseUrl is not a URL`);
  }
  if (url.hostname === "") throw new Error(`imap for ${service.id}: baseUrl names no host`);

  const tls = !["no", "false", "0", "off"].includes(trimmed(options["tls"])?.toLowerCase() ?? "yes");
  const port = trimmed(options["port"]);
  return {
    host: url.hostname,
    port: port === undefined ? (tls ? 993 : 143) : Number(port),
    tls,
    user: trimmed(options["user"])!,
    passwordEnv: trimmed(options["passwordEnv"])!,
    mailbox: trimmed(options["mailbox"]) ?? "INBOX",
    from: list(options["from"]),
    subject: list(options["subject"]),
    windowHours: Number(trimmed(options["windowHours"]) ?? DEFAULT_WINDOW_HOURS),
  };
}

/**
 * Resolves `${VAR}` in the user against the environment — the UI edition stores
 * it as typed, while the Light one has already substituted it at load. An unset
 * variable throws rather than logging in with the literal text: the server
 * would refuse it and the reading would blame the mailbox for our
 * configuration.
 */
function resolveEnv(value: string, service: ServiceRef, key: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
    const found = env[name];
    if (found === undefined || found === "") {
      throw new Error(`imap for ${service.id}: ${key} references ${name}, which is not set`);
    }
    return found;
  });
}

function secretOf(name: string, service: ServiceRef, env: NodeJS.ProcessEnv): string {
  const found = env[name];
  if (found === undefined || found === "") {
    throw new Error(`imap for ${service.id}: passwordEnv names ${name}, which is not set`);
  }
  return found;
}

export function endpointOf(config: ImapConfig, service: ServiceRef, env: NodeJS.ProcessEnv = process.env): ImapEndpoint {
  return {
    host: config.host,
    port: config.port,
    tls: config.tls,
    user: resolveEnv(config.user, service, "user", env),
    password: secretOf(config.passwordEnv, service, env),
    mailbox: config.mailbox,
  };
}

/** RFC 2047 encoded words — `=?UTF-8?B?...?=` — as vendors write non-ASCII subjects. */
export function decodeEncodedWords(text: string): string {
  return text
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset: string, encoding: string, data: string) => {
      try {
        const bytes =
          encoding.toUpperCase() === "B"
            ? Buffer.from(data, "base64")
            : Buffer.from(
                data
                  .replace(/_/g, " ")
                  .replace(/=([0-9A-Fa-f]{2})/g, (_hex, code: string) => String.fromCharCode(parseInt(code, 16))),
                "latin1",
              );
        return new TextDecoder(charset.toLowerCase()).decode(bytes);
      } catch {
        // An unknown charset keeps the raw word: unreadable, but not invented.
        return whole;
      }
    });
}

/** The fields of an unfolded header block, last occurrence winning. */
export function parseHeaders(block: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of block.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    fields[line.slice(0, colon).trim().toLowerCase()] = decodeEncodedWords(line.slice(colon + 1).trim());
  }
  return fields;
}

/** A fetched header block, in the shape the mapping below reads. */
export function messageOf(mail: MailHeaders): MailMessage {
  const headers = parseHeaders(mail.headers);
  const dated = headers["date"] === undefined ? Number.NaN : Date.parse(headers["date"]);
  return {
    id: String(mail.uid),
    from: headers["from"] ?? "",
    subject: headers["subject"] ?? "",
    at: Number.isNaN(dated) ? mail.receivedAt : new Date(dated).toISOString(),
  };
}

/** The part of a subject every mail about one incident shares. */
export function threadOf(subject: string): string {
  const stripped = subject
    .replace(REPLY_PREFIX, "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(LIFECYCLE, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return stripped === "" ? subject.trim().toLowerCase() : stripped;
}

/** Whether this mail is one the operator asked about at all. */
function relevant(message: MailMessage, config: ImapConfig): boolean {
  const from = message.from.toLowerCase();
  if (!config.from.some((sender) => from.includes(sender))) return false;
  if (config.subject.length === 0) return true;
  const subject = message.subject.toLowerCase();
  return config.subject.some((word) => subject.includes(word));
}

interface Thread {
  key: string;
  first: MailMessage;
  latest: MailMessage;
}

/**
 * The vendor's open announcements: one per thread whose latest mail is recent
 * and does not close it. Pessimistic like the feed adapter — an undated mail
 * counts as recent, since a mail we cannot place is not evidence of recovery.
 */
export function openThreads(messages: MailMessage[], config: ImapConfig, now: Date = new Date()): Thread[] {
  const threads = new Map<string, Thread>();
  const order = (message: MailMessage): number =>
    message.at === null ? Number.POSITIVE_INFINITY : Date.parse(message.at);
  const sorted = messages.filter((message) => relevant(message, config)).sort((a, b) => order(a) - order(b));

  for (const message of sorted) {
    const key = threadOf(message.subject);
    const thread = threads.get(key);
    if (thread === undefined) threads.set(key, { key, first: message, latest: message });
    else thread.latest = message;
  }

  const windowMs = config.windowHours * 60 * 60 * 1000;
  return [...threads.values()].filter(({ latest }) => {
    if (CLOSED.test(latest.subject)) return false;
    if (latest.at === null) return true;
    return now.getTime() - Date.parse(latest.at) <= windowMs;
  });
}

const severityOf = (thread: Thread): OverallStatus => severityFromWords(thread.latest.subject);

/** Pure mapping from the mailbox to a reading, exported for tests. */
export function parseMailStatus(
  messages: MailMessage[],
  config: ImapConfig,
  service: ServiceRef,
  now: Date = new Date(),
): NormalizedStatus {
  const open = openThreads(messages, config, now);
  const fetchedAt = now.toISOString();
  const activeIncidents: Incident[] = open.map((thread) => ({
    // The thread, not a message uid: a follow-up mail is the same incident
    // updated, not a new one opened beside it.
    id: `mail:${thread.key}`,
    name: thread.latest.subject,
    impact: severityOf(thread),
    status: "open",
    updatedAt: thread.latest.at ?? fetchedAt,
    ...(thread.first.at === null ? {} : { createdAt: thread.first.at }),
  }));
  return {
    provider: service.id,
    overallStatus: worstStatus(open.map(severityOf)),
    activeIncidents,
    // Mail has no components and no structured maintenance windows.
    components: [],
    maintenances: [],
    fetchedAt,
  };
}

/**
 * The sentence the reading cannot carry: which mail made it not operational.
 * Shown beside a cross-check's suspicion, where "the vendor mailed 'API
 * degraded' at 14:02" is the evidence an operator wants. Null when nothing is
 * open.
 */
export function noteFromThreads(open: Thread[]): ReadingNote | null {
  const worst = [...open].sort(
    (a, b) => worstRank(severityOf(b)) - worstRank(severityOf(a)),
  )[0];
  if (worst === undefined) return null;
  const at = worst.latest.at === null ? "" : ` at ${worst.latest.at}`;
  return { text: `mail from ${worst.latest.from}${at}: ${worst.latest.subject}` };
}

const worstRank = (status: OverallStatus): number =>
  ["operational", "degraded", "partial_outage", "major_outage"].indexOf(status);

export const imapAdapter: Adapter = {
  id: "imap",
  version: 1,

  validateOptions: validateImapOptions,

  async fetchStatus(service: ServiceRef, ctx: FetchContext): Promise<NormalizedStatus> {
    const config = imapConfig(service);
    const now = new Date();
    const askedAt = Date.now();
    let mail: MailHeaders[];
    try {
      mail = await readRecentHeaders(
        endpointOf(config, service),
        new Date(now.getTime() - config.windowHours * 60 * 60 * 1000),
        ctx.timeoutMs,
      );
    } catch (error) {
      throw new Error(
        `imap for ${service.id} (${config.host}:${config.port}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    ctx.onRead?.({ latencyMs: Date.now() - askedAt, notModified: false });

    const messages = mail.map(messageOf);
    const note = noteFromThreads(openThreads(messages, config, now));
    if (note !== null) ctx.onNote?.(note);
    return parseMailStatus(messages, config, service, now);
  },
};
