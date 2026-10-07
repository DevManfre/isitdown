import { z } from "zod";
import { USER_AGENT } from "./http.ts";

/**
 * Credentials for a status source that answers only to somebody it knows —
 * roadmap 1.5.
 *
 * Until this, only the http probe could send a header of its own; every page
 * adapter read through `fetchConditional` as an anonymous visitor. That closed
 * off a whole class of sources whose data is perfectly machine-readable but
 * per-tenant: Microsoft 365 Service Health behind the Graph API, an
 * authenticated Atlassian Cloud page, Meraki, Zendesk, any page behind a token.
 *
 * Three shapes, which a provider's `options` may combine:
 *
 * - `header.<Name>` — any header, exactly as the probe takes it, with `${VAR}`
 *   resolved from the environment;
 * - `tokenEnv` — the *name* of a variable holding a bearer token;
 * - `oauthTokenUrl` + `oauthClientId` + `oauthClientSecretEnv` (+ `oauthScope`)
 *   — OAuth 2.0 client credentials, the flow every "app registration" style
 *   API uses for a daemon that reads on nobody's behalf.
 *
 * A secret is only ever *named* here, never written: `tokenEnv` and
 * `oauthClientSecretEnv` take a variable's name, and the inline forms
 * (`token`, `oauthClientSecret`) are refused when the options are written, the
 * way the IMAP adapter refuses an inline password.
 */

/** Prefix of an option carrying a request header, e.g. `header.Authorization`. */
export const AUTH_HEADER_PREFIX = "header.";

/** The option keys this module reads, for the settings form and the docs. */
export const AUTH_OPTION_KEYS = [
  "tokenEnv",
  "oauthTokenUrl",
  "oauthClientId",
  "oauthClientSecretEnv",
  "oauthScope",
] as const;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const trimmed = (value: string | undefined): string | undefined => {
  const text = value?.trim();
  return text === undefined || text === "" ? undefined : text;
};

/**
 * Why a provider's credentials cannot work, one sentence each. Empty when they
 * can — including when there are none, which is every public page.
 *
 * Checked when the options are written, not when they are read: a half-filled
 * OAuth block discovered three minutes later as a failed poll is a worse place
 * to learn it than the form it was typed into.
 */
export function authProblems(options: Record<string, string> | undefined): string[] {
  const problems: string[] = [];
  const option = (key: string): string | undefined => trimmed(options?.[key]);

  for (const key of Object.keys(options ?? {})) {
    if (key.startsWith(AUTH_HEADER_PREFIX) && key.slice(AUTH_HEADER_PREFIX.length).trim() === "") {
      problems.push(`${key}: a header option needs a header name after "${AUTH_HEADER_PREFIX}"`);
    }
  }
  for (const [inline, named] of [
    ["token", "tokenEnv"],
    ["oauthClientSecret", "oauthClientSecretEnv"],
  ] as const) {
    if (option(inline) !== undefined) {
      problems.push(`${inline}: never written here — put it in an environment variable and name it in ${named}`);
    }
  }
  for (const key of ["tokenEnv", "oauthClientSecretEnv"] as const) {
    const name = option(key);
    if (name !== undefined && !ENV_NAME.test(name)) {
      problems.push(`${key}: "${name}" is not an environment variable name`);
    }
  }

  const oauth = [option("oauthTokenUrl"), option("oauthClientId"), option("oauthClientSecretEnv")];
  if (oauth.some((value) => value !== undefined) && oauth.some((value) => value === undefined)) {
    problems.push("oauth: oauthTokenUrl, oauthClientId and oauthClientSecretEnv go together — fill all three or none");
  }
  if (option("oauthScope") !== undefined && oauth[0] === undefined) {
    problems.push("oauthScope means nothing without oauthTokenUrl");
  }
  const tokenUrl = oauth[0];
  if (tokenUrl !== undefined && !/^https?:\/\//i.test(tokenUrl)) {
    problems.push(`oauthTokenUrl: "${tokenUrl}" is not an http or https URL`);
  }
  if (option("tokenEnv") !== undefined && tokenUrl !== undefined) {
    problems.push("tokenEnv and oauthTokenUrl both say where the bearer token comes from — keep one");
  }
  return problems;
}

/**
 * The value of a variable the options name. Unset throws rather than sending
 * an empty bearer: the endpoint would answer 401, and a provider reading "down"
 * because of our own missing secret is the wrong thing to wake up to.
 */
function fromEnv(name: string, providerId: string, key: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`credentials for ${providerId}: ${key} names ${name}, which is not set`);
  }
  return value;
}

/** Resolves `${VAR}` inside a header value, the probe's syntax. */
function resolveEnv(value: string, providerId: string, key: string): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => fromEnv(name, providerId, key));
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.coerce.number().positive().optional(),
});

interface CachedToken {
  /** What the token was issued for, so an edited form never reuses a stale one. */
  fingerprint: string;
  token: string;
  expiresAt: number;
}

/**
 * Renewed this long before it says it expires: a token that runs out between
 * being read here and reaching the provider is a 401 for nothing.
 */
const EXPIRY_MARGIN_MS = 60_000;
/** An answer with no `expires_in` is trusted for a conservative while. */
const DEFAULT_TOKEN_LIFETIME_MS = 10 * 60_000;

const tokens = new Map<string, CachedToken>();

/** Test seam, and the poller's: a removed provider's token goes with it. */
export function forgetToken(providerId?: string): void {
  if (providerId === undefined) tokens.clear();
  else tokens.delete(providerId);
}

async function clientCredentialsToken(
  providerId: string,
  options: Record<string, string>,
  timeoutMs: number,
): Promise<string> {
  const tokenUrl = trimmed(options["oauthTokenUrl"]) as string;
  const clientId = trimmed(options["oauthClientId"]) as string;
  const secretEnv = trimmed(options["oauthClientSecretEnv"]) as string;
  const scope = trimmed(options["oauthScope"]);
  const secret = fromEnv(secretEnv, providerId, "oauthClientSecretEnv");
  const fingerprint = [tokenUrl, clientId, scope ?? "", secret].join("\n");

  const cached = tokens.get(providerId);
  if (cached !== undefined && cached.fingerprint === fingerprint && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: secret });
  if (scope !== undefined) body.set("scope", scope);
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": USER_AGENT,
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    // The body of a refused token request is the identity provider's reason
    // ("invalid_client", "AADSTS7000215"), and it never echoes the secret back.
    const reason = (await response.text()).slice(0, 200).replace(/\s+/g, " ").trim();
    throw new Error(
      `credentials for ${providerId}: token request failed: HTTP ${response.status}${reason === "" ? "" : ` (${reason})`}`,
    );
  }
  const parsed = tokenResponseSchema.safeParse(await response.json().catch(() => undefined));
  if (!parsed.success) {
    throw new Error(`credentials for ${providerId}: token endpoint answered without an access_token`);
  }
  const lifetimeMs = parsed.data.expires_in === undefined ? DEFAULT_TOKEN_LIFETIME_MS : parsed.data.expires_in * 1000;
  tokens.set(providerId, {
    fingerprint,
    token: parsed.data.access_token,
    expiresAt: Date.now() + Math.max(lifetimeMs - EXPIRY_MARGIN_MS, 0),
  });
  return parsed.data.access_token;
}

/**
 * The headers a provider's options ask every read to carry, beyond the ones
 * `fetchConditional` always sends. Empty for a provider with no credentials,
 * which costs nothing: no OAuth block means no token request.
 *
 * The bearer goes in first and the explicit headers after it, so an operator
 * who writes `header.Authorization` themselves has the last word.
 */
export async function authHeaders(
  providerId: string,
  options: Record<string, string> | undefined,
  timeoutMs: number,
): Promise<Record<string, string>> {
  if (options === undefined) return {};
  const headers: Record<string, string> = {};
  const tokenEnv = trimmed(options["tokenEnv"]);
  if (tokenEnv !== undefined) {
    headers["authorization"] = `Bearer ${fromEnv(tokenEnv, providerId, "tokenEnv")}`;
  } else if (trimmed(options["oauthTokenUrl"]) !== undefined) {
    headers["authorization"] = `Bearer ${await clientCredentialsToken(providerId, options, timeoutMs)}`;
  }
  for (const [key, value] of Object.entries(options)) {
    if (!key.startsWith(AUTH_HEADER_PREFIX)) continue;
    const name = key.slice(AUTH_HEADER_PREFIX.length).trim();
    if (name === "") throw new Error(`credentials for ${providerId}: option "${key}" has no header name`);
    headers[name.toLowerCase()] = resolveEnv(value, providerId, key);
  }
  return headers;
}
