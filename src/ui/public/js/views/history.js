/**
 * Design 3a's History view: the aggregate uptime figure with the four month
 * columns, then one block per provider carrying its 7/30/90-day figures and its
 * daily bar row.
 *
 * The range control re-requests /history instead of re-slicing what is already
 * loaded, so the server stays the only place uptime is computed.
 */

import * as api from "../api.js";
import { element, monthColumns, statusColor, uptimeBarRow } from "../charts.js";
import { formatDay, formatPercent, t, tPlural } from "../i18n.js";

const RANGES = [7, 30, 90];
let days = 90;

const STATUS_KEYS = {
  operational: "status.operational",
  degraded: "status.degraded",
  partial_outage: "status.partial-outage",
  major_outage: "status.major-outage",
  unknown: "status.unknown",
};
const statusKey = (status) => STATUS_KEYS[status] ?? STATUS_KEYS.unknown;

export async function renderHistory(container, state) {
  const summary = await api.getHistory(days);
  const names = new Map((state.status?.providers ?? []).map((provider) => [provider.id, provider.name]));

  container.append(summaryRow(summary), element("div", "fade-rule"));

  if (summary.providers.length === 0) {
    container.append(element("p", "empty", t("empty.no-data")));
    return;
  }

  const rows = element("div", "stack");
  for (const provider of summary.providers) {
    rows.append(providerBlock(provider, names.get(provider.providerId) ?? provider.providerId));
  }
  container.append(rows, exportRow());
}

function summaryRow(summary) {
  const row = element("div", "row-between");
  row.style.alignItems = "flex-end";

  const left = element("div", "stack-tight");
  left.append(element("span", "kicker kicker-accent", t("history.kicker")));
  left.append(element("span", "big-figure", formatPercent(summary.aggregateUptime)));
  left.append(
    element("span", "muted", t("history.subtitle", { count: summary.providers.length, days })),
  );

  const right = element("div", "header-actions");
  right.style.alignItems = "flex-end";
  right.append(rangeSwitch(), monthColumns(summary.months, monthLabel));

  row.append(left, right);
  return row;
}

function rangeSwitch() {
  const seg = element("div", "seg");
  for (const range of RANGES) {
    const option = element("button", "seg-opt mono", `${range}d`);
    option.type = "button";
    option.setAttribute("aria-pressed", String(range === days));
    option.addEventListener("click", () => {
      days = range;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    seg.append(option);
  }
  return seg;
}

function providerBlock(provider, name) {
  const block = element("div", "history-row");

  const head = element("div", "row-between");
  head.style.alignItems = "baseline";

  const label = element("div", "row-between");
  label.style.justifyContent = "flex-start";
  label.style.gap = "9px";
  const worst = provider.buckets.reduce(
    (acc, bucket) => (severity(bucket.status) > severity(acc) ? bucket.status : acc),
    "operational",
  );
  const dot = element("span", "dot");
  dot.style.background = statusColor(worst);
  label.append(dot, element("span", "provider-name", name));

  const figures = element("div", "history-figures");
  figures.append(element("span", undefined, `7d ${formatPercent(provider.uptime7)}`));
  figures.append(element("span", undefined, `30d ${formatPercent(provider.uptime30)}`));
  const ninety = element("span", undefined, `90d ${formatPercent(provider.uptime90)}`);
  ninety.style.color = "var(--color-neutral-300)";
  figures.append(ninety);
  figures.append(
    element(
      "span",
      undefined,
      `${tPlural("history.incidents", provider.incidentCount)} · ${t("history.downtime", {
        minutes: provider.downtimeMinutes,
      })}`,
    ),
  );

  head.append(label, figures);
  block.append(head);
  block.append(
    uptimeBarRow(provider.buckets, (bucket) => `${formatDay(bucket.day)} · ${t(statusKey(bucket.status))}`),
  );
  return block;
}

function exportRow() {
  const row = element("div", "header-actions");
  row.append(element("span", "muted", t("history.export")));
  const endpoint = element("span", "mono muted", `GET /history?days=${days}`);
  row.append(endpoint);
  return row;
}

const SEVERITY = { operational: 1, unknown: 0, degraded: 2, partial_outage: 3, major_outage: 4 };
const severity = (status) => SEVERITY[status] ?? 0;

const monthLabel = (month) =>
  new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(`${month}-01T00:00:00Z`));
