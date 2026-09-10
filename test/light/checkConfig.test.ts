import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkConfig } from "../../src/light/config/checkConfig.ts";
import { resetValidators } from "../../src/core/http.ts";
import { withDeadServer, withServer } from "../helpers/localServer.ts";

async function configFile(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "isitdown-check-"));
  const path = join(dir, "config.yml");
  await writeFile(path, body, "utf8");
  return path;
}

const messages = (report: Awaited<ReturnType<typeof checkConfig>>): string =>
  report.findings.map((finding) => `${finding.level}: ${finding.message}`).join("\n");

const statuspageSummary = JSON.stringify({
  page: { id: "abc", name: "Example", url: "https://status.example.com" },
  status: { indicator: "none", description: "All Systems Operational" },
  components: [],
  incidents: [],
  scheduled_maintenances: [],
});

/** Serves `routes` by path, 404 for anything else — a real status page's own shape. */
function serve(routes: Record<string, string>) {
  return (req: { url?: string | undefined }, res: import("node:http").ServerResponse): void => {
    const body = routes[req.url ?? ""];
    if (body === undefined) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(body);
  };
}

test("a usable file passes, and the report says what it found", async () => {
  const path = await configFile(`
services:
  - name: GitHub
    id: github
    adapter: statuspage
    baseUrl: https://www.githubstatus.com
  - name: Cloudflare
    id: cloudflare
    adapter: statuspage
    baseUrl: https://www.cloudflarestatus.com
    enabled: false

notifications:
  telegram:
    enabled: true
    botToken: "\${TELEGRAM_BOT_TOKEN}"
    chatId: "\${TELEGRAM_CHAT_ID}"
  webhook:
    enabled: false
    url: "\${WEBHOOK_URL}"
`);

  const report = await checkConfig({
    path,
    env: { TELEGRAM_BOT_TOKEN: "123:ABC", TELEGRAM_CHAT_ID: "-100" },
  });

  assert.equal(report.ok, true, messages(report));
  assert.deepEqual(report.findings, []);
  assert.equal(report.services, 2);
  assert.equal(report.enabledServices, 1);
  assert.deepEqual(report.enabledChannels, ["telegram"]);
  assert.equal(report.probed, false, "no provider is read unless the caller asks");
});

test("every problem is reported, not only the first the loader would have thrown on", async () => {
  const path = await configFile(`
services:
  - name: GitHub
    id: github
    adapter: statuspage
    baseUrl: https://www.githubstatus.com
  - name: GitHub again
    id: github
    adapter: statuspage
    baseUrl: https://www.githubstatus.com

notifications:
  telegram:
    enabled: true
    botToken: "\${TELEGRAM_BOT_TOKEN}"
    chatId: "\${TELEGRAM_CHAT_ID}"

routing:
  - provider: gitlab
    channels: [discord]
`);

  const report = await checkConfig({ path, env: {} });
  const all = messages(report);

  assert.equal(report.ok, false);
  assert.match(all, /the service id "github" more than once/);
  assert.match(all, /TELEGRAM_BOT_TOKEN is not set in the environment/);
  assert.match(all, /TELEGRAM_CHAT_ID is not set in the environment/);
  assert.match(all, /targets provider "gitlab", which is not in services/);
  assert.match(all, /targets channel "discord", which is not in notifications/);
});

test("an environment variable is named once per reference that needs it", async () => {
  const path = await configFile(`
services:
  - name: Internal
    id: internal
    adapter: statuspage
    baseUrl: "\${INTERNAL_STATUS_URL}"
`);

  const report = await checkConfig({ path, env: {} });

  assert.equal(report.ok, false);
  assert.match(messages(report), /services\.0\.baseUrl references INTERNAL_STATUS_URL/);
});

test("an adapter the registry does not have is an error, with the known ones listed", async () => {
  const path = await configFile(`
services:
  - name: Homegrown
    id: homegrown
    adapter: homegrown
    baseUrl: https://status.example.com
`);

  const report = await checkConfig({ path, env: {} });

  assert.equal(report.ok, false);
  assert.match(messages(report), /adapter "homegrown", which does not exist \(known: statuspage, /);
});

test("a missing file fails with the path rather than a stack trace", async () => {
  const report = await checkConfig({ path: join(tmpdir(), "isitdown-check-absent", "config.yml"), env: {} });

  assert.equal(report.ok, false);
  assert.match(messages(report), /was not found — mount it or set CONFIG_PATH/);
  assert.equal(report.services, 0);
});

test("probing agrees with a page the declared adapter reads", async () => {
  resetValidators();
  await withServer(serve({ "/api/v2/summary.json": statuspageSummary }), async (baseUrl) => {
    const path = await configFile(`
requestTimeoutSeconds: 2
services:
  - name: Example
    id: example
    adapter: statuspage
    baseUrl: ${baseUrl}
`);

    const report = await checkConfig({ path, env: {}, probe: true });

    assert.equal(report.ok, true, messages(report));
    assert.deepEqual(report.findings, []);
    assert.equal(report.probed, true);
  });
});

test("probing warns when the page looks like a different adapter than the file names", async () => {
  resetValidators();
  await withServer(serve({ "/api/v2/summary.json": statuspageSummary }), async (baseUrl) => {
    const path = await configFile(`
requestTimeoutSeconds: 2
services:
  - name: Example
    id: example
    adapter: html
    baseUrl: ${baseUrl}
`);

    const report = await checkConfig({ path, env: {}, probe: true });

    // A warning, not an error: the html adapter is a defensible choice for a
    // page that also serves a summary document.
    assert.equal(report.ok, true, messages(report));
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0]?.level, "warning");
    assert.match(messages(report), /names adapter "html" but .* looks like "statuspage"/);
  });
});

test("probing reports a base url no adapter recognises", async () => {
  resetValidators();
  await withServer(serve({}), async (baseUrl) => {
    const path = await configFile(`
requestTimeoutSeconds: 2
services:
  - name: Example
    id: example
    adapter: statuspage
    baseUrl: ${baseUrl}
`);

    const report = await checkConfig({ path, env: {}, probe: true });

    assert.equal(report.ok, false);
    assert.match(messages(report), /no adapter recognises http:\/\/127\.0\.0\.1:/);
  });
});

test("a disabled service is not read: the file already says to leave it alone", async () => {
  resetValidators();
  await withDeadServer(async (baseUrl) => {
    const path = await configFile(`
requestTimeoutSeconds: 2
services:
  - name: Retired
    id: retired
    adapter: statuspage
    baseUrl: ${baseUrl}
    enabled: false
  - name: Also retired
    id: also-retired
    adapter: statuspage
    baseUrl: https://www.githubstatus.com
    enabled: false
`);

    const report = await checkConfig({ path, env: {}, probe: true });

    assert.equal(report.ok, true, messages(report));
    assert.equal(report.enabledServices, 0);
  });
});
