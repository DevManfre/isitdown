import { parse as parseYaml } from "yaml";
import type { CatalogEntry } from "./catalog.ts";

/**
 * Dependency discovery from a project's own files — roadmap 2.3.
 *
 * A first fleet usually starts from "what does this project depend on", and
 * the project already says: the images a compose file pulls, the packages a
 * manifest installs, the endpoints an `.env` points at, the providers a
 * Terraform module configures. This reads those files and maps what they name
 * onto catalog entries, keeping the evidence beside each match so the operator
 * can see *why* a provider is proposed before adding it.
 *
 * Pure: files in, proposals out. Reading a directory is the CLI's job, a
 * pasted file the dashboard's. Nothing here fetches anything — a host the
 * catalog does not know is reported as such, never probed.
 *
 * Two kinds of match:
 *
 * - **Hints** — a hand-written table for the providers whose dependencies do
 *   not share a domain with their status page: `@aws-sdk/*` is AWS, `ghcr.io`
 *   is GitHub, `hashicorp/google` is Google Cloud.
 * - **Domains** — any host a file names, matched on its registrable domain
 *   against every catalog entry's status page. `api.sendgrid.com` and
 *   `status.sendgrid.com` are both `sendgrid.com`. This is the half that grows
 *   with the catalog without anybody editing this file.
 */

/** Where a dependency on a provider can show up, per kind of file. */
interface Hints {
  /** npm package names; a trailing `*` matches a scope or prefix. */
  npm?: readonly string[];
  /** PyPI distribution names, compared case-insensitively. */
  pypi?: readonly string[];
  /** Go module path prefixes. */
  go?: readonly string[];
  /** Terraform provider sources (`hashicorp/aws`) or bare names. */
  terraform?: readonly string[];
  /** Container registry hosts an image is pulled from. */
  registries?: readonly string[];
  /** Hosts whose registrable domain is not the status page's own. */
  domains?: readonly string[];
}

/** Keyed by catalog id; an id the catalog no longer has is simply never matched. */
export const DISCOVERY_HINTS: Readonly<Record<string, Hints>> = {
  github: {
    npm: ["@octokit/*", "@actions/*"],
    pypi: ["pygithub"],
    go: ["github.com/google/go-github"],
    terraform: ["integrations/github"],
    registries: ["ghcr.io"],
    domains: ["github.com", "githubusercontent.com", "github.io"],
  },
  aws: {
    npm: ["@aws-sdk/*", "aws-sdk", "aws-cdk-lib", "@aws-cdk/*"],
    pypi: ["boto3", "botocore", "aws-cdk-lib"],
    go: ["github.com/aws/aws-sdk-go*"],
    terraform: ["hashicorp/aws"],
    registries: ["public.ecr.aws", "amazonaws.com"],
    domains: ["amazonaws.com", "aws.amazon.com", "cloudfront.net"],
  },
  gcp: {
    npm: ["@google-cloud/*", "googleapis", "firebase-admin"],
    pypi: ["google-cloud-*", "google-api-python-client"],
    go: ["cloud.google.com/go"],
    terraform: ["hashicorp/google", "hashicorp/google-beta"],
    registries: ["gcr.io", "pkg.dev"],
    domains: ["googleapis.com", "appspot.com", "run.app", "cloudfunctions.net"],
  },
  azure: {
    npm: ["@azure/*"],
    pypi: ["azure-*"],
    go: ["github.com/azure/azure-sdk-for-go"],
    terraform: ["hashicorp/azurerm", "hashicorp/azuread"],
    registries: ["mcr.microsoft.com", "azurecr.io"],
    domains: ["azure.com", "windows.net", "azurewebsites.net", "azurecr.io", "azure-api.net"],
  },
  cloudflare: {
    npm: ["wrangler", "@cloudflare/*", "cloudflare"],
    pypi: ["cloudflare"],
    go: ["github.com/cloudflare/cloudflare-go"],
    terraform: ["cloudflare/cloudflare"],
    domains: ["cloudflare.com", "workers.dev", "pages.dev", "r2.cloudflarestorage.com"],
  },
  docker: { registries: ["docker.io", "registry-1.docker.io", "index.docker.io"], domains: ["docker.com", "docker.io"] },
  npm: { domains: ["npmjs.org", "npmjs.com"] },
  openai: { npm: ["openai", "@ai-sdk/openai"], pypi: ["openai"], go: ["github.com/openai/openai-go", "github.com/sashabaranov/go-openai"] },
  anthropic: {
    npm: ["@anthropic-ai/*", "@ai-sdk/anthropic"],
    pypi: ["anthropic"],
    go: ["github.com/anthropics/anthropic-sdk-go"],
    domains: ["anthropic.com", "claude.ai"],
  },
  sentry: { npm: ["@sentry/*"], pypi: ["sentry-sdk"], go: ["github.com/getsentry/sentry-go"], domains: ["sentry.io"] },
  datadog: { npm: ["dd-trace", "@datadog/*"], pypi: ["ddtrace", "datadog"], go: ["github.com/datadog"], terraform: ["datadog/datadog"], domains: ["datadoghq.com", "datadoghq.eu"] },
  twilio: { npm: ["twilio"], pypi: ["twilio"], go: ["github.com/twilio/twilio-go"] },
  sendgrid: { npm: ["@sendgrid/*"], pypi: ["sendgrid"], go: ["github.com/sendgrid/sendgrid-go"] },
  slack: { npm: ["@slack/*"], pypi: ["slack-sdk", "slack-bolt"], go: ["github.com/slack-go/slack"], domains: ["slack.com", "hooks.slack.com"] },
  discord: { npm: ["discord.js"], pypi: ["discord.py"], go: ["github.com/bwmarrin/discordgo"], domains: ["discord.com", "discordapp.com"] },
  vercel: { npm: ["vercel", "@vercel/*"], terraform: ["vercel/vercel"], domains: ["vercel.app", "vercel.com"] },
  netlify: { npm: ["netlify-cli", "@netlify/*"], domains: ["netlify.app", "netlify.com"] },
  heroku: { domains: ["herokuapp.com", "heroku.com"], terraform: ["heroku/heroku"] },
  digitalocean: { terraform: ["digitalocean/digitalocean"], domains: ["digitaloceanspaces.com", "ondigitalocean.app"] },
  supabase: { npm: ["@supabase/*"], pypi: ["supabase"], domains: ["supabase.co"] },
  mongodb: { npm: ["mongodb", "mongoose"], pypi: ["pymongo", "motor"], go: ["go.mongodb.org/mongo-driver"], terraform: ["mongodb/mongodbatlas"], domains: ["mongodb.net"] },
  planetscale: { npm: ["@planetscale/*"], domains: ["psdb.cloud"] },
  shopify: { npm: ["@shopify/*"], pypi: ["shopifyapi"], domains: ["myshopify.com"] },
  linear: { npm: ["@linear/*"] },
  notion: { npm: ["@notionhq/*"], pypi: ["notion-client"] },
  figma: { npm: ["@figma/*"] },
  hubspot: { npm: ["@hubspot/*"], pypi: ["hubspot-api-client"], domains: ["hubapi.com"] },
  zoom: { npm: ["@zoom/*"], domains: ["zoom.us"] },
  dropbox: { npm: ["dropbox"], pypi: ["dropbox"] },
  circleci: { domains: ["circleci.com"] },
  elastic: { npm: ["@elastic/*"], pypi: ["elasticsearch"], go: ["github.com/elastic/go-elasticsearch"], terraform: ["elastic/ec"], domains: ["elastic-cloud.com", "found.io"] },
  snowflake: { npm: ["snowflake-sdk"], pypi: ["snowflake-connector-python"], terraform: ["snowflake-labs/snowflake"], domains: ["snowflakecomputing.com"] },
  cloudinary: { npm: ["cloudinary"], pypi: ["cloudinary"] },
  fly: { domains: ["fly.dev", "fly.io"], registries: ["registry.fly.io"] },
  render: { domains: ["onrender.com"] },
};

/** One reason a provider is proposed: the file and what in it pointed there. */
export interface Evidence {
  file: string;
  /** What the file named — a package, an image, a host — as it was written. */
  found: string;
}

export interface DiscoveredProvider {
  entry: CatalogEntry;
  evidence: Evidence[];
}

export interface DiscoveryResult {
  providers: DiscoveredProvider[];
  /** Hosts the files named that no catalog entry matched, for a provider detection could still add. */
  unmatchedHosts: string[];
  /** Files read, and how many things each one named. */
  files: { file: string; kind: FileKind; named: number }[];
}

export type FileKind = "npm" | "compose" | "dockerfile" | "env" | "terraform" | "pypi" | "go" | "hosts" | "text";

/** What a file is, from its name alone; `null` for one discovery has nothing to read in. */
export function kindOf(path: string): FileKind | null {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (name === "package.json") return "npm";
  if (/^(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(name)) return "compose";
  if (name === "dockerfile" || name.endsWith(".dockerfile") || /^dockerfile\./.test(name)) return "dockerfile";
  if (name === ".env" || name.startsWith(".env.") || name.endsWith(".env")) return "env";
  if (name.endsWith(".tf")) return "terraform";
  if (/^requirements.*\.txt$/.test(name) || name === "pyproject.toml" || name === "pipfile") return "pypi";
  if (name === "go.mod") return "go";
  if (name === "hosts") return "hosts";
  if (/\.(ya?ml|json|toml|ini|conf|cfg|properties)$/.test(name)) return "text";
  return null;
}

/** One thing a file named, sorted by the table it is looked up in. */
type Named =
  | { kind: "npm" | "pypi" | "go" | "terraform"; value: string }
  | { kind: "image"; value: string }
  | { kind: "host"; value: string };

const URL_PATTERN = /\bhttps?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?/gi;
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

function urlsIn(text: string): Named[] {
  return [...text.matchAll(URL_PATTERN)].map((match) => ({ kind: "host" as const, value: match[1]!.toLowerCase() }));
}

/** The host an image is pulled from — `docker.io` for a bare `postgres:16`. */
export function registryOf(image: string): string {
  const reference = image.trim().split("@")[0] ?? "";
  const first = reference.split("/")[0] ?? "";
  // A first segment is a registry only when it looks like a host: Docker's own
  // rule, since `library/postgres` and `bitnami/redis` are Docker Hub paths.
  return reference.includes("/") && (first.includes(".") || first.includes(":") || first === "localhost")
    ? first.split(":")[0]!.toLowerCase()
    : "docker.io";
}

function readJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/** Everything a file names that discovery can look up. Never throws on a malformed file. */
export function namedIn(path: string, content: string): Named[] {
  const kind = kindOf(path);
  switch (kind) {
    case "npm": {
      const manifest = readJson(content);
      if (manifest === null || typeof manifest !== "object") return [];
      const names = new Set<string>();
      for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        const deps = (manifest as Record<string, unknown>)[field];
        if (deps !== null && typeof deps === "object") for (const name of Object.keys(deps)) names.add(name);
      }
      return [...names].map((value) => ({ kind: "npm" as const, value }));
    }
    case "compose": {
      let doc: unknown;
      try {
        doc = parseYaml(content);
      } catch {
        return urlsIn(content);
      }
      const services = (doc as { services?: Record<string, { image?: unknown }> } | null)?.services ?? {};
      const images = Object.values(services)
        .map((service) => service?.image)
        .filter((image): image is string => typeof image === "string")
        .map((value) => ({ kind: "image" as const, value }));
      return [...images, ...urlsIn(content)];
    }
    case "dockerfile":
      return [
        ...[...content.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/gim)]
          .map((match) => match[1]!)
          .filter((image) => !image.startsWith("$") && image.toLowerCase() !== "scratch")
          .map((value) => ({ kind: "image" as const, value })),
        ...urlsIn(content),
      ];
    case "env": {
      const named: Named[] = [];
      for (const line of content.split("\n")) {
        const value = /^\s*(?:export\s+)?[A-Za-z_][\w]*\s*=\s*["']?([^"'#\s]+)/.exec(line)?.[1];
        if (value === undefined) continue;
        const urls = urlsIn(value);
        if (urls.length > 0) named.push(...urls);
        else if (HOST_PATTERN.test(value) && /[a-z]/i.test(value.split(".").pop() ?? "")) named.push({ kind: "host", value: value.toLowerCase() });
      }
      return named;
    }
    case "terraform": {
      const sources = [...content.matchAll(/\bsource\s*=\s*"([^"]+)"/g)].map((match) => match[1]!.toLowerCase());
      const blocks = [...content.matchAll(/^\s*provider\s+"([\w-]+)"/gm)].map((match) => match[1]!.toLowerCase());
      return [
        ...[...new Set([...sources, ...blocks])].map((value) => ({ kind: "terraform" as const, value })),
        ...urlsIn(content),
      ];
    }
    case "pypi": {
      const names = new Set<string>();
      if (path.toLowerCase().endsWith(".txt")) {
        for (const line of content.split("\n")) {
          const name = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line.replace(/#.*/, ""))?.[1];
          if (name !== undefined && !line.trim().startsWith("-")) names.add(name.toLowerCase());
        }
      } else {
        // pyproject.toml / Pipfile: every quoted requirement or `name =` key,
        // which is coarse and good enough — a false name matches no hint.
        for (const match of content.matchAll(/"([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:[<>=~!\[;][^"]*)?"/g)) names.add(match[1]!.toLowerCase());
        for (const match of content.matchAll(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*=/gm)) names.add(match[1]!.toLowerCase());
      }
      return [...names].map((value) => ({ kind: "pypi" as const, value }));
    }
    case "go": {
      const modules = [...content.matchAll(/^\s*(?:require\s+)?([a-z0-9.-]+\.[a-z]+\/[^\s]+)\s+v[\d.]/gim)].map((match) =>
        match[1]!.toLowerCase(),
      );
      return [...new Set(modules)].map((value) => ({ kind: "go" as const, value }));
    }
    case "hosts":
      return content
        .split("\n")
        .map((line) => line.replace(/#.*/, "").trim())
        .filter((line) => line !== "")
        .flatMap((line) => line.split(/\s+/).slice(1))
        .filter((host) => HOST_PATTERN.test(host) && host.includes("."))
        .map((value) => ({ kind: "host" as const, value: value.toLowerCase() }));
    case "text":
      return urlsIn(content);
    default:
      return [];
  }
}

/** Second-level labels under which a country registry sells names: `co.uk`, `com.au`. */
const PUBLIC_SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "ne", "or"]);

/**
 * The part of a host somebody registered: `api.sendgrid.com` → `sendgrid.com`,
 * `foo.bar.co.uk` → `bar.co.uk`. A heuristic, not the public suffix list —
 * the cost of being wrong is one proposal an operator declines.
 */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const take = labels.at(-1)!.length === 2 && PUBLIC_SECOND_LEVEL.has(labels.at(-2)!) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/**
 * Status-page hosting platforms: a page on `foo.statuspage.io` says nothing
 * about a dependency on `bar.statuspage.io`, so their domain never matches.
 */
const SHARED_HOSTING = new Set([
  "statuspage.io", "atlassian.net", "instatus.com", "betteruptime.com", "betterstack.com", "uptime.com",
  "status.io", "sorryapp.com", "github.io", "cachethq.io", "freshstatus.io", "hund.io", "statuspal.io",
]);

/** Hosts that name the machine itself, never a provider. */
function isLocal(host: string): boolean {
  return host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost") || /^[\d.]+$/.test(host);
}

function matchesPattern(value: string, patterns: readonly string[] | undefined): string | undefined {
  return patterns?.find((pattern) =>
    pattern.endsWith("*") ? value.startsWith(pattern.slice(0, -1)) : value === pattern || value.startsWith(`${pattern}/`),
  );
}

function hostMatches(host: string, domains: readonly string[]): boolean {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** Maps every file's named dependencies onto the catalog. */
export function discover(
  files: readonly { path: string; content: string }[],
  catalog: readonly CatalogEntry[],
): DiscoveryResult {
  const byDomain = new Map<string, CatalogEntry>();
  for (const entry of catalog) {
    const domain = registrableDomain(new URL(entry.baseUrl).hostname);
    if (!SHARED_HOSTING.has(domain) && !byDomain.has(domain)) byDomain.set(domain, entry);
  }
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));

  const found = new Map<string, DiscoveredProvider>();
  const unmatched = new Set<string>();
  const report: DiscoveryResult["files"] = [];
  const credit = (entry: CatalogEntry, evidence: Evidence): void => {
    const provider = found.get(entry.id) ?? { entry, evidence: [] };
    if (!provider.evidence.some((seen) => seen.file === evidence.file && seen.found === evidence.found)) {
      provider.evidence.push(evidence);
    }
    found.set(entry.id, provider);
  };

  for (const file of files) {
    const kind = kindOf(file.path);
    if (kind === null) continue;
    const named = namedIn(file.path, file.content);
    report.push({ file: file.path, kind, named: named.length });

    for (const item of named) {
      let matched = false;
      for (const [id, hints] of Object.entries(DISCOVERY_HINTS)) {
        const entry = byId.get(id);
        if (entry === undefined) continue;
        const hit =
          item.kind === "npm" ? matchesPattern(item.value, hints.npm)
          : item.kind === "pypi" ? matchesPattern(item.value, hints.pypi)
          : item.kind === "go" ? matchesPattern(item.value, hints.go)
          : item.kind === "terraform" ? matchesPattern(item.value, hints.terraform) ?? (hints.terraform?.some((source) => source.split("/").pop() === item.value) ? item.value : undefined)
          : item.kind === "image" ? (hostMatches(registryOf(item.value), hints.registries ?? []) ? item.value : undefined)
          : hostMatches(item.value, hints.domains ?? []) ? item.value : undefined;
        if (hit !== undefined) {
          credit(entry, { file: file.path, found: item.value });
          matched = true;
        }
      }
      if (matched || item.kind !== "host") continue;
      if (isLocal(item.value)) continue;
      const entry = byDomain.get(registrableDomain(item.value));
      if (entry !== undefined) credit(entry, { file: file.path, found: item.value });
      else unmatched.add(item.value);
    }
  }

  return {
    providers: [...found.values()].sort((a, b) => b.evidence.length - a.evidence.length || a.entry.name.localeCompare(b.entry.name)),
    unmatchedHosts: [...unmatched].sort(),
    files: report,
  };
}
