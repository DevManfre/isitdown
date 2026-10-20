import { createSocket } from "node:dgram";
import { connect as connectTcp, type Socket } from "node:net";
import { hostname } from "node:os";
import { connect as connectTls } from "node:tls";
import { z } from "zod";
import type { Notifier } from "../core/notifier.interface.ts";
import type { NotificationPayload, OverallStatus } from "../core/types.ts";
import { ChannelError } from "./errors.ts";
import { fitText, renderParts } from "./formatting.ts";
import { incidentKey } from "./incidentKey.ts";

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * How large one message may be. RFC 5426 has every receiver take 2048 bytes
 * over UDP, and a datagram past the path MTU is the first thing a network
 * drops; over a stream, 8192 is what rsyslog and syslog-ng accept by default.
 */
const MAX_BYTES = { udp: 2048, tcp: 8192, tls: 8192 } as const;

const DEFAULT_PORT = { udp: 514, tcp: 601, tls: 6514 } as const;

/** The eight facilities set aside for local use, which is what an application logs as. */
const FACILITY: Record<string, number> = {
  local0: 16,
  local1: 17,
  local2: 18,
  local3: 19,
  local4: 20,
  local5: 21,
  local6: 22,
  local7: 23,
};

/**
 * The structured-data id. `32473` is the private enterprise number IANA keeps
 * for documentation and examples (RFC 5612) — the honest choice for a project
 * that has none of its own.
 */
const SD_ID = "isitdown@32473";

const settingsSchema = z.object({
  /** Where to: `udp://syslog.lan:514`, `tcp://…:601` or `tls://…:6514`. */
  url: z
    .string()
    .min(1, "url is required for the syslog channel")
    .transform((value, context) => {
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        parsed = new URL("invalid://");
      }
      const transport = parsed.protocol.replace(/:$/, "");
      if ((transport !== "udp" && transport !== "tcp" && transport !== "tls") || parsed.hostname === "") {
        context.addIssue({ code: "custom", message: "url must be udp://, tcp:// or tls://host[:port] for the syslog channel" });
        return z.NEVER;
      }
      return {
        transport: transport as keyof typeof MAX_BYTES,
        // An IPv6 literal comes back bracketed from `URL`; sockets want it bare.
        host: parsed.hostname.replace(/^\[(.*)\]$/, "$1"),
        port: parsed.port === "" ? DEFAULT_PORT[transport] : Number(parsed.port),
      };
    }),
  /** `local0`…`local7`; empty means `local0`. */
  facility: z
    .string()
    .default("")
    .refine((value) => value === "" || value in FACILITY, {
      message: "facility must be local0 to local7 for the syslog channel",
    }),
});

/**
 * Syslog — roadmap 3.9. An RFC 5424 message to the collector a homelab or a
 * company already ships everything else to, so a provider outage lands in the
 * same place as the rest of the operator's alerts.
 *
 * The message is one line — heading and detail, line breaks folded — with the
 * machine-readable part in structured data: provider, kind, status and the
 * same key the on-call channels de-duplicate on, so a SIEM rule can group by it.
 * Severity follows the status, `crit` for a major outage down to `notice`.
 *
 * Over a stream the frame is RFC 6587 octet counting, which survives a
 * message that carries a newline; over TLS the collector's certificate is
 * verified like any other.
 */
export function createSyslogNotifier(settings: Record<string, string>): Notifier {
  const { url, facility } = settingsSchema.parse(settings);
  const facilityCode = FACILITY[facility === "" ? "local0" : facility] ?? 16;
  const host = hostname() || "-";

  return {
    id: "syslog",

    async send(payload: NotificationPayload): Promise<void> {
      const message = Buffer.from(syslogLine(payload, facilityCode, host, MAX_BYTES[url.transport]), "utf8");
      try {
        if (url.transport === "udp") await sendDatagram(url.host, url.port, message);
        else await sendStream(url.transport, url.host, url.port, Buffer.concat([Buffer.from(`${message.length} `), message]));
      } catch (error) {
        throw new ChannelError(
          "syslog",
          `syslog notification failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}

/** One RFC 5424 message, cut so the whole of it fits `maxBytes`. */
export function syslogLine(payload: NotificationPayload, facility: number, host: string, maxBytes: number): string {
  const { heading, detail, url } = renderParts(payload);
  const { change } = payload;
  const priority = facility * 8 + SEVERITY[change.currentStatus];
  const data = [
    ["provider", payload.service.id],
    ["status", change.currentStatus],
    ["key", incidentKey(change)],
    ["url", url],
  ]
    .map(([name, value]) => `${name}="${escapeParam(value ?? "")}"`)
    .join(" ");
  const header = `<${priority}>1 ${new Date().toISOString()} ${host} isitdown ${process.pid} ${change.kind} [${SD_ID} ${data}] `;
  const text = [heading, detail]
    .filter((part) => part !== "")
    .join(" — ")
    .replace(/\s*\n+\s*/g, " | ");
  return `${header}${fitText(text, maxBytes - Buffer.byteLength(header, "utf8"), "bytes")}`;
}

/** RFC 5424 §6.3.3: inside a parameter value, `"`, `\` and `]` are escaped. */
const escapeParam = (value: string): string => value.replace(/["\\\]]/g, (character) => `\\${character}`);

/**
 * Syslog's 0–7 severities. A provider's trouble is never `emerg`/`alert` — those
 * mean this machine is unusable — and our own fetching trouble is a warning.
 */
const SEVERITY: Record<OverallStatus, number> = {
  operational: 5,
  degraded: 4,
  partial_outage: 3,
  major_outage: 2,
  unknown: 4,
};

function sendDatagram(host: string, port: number, message: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createSocket(host.includes(":") ? "udp6" : "udp4");
    socket.send(message, port, host, (error) => {
      socket.close();
      if (error) reject(error);
      else resolve();
    });
  });
}

/**
 * Writes one frame and closes. Done when the collector has the bytes and the
 * connection has ended cleanly — not when `write` returns, which only means
 * they are queued.
 */
function sendStream(transport: "tcp" | "tls", host: string, port: number, frame: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: Socket =
      transport === "tls" ? connectTls({ host, port, servername: host }) : connectTcp({ host, port });
    const ready = transport === "tls" ? "secureConnect" : "connect";
    socket.setTimeout(REQUEST_TIMEOUT_MS);
    socket.once("timeout", () => socket.destroy(new Error(`${host}:${port} did not answer in ${REQUEST_TIMEOUT_MS}ms`)));
    socket.once("error", reject);
    socket.once(ready, () => socket.end(frame));
    socket.once("close", (hadError) => {
      if (!hadError) resolve();
    });
  });
}
