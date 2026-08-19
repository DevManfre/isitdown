/**
 * Design 3a's Overview: the gradient hero with the headline and two calls to
 * action, a 2×2 grid of provider rings, then one uptime bar row per provider.
 *
 * The headline is chosen by plural rule, never assembled from fragments — "one
 * provider is off the line" and "3 providers are off the line" are separate keys.
 */

import * as api from "../api.js";
import {
  animate,
  element,
  stagger,
  statusColor,
  statusDot,
  uptimeBarRow,
  uptimeRing,
} from "../charts.js";
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
  const text = element("div", "hero-copy");
  // The hero enters line by line, 60–70ms apart, headline first.
  text.append(animate(element("span", "kicker kicker-accent kicker-hero", t("overview.kicker")), "anim-rise"));

  const title = animate(element("h2", "hero-title"), "anim-rise anim-rise-hero", "60ms");
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
  const body = animate(element("p", "hero-body"), "anim-rise anim-rise-hero", "130ms");
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

  const actions = animate(element("div", "header-actions"), "anim-rise anim-rise-hero", "200ms");
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
  // The rings follow the hero, 80ms apart, after a 120ms lead-in.
  providers.forEach((provider, index) => rings.append(uptimeRing(provider, stagger(index, 80, 120))));

  grid.append(text, rings);
  wrap.append(grid);
  return wrap;
}

function providerRows(providers, bucketsById) {
  const section = element("div", "overview-rows");
  // The rule draws itself outwards under the hero before the rows arrive.
  section.append(animate(element("div", "fade-rule"), "anim-sweep", "220ms"));

  if (providers.length === 0) {
    section.append(element("p", "empty", t("providers.empty")));
    return section;
  }

  const rows = element("div", "overview-list");
  providers.forEach((provider, index) => {
    const row = animate(element("div", "overview-row"), "anim-rise", stagger(index, 70));

    const name = element("div", "row-between");
    name.style.justifyContent = "flex-start";
    name.style.gap = "9px";
    name.append(statusDot(provider.overallStatus, 12), element("span", "provider-name", provider.name));

    const buckets = bucketsById.get(provider.id) ?? [];
    const bars = uptimeBarRow(
      buckets,
      (bucket) => `${bucket.day} · ${t(statusKey(bucket.status))}`,
      "compact",
    );

    const label = element("span", "mono", t(statusKey(provider.overallStatus)).toUpperCase());
    label.style.fontSize = "11.5px";
    label.style.textAlign = "right";
    label.style.color = statusColor(provider.overallStatus);

    row.append(name, bars, label);
    rows.append(row);
  });
  section.append(rows);

  const footer = animate(
    element("div", "row-between"),
    "anim-fade",
    stagger(providers.length, 70),
  );
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
