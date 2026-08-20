/**
 * Design 3a's History view: the aggregate uptime figure with the four month
 * columns, then one block per provider carrying its 7/30/90-day figures and its
 * daily bar row.
 *
 * The range control re-requests /history instead of re-slicing what is already
 * loaded, so the server stays the only place uptime is computed.
 */

import * as api from "../api.js";
import {
  animate,
  element,
  monthColumns,
  stagger,
  statusColor,
  statusDot,
  uptimeBarRow,
  uptimeStrip,
} from "../charts.js";
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
  const statusById = new Map((state.status?.providers ?? []).map((provider) => [provider.id, provider]));
  const names = new Map([...statusById].map(([id, provider]) => [id, provider.name]));

  container.append(summaryRow(summary), animate(element("div", "fade-rule"), "anim-sweep", "200ms"));

  if (summary.providers.length === 0) {
    container.append(element("p", "empty", t("empty.no-data")));
    return;
  }

  const rows = element("div", "history-list");
  summary.providers.forEach((provider, index) => {
    const block = providerBlock(provider, names.get(provider.providerId) ?? provider.providerId);
    rows.append(animate(block, "anim-rise", stagger(index, 80)));
    const statusProvider = statusById.get(provider.providerId);
    // /status already carries the selection: skip the request entirely for
    // the common case of a provider with nothing selected.
    if ((statusProvider?.componentSelection ?? []).length > 0) {
      appendComponentRows(block, provider.providerId, statusProvider);
    }
  });
  container.append(rows, exportRow());
}

/**
 * Fetches and appends the component breakdown once it resolves, independent of
 * the rest of the view: a provider's own figures are already on screen, so a
 * slow or failing component fetch must not hold up — or blank out — the page.
 * Only called for a provider with a non-empty component selection.
 * @param {HTMLElement} block
 * @param {string} providerId
 * @param {{ components?: { id: string, name: string, status: string }[] } | undefined} statusProvider
 */
function appendComponentRows(block, providerId, statusProvider) {
  const currentById = new Map(
    (statusProvider?.components ?? []).map((component) => [component.id, component]),
  );
  componentRows(providerId, currentById)
    .then((section) => {
      if (section !== null) block.append(element("div", "fade-rule"), section);
    })
    .catch(() => {
      // The provider's own uptime figures already rendered; a missing
      // component breakdown is not worth surfacing as a page-level error.
    });
}

/**
 * One row per selected component under the provider's own strip: dot, name,
 * strip, percentage. Rendered — and requested — only when the provider
 * selects components.
 * @param {string} providerId
 * @param {Map<string, { id: string, name: string, status: string }>} currentById component id -> current status payload
 */
async function componentRows(providerId, currentById) {
  const { components } = await api.getComponentHistory(providerId, days);
  if (components.length === 0) return null;

  const section = element("div", "stack-tight component-rows");
  section.append(element("span", "kicker kicker-accent", t("components.rows-title")));
  for (const component of components) {
    const row = element("div", "component-row row-between");
    const current = currentById.get(component.componentId);

    const left = element("div", "row-between component-row-name");
    left.style.justifyContent = "flex-start";
    left.style.gap = "9px";
    left.append(statusDot(current?.status ?? "unknown"));
    // Prefer the payload's current name over the selection's stale snapshot;
    // fall back to it only when the provider no longer reports the component
    // (never polled, or dropped upstream).
    left.append(element("span", "component-row-name-text", current?.name ?? component.name));
    row.append(left);

    row.append(uptimeStrip(component.buckets));

    const never = component.sampleCount === 0;
    row.append(
      element(
        "span",
        `mono component-row-figure${never ? " muted" : ""}`,
        never ? t("components.never-measured") : formatPercent(uptimeFor(component, days)),
      ),
    );

    section.append(row);
  }
  return section;
}

const uptimeFor = (component, days) =>
  days <= 7 ? component.uptime7 : days <= 30 ? component.uptime30 : component.uptime90;

function summaryRow(summary) {
  const row = element("div", "row-between");
  row.style.alignItems = "flex-end";

  const left = animate(element("div", "stack-tight"), "anim-rise anim-rise-column");
  left.append(element("span", "kicker kicker-accent", t("history.kicker")));
  left.append(element("span", "big-figure", formatPercent(summary.aggregateUptime)));
  left.append(
    element("span", "muted", t("history.subtitle", { count: summary.providers.length, days })),
  );

  const right = element("div", "header-actions");
  right.style.alignItems = "flex-end";
  right.append(rangeSwitch(), monthColumns(summary.months, monthLabel, t("history.month-no-data")));

  row.append(left, right);
  return row;
}

function rangeSwitch() {
  const seg = element("div", "seg seg-pills");
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
