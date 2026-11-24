import { createHash, createHmac } from "node:crypto";
import { USER_AGENT } from "../core/http.ts";

/**
 * Where a scheduled backup goes besides the mounted folder — roadmap 10.1. One
 * PUT each, no SDK: WebDAV takes the bytes as they are, S3 takes them with a
 * SigV4 signature `node:crypto` computes in a few lines.
 *
 * Both come from the environment alone, credentials included: the URL and keys
 * are the operator's own, never something the dashboard writes.
 */

export interface UploadTarget {
  kind: "webdav" | "s3";
  /** What a log line or the dashboard says, with any password taken out. */
  label: string;
  put(name: string, body: Buffer, fetchImpl?: typeof fetch): Promise<void>;
}

/** How long one upload may take before it counts as failed. */
export const UPLOAD_TIMEOUT_MS = 120_000;

const withSlash = (url: URL): URL => {
  const copy = new URL(url);
  if (!copy.pathname.endsWith("/")) copy.pathname += "/";
  return copy;
};

const redacted = (url: URL): string => {
  const copy = new URL(url);
  copy.username = "";
  copy.password = "";
  return copy.toString();
};

async function expectOk(response: Response, what: string): Promise<void> {
  if (response.ok) return;
  const detail = (await response.text().catch(() => "")).slice(0, 200);
  throw new Error(`${what} answered ${response.status}${detail === "" ? "" : `: ${detail}`}`);
}

/** `BACKUP_WEBDAV_URL`: a folder; user and password, when needed, in the URL itself. */
function webdavTarget(raw: string): UploadTarget {
  const url = withSlash(new URL(raw));
  const auth =
    url.username === ""
      ? undefined
      : `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString("base64")}`;
  const base = new URL(url);
  base.username = "";
  base.password = "";
  return {
    kind: "webdav",
    label: redacted(url),
    async put(name, body, fetchImpl = fetch) {
      const response = await fetchImpl(new URL(encodeURIComponent(name), base), {
        method: "PUT",
        headers: {
          "user-agent": USER_AGENT,
          "content-type": "application/octet-stream",
          ...(auth === undefined ? {} : { authorization: auth }),
        },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      await expectOk(response, "the WebDAV server");
    },
  };
}

const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string): Buffer => createHmac("sha256", key).update(data).digest();

/** RFC 3986 for each path segment, the way SigV4 canonicalises it. */
const encodePath = (path: string): string =>
  path
    .split("/")
    .map((segment) =>
      encodeURIComponent(decodeURIComponent(segment)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
    )
    .join("/");

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

/**
 * The headers a SigV4-signed PUT of `body` to `url` carries — exported so a test
 * can hold it against AWS's own published example.
 */
export function signS3Put(
  url: URL,
  body: Buffer,
  credentials: S3Credentials,
  at: Date,
  /** Further headers to sign and send, lower-case names. */
  extra: Record<string, string> = {},
): Record<string, string> {
  const amzDate = at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...extra,
  };
  const names = Object.keys(headers).sort();
  const canonical = [
    "PUT",
    encodePath(url.pathname),
    "",
    ...names.map((name) => `${name}:${headers[name]!.trim()}`),
    "",
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${credentials.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), credentials.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
}

/**
 * `BACKUP_S3_URL`: `https://<access key>:<secret key>@<endpoint>/<bucket>/<prefix>?region=<region>` —
 * path style, so any S3-compatible endpoint works (AWS, MinIO, R2, B2). The
 * keys sit in the URL, URL-encoded, exactly as WebDAV's user and password do:
 * one variable per target rather than four AWS ones. Region `us-east-1` when
 * unset, which is also what MinIO and R2 accept.
 */
function s3Target(raw: string): UploadTarget {
  const parsed = new URL(raw);
  const accessKeyId = decodeURIComponent(parsed.username);
  const secretAccessKey = decodeURIComponent(parsed.password);
  if (accessKeyId === "" || secretAccessKey === "") {
    throw new Error("BACKUP_S3_URL needs the access key and secret in it: https://KEY:SECRET@host/bucket");
  }
  const credentials: S3Credentials = {
    accessKeyId,
    secretAccessKey,
    region: parsed.searchParams.get("region") || "us-east-1",
  };
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  const url = withSlash(parsed);
  return {
    kind: "s3",
    label: url.toString(),
    async put(name, body, fetchImpl = fetch) {
      const target = new URL(encodeURIComponent(name), url);
      const { host: _host, ...headers } = signS3Put(target, body, credentials, new Date());
      const response = await fetchImpl(target, {
        method: "PUT",
        headers: { ...headers, "user-agent": USER_AGENT, "content-type": "application/octet-stream" },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      await expectOk(response, "S3");
    },
  };
}

/** Every upload target the environment names; throws on one it names wrongly. */
export function readUploadTargets(env: Record<string, string | undefined>): UploadTarget[] {
  const targets: UploadTarget[] = [];
  const webdav = env["BACKUP_WEBDAV_URL"]?.trim();
  if (webdav !== undefined && webdav !== "") targets.push(webdavTarget(webdav));
  const s3 = env["BACKUP_S3_URL"]?.trim();
  if (s3 !== undefined && s3 !== "") targets.push(s3Target(s3));
  return targets;
}
