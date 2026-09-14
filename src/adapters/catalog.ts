/**
 * The bundled provider catalog (roadmap 5.11).
 *
 * Adding a provider needs three answers only whoever wrote the adapters can
 * give: which adapter reads that page, the base url that adapter expects, and
 * an id the schema accepts. Detection (`detect.ts`) answers the first two from
 * a pasted url; this list answers all three from a name, which is what a first
 * run actually starts with — "I want to watch GitHub", not a url.
 *
 * It lives in `src/adapters` for the same reason detection does: it is
 * knowledge about adapters, and the Light edition's `config.yml` takes exactly
 * these fields. It is deliberately a list and not a lookup service — no
 * network, no upstream to be down, nothing to keep in sync at runtime.
 *
 * Every entry was confirmed by running `detectAdapter` against the page: the
 * adapter and base url here are what detection itself answered, not what a
 * provider's marketing page says. Providers whose status page refuses an
 * automated read (Stripe, GitLab, Zendesk, Okta and friends, all of which
 * answer 403 to a plain fetch) are deliberately absent rather than listed and
 * broken — detection stays the path for a page this list does not have.
 */
export interface CatalogEntry {
  /** Slug the service schema accepts, unchanged. */
  id: string;
  name: string;
  adapter: string;
  baseUrl: string;
}

export const CATALOG: readonly CatalogEntry[] = [
  { id: "github", name: "GitHub", adapter: "statuspage", baseUrl: "https://www.githubstatus.com" },
  { id: "bitbucket", name: "Bitbucket", adapter: "statuspage", baseUrl: "https://bitbucket.status.atlassian.com" },
  { id: "atlassian", name: "Atlassian", adapter: "statuspage", baseUrl: "https://status.atlassian.com" },
  { id: "jira", name: "Jira", adapter: "statuspage", baseUrl: "https://jira-software.status.atlassian.com" },
  { id: "cloudflare", name: "Cloudflare", adapter: "statuspage", baseUrl: "https://www.cloudflarestatus.com" },
  { id: "aws", name: "Amazon Web Services", adapter: "aws", baseUrl: "https://health.aws.amazon.com" },
  { id: "gcp", name: "Google Cloud", adapter: "gcp", baseUrl: "https://status.cloud.google.com" },
  { id: "azure", name: "Microsoft Azure", adapter: "azure", baseUrl: "https://azure.status.microsoft" },
  { id: "digitalocean", name: "DigitalOcean", adapter: "statuspage", baseUrl: "https://status.digitalocean.com" },
  { id: "linode", name: "Akamai Linode", adapter: "statuspage", baseUrl: "https://status.linode.com" },
  { id: "heroku", name: "Heroku", adapter: "rss", baseUrl: "https://status.heroku.com/feed" },
  { id: "vercel", name: "Vercel", adapter: "statuspage", baseUrl: "https://www.vercel-status.com" },
  { id: "netlify", name: "Netlify", adapter: "statuspage", baseUrl: "https://www.netlifystatus.com" },
  { id: "render", name: "Render", adapter: "statuspage", baseUrl: "https://status.render.com" },
  { id: "fly", name: "Fly.io", adapter: "statuspage", baseUrl: "https://status.flyio.net" },
  { id: "anthropic", name: "Anthropic", adapter: "statuspage", baseUrl: "https://status.claude.com" },
  { id: "openai", name: "OpenAI", adapter: "statuspage", baseUrl: "https://status.openai.com" },
  { id: "slack", name: "Slack", adapter: "slack", baseUrl: "https://slack-status.com" },
  { id: "discord", name: "Discord", adapter: "statuspage", baseUrl: "https://discordstatus.com" },
  { id: "zoom", name: "Zoom", adapter: "statuspage", baseUrl: "https://status.zoom.us" },
  { id: "notion", name: "Notion", adapter: "statuspage", baseUrl: "https://www.notion-status.com" },
  { id: "linear", name: "Linear", adapter: "statuspage", baseUrl: "https://linearstatus.com" },
  { id: "figma", name: "Figma", adapter: "statuspage", baseUrl: "https://status.figma.com" },
  { id: "dropbox", name: "Dropbox", adapter: "statuspage", baseUrl: "https://status.dropbox.com" },
  { id: "hubspot", name: "HubSpot", adapter: "statuspage", baseUrl: "https://status.hubspot.com" },
  { id: "shopify", name: "Shopify", adapter: "statuspage", baseUrl: "https://www.shopifystatus.com" },
  { id: "square", name: "Square", adapter: "statuspage", baseUrl: "https://www.issquareup.com" },
  { id: "twilio", name: "Twilio", adapter: "statuspage", baseUrl: "https://status.twilio.com" },
  { id: "sendgrid", name: "Twilio SendGrid", adapter: "statuspage", baseUrl: "https://status.sendgrid.com" },
  { id: "datadog", name: "Datadog", adapter: "statuspage", baseUrl: "https://status.datadoghq.com" },
  { id: "sentry", name: "Sentry", adapter: "statuspage", baseUrl: "https://status.sentry.io" },
  { id: "circleci", name: "CircleCI", adapter: "statuspage", baseUrl: "https://status.circleci.com" },
  { id: "docker", name: "Docker Hub", adapter: "statuspage", baseUrl: "https://www.dockerstatus.com" },
  { id: "npm", name: "npm", adapter: "statuspage", baseUrl: "https://status.npmjs.org" },
  { id: "mongodb", name: "MongoDB Atlas", adapter: "statuspage", baseUrl: "https://status.mongodb.com" },
  { id: "planetscale", name: "PlanetScale", adapter: "statuspage", baseUrl: "https://www.planetscalestatus.com" },
  { id: "supabase", name: "Supabase", adapter: "statuspage", baseUrl: "https://status.supabase.com" },
  { id: "elastic", name: "Elastic Cloud", adapter: "statuspage", baseUrl: "https://status.elastic.co" },
  { id: "snowflake", name: "Snowflake", adapter: "statuspage", baseUrl: "https://status.snowflake.com" },
  { id: "cloudinary", name: "Cloudinary", adapter: "statuspage", baseUrl: "https://status.cloudinary.com" },
  { id: "reddit", name: "Reddit", adapter: "statuspage", baseUrl: "https://www.redditstatus.com" },
  { id: "twitch", name: "Twitch", adapter: "statuspage", baseUrl: "https://status.twitch.com" },
  // The one page here addressed by path rather than by host: an Uptime.com
  // account publishes several, and the host alone does not name one.
  {
    id: "uptimecom",
    name: "Uptime.com",
    adapter: "uptimecom",
    baseUrl: "https://status.uptime.com/statuspage/uptime-status",
  },
];
