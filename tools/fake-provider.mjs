// Interactive fake provider — roadmap 13.11.
//
// One local server that plays a status page in the three dialects most of the
// catalog speaks, plus the webhook receiver its notifications land on, plus a
// small control page to change what it says by hand. Run it next to
// `npm run dev:ui` and the dashboard reacts to a click here within a poll.
//
//   GET  /                                  the control page
//   GET  /statuspage/api/v2/summary.json    Atlassian Statuspage  (baseUrl …/statuspage)
//   GET  /statuspage/api/v2/incidents.json
//   GET  /instatus/summary.json             Instatus              (baseUrl …/instatus)
//   GET  /instatus/v3/components.json
//   GET  /rss/feed.xml                      RSS 2.0               (baseUrl …/rss/feed.xml)
//   POST /hook                              webhook receiver — every body is kept
//   GET  /state                             the whole state, as JSON
//   POST /control/<action>                  change it (JSON body, see `apply`)
//
// Integration tests import `startFakeProvider` from this file rather than
// growing their own stand-in, so the server a developer clicks around in is
// the one the suite drives.
//
// CLI: node tools/fake-provider.mjs [--port 4010] [--host 127.0.0.1]

import { createServer } from "node:http";

export const DEFAULT_PORT = 4010;

/** How many webhook bodies the receiver keeps, newest first. */
const DELIVERY_CAP = 50;

/** Component levels, in the fake's own words, mildest first. */
export const COMPONENT_LEVELS = ["operational", "degraded", "partial_outage", "major_outage", "maintenance"];
export const IMPACTS = ["minor", "major", "critical"];
export const INCIDENT_STATUSES = ["investigating", "identified", "monitoring", "resolved"];

const STATUSPAGE_COMPONENT = {
  operational: "operational",
  degraded: "degraded_performance",
  partial_outage: "partial_outage",
  major_outage: "major_outage",
  maintenance: "under_maintenance",
};
const INSTATUS_COMPONENT = {
  operational: "OPERATIONAL",
  degraded: "DEGRADEDPERFORMANCE",
  partial_outage: "PARTIALOUTAGE",
  major_outage: "MAJOROUTAGE",
  maintenance: "UNDERMAINTENANCE",
};
const INSTATUS_IMPACT = { minor: "DEGRADEDPERFORMANCE", major: "PARTIALOUTAGE", critical: "MAJOROUTAGE" };
/** Statuspage's page indicator, by how bad the worst thing on the page is. */
const INDICATOR_RANK = ["none", "minor", "major", "critical"];
const COMPONENT_RANK = { operational: 0, maintenance: 0, degraded: 1, partial_outage: 2, major_outage: 3 };
const IMPACT_RANK = { minor: 1, major: 2, critical: 3 };

export function initialState() {
  return {
    components: [
      { id: "api", name: "API", status: "operational" },
      { id: "web", name: "Website", status: "operational" },
      { id: "webhooks", name: "Webhooks", status: "operational" },
    ],
    incidents: [],
    maintenances: [],
    fault: { mode: "none", delayMs: 0 },
    deliveries: [],
    nextId: 1,
  };
}

const fail = (message) => {
  throw Object.assign(new Error(message), { status: 400 });
};
const pick = (value, allowed, what) => (allowed.includes(value) ? value : fail(`unknown ${what} "${value}"`));
const find = (list, id, what) => list.find((entry) => entry.id === id) ?? fail(`no ${what} "${id}"`);

/**
 * Every change the control page (or a test) can make. Mutates `state`.
 *
 * @param {ReturnType<typeof initialState>} state
 * @param {string} action
 * @param {Record<string, any>} body
 * @param {Date} now
 */
export function apply(state, action, body, now = new Date()) {
  const at = now.toISOString();
  const newId = (prefix) => `${prefix}${state.nextId++}`;
  switch (action) {
    case "component": {
      find(state.components, body.id, "component").status = pick(body.status, COMPONENT_LEVELS, "level");
      return;
    }
    case "component-add": {
      const name = String(body.name ?? "").trim() || fail("a component needs a name");
      state.components.push({ id: newId("c"), name, status: "operational" });
      return;
    }
    case "incident-open": {
      state.incidents.unshift({
        id: newId("inc"),
        name: String(body.name ?? "").trim() || "Elevated error rates",
        impact: pick(body.impact ?? "major", IMPACTS, "impact"),
        status: "investigating",
        componentIds: (body.componentIds ?? []).filter((id) => state.components.some((c) => c.id === id)),
        createdAt: at,
        updatedAt: at,
        resolvedAt: null,
      });
      return;
    }
    case "incident-update": {
      const incident = find(state.incidents, body.id, "incident");
      if (body.status !== undefined) incident.status = pick(body.status, INCIDENT_STATUSES, "incident status");
      if (body.impact !== undefined) incident.impact = pick(body.impact, IMPACTS, "impact");
      incident.resolvedAt = incident.status === "resolved" ? (incident.resolvedAt ?? at) : null;
      incident.updatedAt = at;
      return;
    }
    case "incident-resolve": {
      apply(state, "incident-update", { id: body.id, status: "resolved" }, now);
      return;
    }
    case "maintenance-start": {
      const minutes = Number(body.minutes ?? 60);
      state.maintenances.unshift({
        id: newId("mnt"),
        name: String(body.name ?? "").trim() || "Scheduled database upgrade",
        startsAt: at,
        endsAt: new Date(now.getTime() + (Number.isFinite(minutes) && minutes > 0 ? minutes : 60) * 60_000).toISOString(),
        componentIds: (body.componentIds ?? []).filter((id) => state.components.some((c) => c.id === id)),
        done: false,
      });
      return;
    }
    case "maintenance-end": {
      find(state.maintenances, body.id, "maintenance").done = true;
      return;
    }
    case "fault": {
      state.fault = {
        mode: pick(body.mode, ["none", "error", "slow"], "fault"),
        delayMs: Math.max(0, Number(body.delayMs ?? 0) || 0),
      };
      return;
    }
    case "deliveries-clear": {
      state.deliveries = [];
      return;
    }
    case "reset": {
      Object.assign(state, initialState());
      return;
    }
    default:
      fail(`unknown action "${action}"`);
  }
}

const open = (state) => state.incidents.filter((incident) => incident.status !== "resolved");
const activeMaintenances = (state) => state.maintenances.filter((window) => !window.done);

/** The page-wide rank 0–3, worst of every component and every open incident. */
function worstRank(state) {
  return Math.max(
    0,
    ...state.components.map((c) => COMPONENT_RANK[c.status] ?? 0),
    ...open(state).map((incident) => IMPACT_RANK[incident.impact] ?? 0),
  );
}

export function statuspageSummary(state) {
  const indicator = INDICATOR_RANK[worstRank(state)];
  return {
    page: { id: "fake", name: "Fake Provider", url: "http://localhost/" },
    status: { indicator, description: indicator === "none" ? "All Systems Operational" : "Ongoing issues" },
    components: state.components.map((c) => ({ id: c.id, name: c.name, status: STATUSPAGE_COMPONENT[c.status] })),
    incidents: open(state).map(statuspageIncident),
    scheduled_maintenances: activeMaintenances(state).map((window) => ({
      id: window.id,
      name: window.name,
      status: "in_progress",
      scheduled_for: window.startsAt,
      scheduled_until: window.endsAt,
      components: window.componentIds.map((id) => ({ id })),
    })),
  };
}

function statuspageIncident(incident) {
  return {
    id: incident.id,
    name: incident.name,
    impact: incident.impact,
    status: incident.status,
    created_at: incident.createdAt,
    updated_at: incident.updatedAt,
    resolved_at: incident.resolvedAt,
    components: incident.componentIds.map((id) => ({ id })),
  };
}

export function statuspageIncidents(state) {
  return { incidents: state.incidents.map(statuspageIncident) };
}

export function instatusSummary(state) {
  const rank = worstRank(state);
  const maintenance = activeMaintenances(state).length > 0;
  return {
    page: { name: "Fake Provider", url: "http://localhost/", status: rank > 0 ? "HASISSUES" : maintenance ? "UNDERMAINTENANCE" : "UP" },
    activeIncidents: open(state).map((incident) => ({
      id: incident.id,
      name: incident.name,
      started: incident.createdAt,
      status: incident.status.toUpperCase(),
      impact: INSTATUS_IMPACT[incident.impact],
      updatedAt: incident.updatedAt,
    })),
    activeMaintenances: activeMaintenances(state).map((window) => ({
      id: window.id,
      name: window.name,
      start: window.startsAt,
      status: "INPROGRESS",
      duration: Math.round((Date.parse(window.endsAt) - Date.parse(window.startsAt)) / 60_000),
      updatedAt: window.startsAt,
    })),
  };
}

export function instatusComponents(state) {
  return {
    components: state.components.map((c) => ({ id: c.id, name: c.name, status: INSTATUS_COMPONENT[c.status], group: null })),
  };
}

const xml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The words the RSS adapter reads a severity from, per impact. */
const RSS_SEVERITY = { minor: "Degraded performance", major: "Partial outage", critical: "Major outage" };

/**
 * One item per incident. A feed has no status field: the RSS adapter reads
 * severity and closure from the words, so the description carries both, and
 * the title stays the incident's name, which is what the adapter reports.
 */
export function rssFeed(state) {
  const items = state.incidents
    .map((incident) => {
      const resolved = incident.status === "resolved";
      const title = resolved ? `Resolved: ${incident.name}` : incident.name;
      const body = resolved
        ? "The incident is resolved."
        : `${RSS_SEVERITY[incident.impact]}. We are ${incident.status} this issue.`;
      return `    <item>
      <title>${xml(title)}</title>
      <guid isPermaLink="false">${incident.id}</guid>
      <pubDate>${new Date(incident.updatedAt).toUTCString()}</pubDate>
      <description>${xml(body)}</description>
    </item>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Fake Provider status</title>
    <link>http://localhost/</link>
    <description>Incident history for the fake provider</description>
${items}
  </channel>
</rss>
`;
}

/** The provider endpoints, by path: [content type, body builder]. */
const FEEDS = {
  "/statuspage/api/v2/summary.json": ["application/json", (s) => JSON.stringify(statuspageSummary(s))],
  "/statuspage/api/v2/incidents.json": ["application/json", (s) => JSON.stringify(statuspageIncidents(s))],
  "/instatus/summary.json": ["application/json", (s) => JSON.stringify(instatusSummary(s))],
  "/instatus/v3/components.json": ["application/json", (s) => JSON.stringify(instatusComponents(s))],
  "/rss/feed.xml": ["application/rss+xml; charset=utf-8", rssFeed],
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const send = (res, status, type, body) => {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
};

/**
 * Starts the fake on `port` (0 for any free one, which is what tests pass).
 *
 * @param {{ port?: number, host?: string, now?: () => Date }} [options]
 */
export async function startFakeProvider({ port = DEFAULT_PORT, host = "127.0.0.1", now = () => new Date() } = {}) {
  const state = initialState();

  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      const feed = FEEDS[path];
      if (req.method === "GET" && feed !== undefined) {
        if (state.fault.mode === "slow") await new Promise((resolve) => setTimeout(resolve, state.fault.delayMs));
        if (state.fault.mode === "error") return send(res, 500, "text/plain", "fake provider: injected 500");
        return send(res, 200, feed[0], feed[1](state));
      }
      if (req.method === "POST" && path === "/hook") {
        const raw = await readBody(req);
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
        state.deliveries.unshift({ receivedAt: now().toISOString(), body });
        state.deliveries.length = Math.min(state.deliveries.length, DELIVERY_CAP);
        return send(res, 200, "application/json", "{}");
      }
      if (req.method === "GET" && path === "/state") return send(res, 200, "application/json", JSON.stringify(state));
      if (req.method === "POST" && path.startsWith("/control/")) {
        const raw = await readBody(req);
        apply(state, path.slice("/control/".length), raw === "" ? {} : JSON.parse(raw), now());
        return send(res, 200, "application/json", JSON.stringify(state));
      }
      if (req.method === "GET" && path === "/") return send(res, 200, "text/html; charset=utf-8", PAGE);
      send(res, 404, "text/plain", "not found");
    } catch (error) {
      send(res, error.status ?? 500, "application/json", JSON.stringify({ error: error.message }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const url = `http://${host}:${server.address().port}`;

  return {
    url,
    state,
    /** Same actions as `POST /control/<action>`, without the HTTP round trip. */
    apply: (action, body = {}) => apply(state, action, body, now()),
    baseUrls: {
      statuspage: `${url}/statuspage`,
      instatus: `${url}/instatus`,
      rss: `${url}/rss/feed.xml`,
      webhook: `${url}/hook`,
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

// The control page. Plain HTML and a little script, no build: it only has to
// work in the browser of whoever is developing, and it polls /state so the
// receiver's list fills in on its own.
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fake provider</title>
<style>
  :root { color-scheme: light dark; --line: #8884; --muted: #888; font: 14px/1.5 system-ui, sans-serif; }
  body { max-width: 980px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 32px 0 8px; }
  p.muted, .muted { color: var(--muted); }
  section { border-top: 1px solid var(--line); }
  table { width: 100%; border-collapse: collapse; }
  td, th { text-align: left; padding: 6px 8px 6px 0; border-bottom: 1px solid var(--line); vertical-align: top; }
  code { font-size: 12px; }
  input, select, button { font: inherit; padding: 4px 8px; }
  button { cursor: pointer; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0; }
  pre { font-size: 12px; white-space: pre-wrap; word-break: break-word; margin: 4px 0 0; }
  #error { color: #d33; min-height: 1.5em; }
</style>
</head>
<body>
<h1>Fake provider</h1>
<p class="muted">Add a provider in the dashboard with one of the base URLs below, point a webhook channel at the receiver, then change things here.</p>
<table id="urls"></table>
<p id="error" role="alert"></p>

<section>
  <h2>Components</h2>
  <table id="components"></table>
  <form class="row" data-action="component-add"><input name="name" placeholder="New component" required><button>Add</button></form>
</section>

<section>
  <h2>Incidents</h2>
  <form class="row" data-action="incident-open">
    <input name="name" placeholder="Elevated error rates">
    <select name="impact"><option>minor</option><option selected>major</option><option>critical</option></select>
    <span id="incident-components"></span>
    <button>Open incident</button>
  </form>
  <table id="incidents"></table>
</section>

<section>
  <h2>Maintenance</h2>
  <form class="row" data-action="maintenance-start">
    <input name="name" placeholder="Scheduled database upgrade">
    <input name="minutes" type="number" min="1" value="60" style="width: 6em"> minutes
    <button>Start maintenance</button>
  </form>
  <table id="maintenances"></table>
</section>

<section>
  <h2>Faults</h2>
  <div class="row" id="faults">
    <label><input type="radio" name="fault" value="none"> Answer normally</label>
    <label><input type="radio" name="fault" value="error"> Answer 500</label>
    <label><input type="radio" name="fault" value="slow"> Answer slowly</label>
    <input id="delay" type="number" min="0" step="500" value="15000" style="width: 7em"> ms
  </div>
</section>

<section>
  <h2>Webhook receiver <button id="clear" type="button">Clear</button></h2>
  <table id="deliveries"></table>
</section>

<script>
const LEVELS = ${JSON.stringify(COMPONENT_LEVELS)};
const STATUSES = ${JSON.stringify(INCIDENT_STATUSES)};
const IMPACTS = ${JSON.stringify(IMPACTS)};
const $ = (id) => document.getElementById(id);
const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const options = (list, current) => list.map((v) => '<option' + (v === current ? ' selected' : '') + '>' + v + '</option>').join("");
let state;

async function act(action, body = {}) {
  const res = await fetch("/control/" + action, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json();
  $("error").textContent = res.ok ? "" : json.error;
  if (res.ok) render(json);
}

function render(next) {
  state = next;
  const origin = location.origin;
  $("urls").innerHTML = [
    ["Statuspage", origin + "/statuspage", "adapter statuspage"],
    ["Instatus", origin + "/instatus", "adapter instatus"],
    ["RSS", origin + "/rss/feed.xml", "adapter rss"],
    ["Webhook receiver", origin + "/hook", "webhook channel URL"],
  ].map(([name, url, hint]) => '<tr><th>' + name + '</th><td><code>' + url + '</code></td><td class="muted">' + hint + '</td></tr>').join("");

  $("components").innerHTML = state.components.map((c) =>
    '<tr><td>' + esc(c.name) + ' <span class="muted">' + c.id + '</span></td><td><select data-component="' + c.id + '">' + options(LEVELS, c.status) + '</select></td></tr>').join("");
  $("incident-components").innerHTML = state.components.map((c) =>
    '<label><input type="checkbox" name="componentIds" value="' + c.id + '"> ' + esc(c.name) + '</label>').join(" ");

  $("incidents").innerHTML = state.incidents.length === 0 ? '<tr><td class="muted">No incidents.</td></tr>' : state.incidents.map((i) =>
    '<tr><td>' + esc(i.name) + ' <span class="muted">' + i.id + (i.componentIds.length ? ' · ' + i.componentIds.join(", ") : '') + '</span></td>' +
    '<td><select data-incident="' + i.id + '" data-field="impact">' + options(IMPACTS, i.impact) + '</select></td>' +
    '<td><select data-incident="' + i.id + '" data-field="status">' + options(STATUSES, i.status) + '</select></td>' +
    '<td class="muted">updated ' + new Date(i.updatedAt).toLocaleTimeString() + '</td></tr>').join("");

  $("maintenances").innerHTML = state.maintenances.length === 0 ? '<tr><td class="muted">No maintenance.</td></tr>' : state.maintenances.map((m) =>
    '<tr><td>' + esc(m.name) + ' <span class="muted">' + m.id + '</span></td><td class="muted">until ' + new Date(m.endsAt).toLocaleTimeString() + '</td><td>' +
    (m.done ? '<span class="muted">ended</span>' : '<button data-end="' + m.id + '">End</button>') + '</td></tr>').join("");

  for (const radio of document.querySelectorAll('input[name="fault"]')) radio.checked = radio.value === state.fault.mode;

  $("deliveries").innerHTML = state.deliveries.length === 0 ? '<tr><td class="muted">Nothing received yet.</td></tr>' : state.deliveries.map((d) =>
    '<tr><td class="muted" style="white-space: nowrap">' + new Date(d.receivedAt).toLocaleTimeString() + '</td><td>' +
    esc(typeof d.body === "object" && d.body !== null && "message" in d.body ? d.body.message : '') +
    '<pre class="muted">' + esc(JSON.stringify(d.body, null, 2)) + '</pre></td></tr>').join("");
}

document.addEventListener("change", (event) => {
  const el = event.target;
  if (el.dataset.component) act("component", { id: el.dataset.component, status: el.value });
  if (el.dataset.incident) act("incident-update", { id: el.dataset.incident, [el.dataset.field]: el.value });
  if (el.name === "fault") act("fault", { mode: el.value, delayMs: Number($("delay").value) });
  if (el.id === "delay" && state.fault.mode === "slow") act("fault", { mode: "slow", delayMs: Number(el.value) });
});
document.addEventListener("click", (event) => {
  if (event.target.dataset.end) act("maintenance-end", { id: event.target.dataset.end });
  if (event.target.id === "clear") act("deliveries-clear");
});
document.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  const body = Object.fromEntries(data);
  body.componentIds = data.getAll("componentIds");
  act(form.dataset.action, body);
  form.reset();
});

async function poll() {
  try {
    const res = await fetch("/state");
    // Re-render only while nothing is focused, so a half-typed field survives.
    if (res.ok && !document.activeElement?.matches("input:not([type=radio]):not([type=checkbox]), select")) render(await res.json());
  } catch {}
  setTimeout(poll, 2000);
}
poll();
</script>
</body>
</html>
`;

async function main(argv) {
  const flag = (name, fallback) => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? fallback : argv[index + 1];
  };
  const fake = await startFakeProvider({
    port: Number(flag("port", process.env.PORT ?? DEFAULT_PORT)),
    host: flag("host", "127.0.0.1"),
  });
  console.log(`fake provider on ${fake.url}

  control page   ${fake.url}/
  statuspage     ${fake.baseUrls.statuspage}
  instatus       ${fake.baseUrls.instatus}
  rss            ${fake.baseUrls.rss}
  webhook        ${fake.baseUrls.webhook}
`);
  const stop = () => fake.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
