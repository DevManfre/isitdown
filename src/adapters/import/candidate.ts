/**
 * What every importer turns a neighbour's monitor into, before anything is
 * matched against the catalog or named as a provider — roadmap 2.4.
 *
 * Each tool's file knows only its own format and says what a monitor *checks*:
 * an HTTP endpoint, a TCP port, a DNS name, a status page, a job that calls in.
 * Deciding what that becomes here — a probe, a catalog provider, a heartbeat,
 * nothing — is `index.ts`'s job, once, so four importers cannot drift into four
 * ideas of when a URL is a status page.
 */

export type ImportTool = "uptimekuma" | "gatus" | "statping" | "statusgator";

/** Something about a monitor that did not survive the translation, said once. */
export type ImportNoteCode =
  /** Headers, basic auth or a request body: credentials never travel into a config. */
  | "credentials-dropped"
  /** Conditions with no equivalent here; `detail` lists them. */
  | "conditions-dropped"
  /** A regular expression on the body, which a substring check cannot honour. */
  | "body-pattern-dropped"
  /** A response-time limit, which here reads `degraded` rather than down. */
  | "slow-is-degraded"
  /** A cadence below what this monitor kind accepts, raised to the floor. */
  | "cadence-raised"
  /** A cadence above what this monitor kind accepts, lowered to the ceiling. */
  | "cadence-lowered";

export interface ImportNote {
  code: ImportNoteCode;
  detail?: string | undefined;
}

export type SkipReason =
  /** A monitor type, scheme or record type nothing here can check. */
  | "unsupported-type"
  /** An HTTP method a probe may not repeat on a schedule (only GET and HEAD). */
  | "unsupported-method"
  /** A status page the catalog does not know; add it by URL and let detection name it. */
  | "page-not-in-catalog"
  /** A pushed monitor with no expected interval, so nothing can say it is late. */
  | "no-interval"
  /** A second monitor of a catalog provider already imported. */
  | "duplicate"
  /** A target that would not make a valid provider; `detail` says why. */
  | "invalid";

export type Target =
  | {
      kind: "http";
      url: string;
      method?: string | undefined;
      expectStatus?: string | undefined;
      expectBody?: string | undefined;
      absentBody?: string | undefined;
      slowMs?: number | undefined;
      tlsWarnDays?: number | undefined;
    }
  | { kind: "tcp"; host: string; port: number }
  | { kind: "dns"; host: string; recordType: string; resolver?: string | undefined; expectValue?: string | undefined }
  | { kind: "page"; url: string }
  | { kind: "heartbeat"; everySeconds: number; graceSeconds?: number | undefined };

interface CandidateBase {
  /** The monitor's own name in the neighbour tool. */
  source: string;
  /** The neighbour's own word for its type, kept for the report. */
  type: string;
  group?: string | undefined;
  enabled: boolean;
  /** The neighbour's cadence; ignored for a catalog provider, which runs on the global one. */
  intervalSeconds?: number | undefined;
  notes: ImportNote[];
}

export type Candidate =
  | (CandidateBase & { target: Target })
  | (CandidateBase & { skip: SkipReason; detail?: string | undefined });

/** The host of a `host`, `host:port` or `[v6]:port` string, and its port if it names one. */
export function splitHostPort(value: string): { host: string; port: number | undefined } {
  const match = /^\[([^\]]+)\](?::(\d+))?$|^([^:]+)(?::(\d+))?$/.exec(value.trim());
  if (match === null) return { host: value.trim(), port: undefined };
  const host = match[1] ?? match[3] ?? value.trim();
  const port = match[2] ?? match[4];
  return { host, port: port === undefined ? undefined : Number(port) };
}
