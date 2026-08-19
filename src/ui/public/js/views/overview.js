/**
 * Design 3a's Overview: the gradient hero with the headline and two calls to
 * action, a 2×2 grid of provider rings, then one uptime bar row per provider.
 *
 * The headline is chosen by plural rule, never assembled from fragments — "one
 * provider is off the line" and "3 providers are off the line" are separate keys.
 */

import * as api from "../api.js";
import { element, statusColor, statusDot, uptimeBarRow, uptimeRing } from "../charts.js";
import { formatPercent, formatRelative, t, tPlural } from "../i18n.js";
import { navigate } from "../app.js";

export async function renderOverview(container, state) {
  const summary = await api.getHistory(90);
  const providers = state.status?.providers ?? [];
  const bucketsById = new Map(summary.providers.map((entry) => [entry.providerId, entry.buckets]));

  container.classList.remove("view");
  container.append(hero(providers), providerRows(providers, bucketsById));
}

function hero(providers) {
  const wrap = element("div", "view-hero");
  const grid = element("div", "grid-two");

  const down = providers.filter((provider) => provider.overallStatus !== "operational");
  const text = element("div", "stack");
  text.append(element("span", "kicker kicker-accent", t("overview.kicker")));

  const title = element("h2", "hero-title");
  title.textContent =
    down.length === 0
      ? t("overview.title.all-operational")
      : tPlural("overview.title.down", down.length);
  text.append(title);

  const lastSeen = providers
    .map((provider) => provider.fetchedAt)
    .filter((value) => value !== null)
    .sort()
    .at(-1);
  const body = element("p", "hero-body");
  body.textContent =
    down.length === 0
      ? t("overview.body.all-operational", {
          count: providers.length,
          since: lastSeen === undefined ? t("meta.never-polled") : formatRelative(lastSeen),
        })
      : t("overview.body.down", {
          providers: down.map((provider) => provider.name).join(", "),
        });
  text.append(body);

  const actions = element("div", "header-actions");
  const firstIncident = providers.find((provider) => provider.activeIncidents.length > 0);
  if (firstIncident !== undefined) {
    const details = element("button", "btn btn-primary", t("action.incident-details"));
    details.type = "button";
    details.addEventListener("click", () =>
      navigate(`#/incidents/${firstIncident.id}/${firstIncident.activeIncidents[0].id}`),
    );
    actions.append(details);
  }
  const history = element("button", "btn btn-ghost", t("action.history-90d"));
  history.type = "button";
  history.addEventListener("click", () => navigate("#/history"));
  actions.append(history);
  text.append(actions);

  const rings = element("div", "ring-grid");
  for (const provider of providers) rings.append(uptimeRing(provider));

  grid.append(text, rings);
  wrap.append(grid);
  return wrap;
}

function providerRows(providers, bucketsById) {
  const section = element("div", "view");
  section.append(element("div", "fade-rule"));

  if (providers.length === 0) {
    section.append(element("p", "empty", t("providers.empty")));
    return section;
  }

  const rows = element("div", "stack");
  for (const provider of providers) {
    const row = element("div", "overview-row");

    const name = element("div", "row-between");
    name.style.justifyContent = "flex-start";
    name.style.gap = "9px";
    name.append(statusDot(provider.overallStatus, true), element("span", "provider-name", provider.name));

    const buckets = bucketsById.get(provider.id) ?? [];
    const bars = uptimeBarRow(buckets, (bucket) => `${bucket.day} · ${t(statusKey(bucket.status))}`);

    const label = element("span", "mono", t(statusKey(provider.overallStatus)).toUpperCase());
    label.style.fontSize = "11.5px";
    label.style.textAlign = "right";
    label.style.color = statusColor(provider.overallStatus);

    row.append(name, bars, label);
    rows.append(row);
  }
  section.append(rows);

  const footer = element("div", "row-between");
  footer.append(
    element("span", "muted", t("overview.uptime-window", { uptime: formatPercent(average(providers)) })),
  );
  section.append(footer);
  return section;
}

const STATUS_KEYS = {
  operational: "status.operational",
  degraded: "status.degraded",
  partial_outage: "status.partial-outage",
  major_outage: "status.major-outage",
  unknown: "status.unknown",
};

const statusKey = (status) => STATUS_KEYS[status] ?? STATUS_KEYS.unknown;

const average = (providers) =>
  providers.length === 0
    ? 0
    : Math.round((providers.reduce((sum, provider) => sum + provider.uptime90, 0) / providers.length) * 100) /
      100;
