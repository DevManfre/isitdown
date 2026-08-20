/**
 * Design 3a's Incidents view: the filter row, the accent-tinted active incident
 * card beside the notifications-sent panel, and the closed-incident list.
 *
 * Every section has its own keyed empty state — a blank panel reads as a broken
 * page rather than as good news.
 */

import * as api from "../api.js";
import { animate, element, stagger, statusColor, statusDot, statusFill } from "../charts.js";
import { formatDateTime, formatRelative, t } from "../i18n.js";
import { navigate } from "../app.js";

const FILTERS = [
  { key: "filter.all", value: "all" },
  { key: "filter.active", value: "active" },
  { key: "filter.resolved", value: "resolved" },
];

/** The chosen filter survives a reload, the way the rail's collapsed state does. */
const FILTER_STORAGE_KEY = "isitdown.incidentFilter";

let filter = storedFilter();

function storedFilter() {
  try {
    const stored = localStorage.getItem(FILTER_STORAGE_KEY);
    return FILTERS.some((entry) => entry.value === stored) ? stored : "all";
  } catch {
    return "all";
  }
}

function rememberFilter() {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, filter);
  } catch {
    /* only costs the choice surviving a reload */
  }
}

export async function renderIncidents(container, state) {
  const [incidents, feed] = await Promise.all([api.getIncidents(), api.getNotifications(8)]);
  const providerName = nameLookup(state);

  // The filter is a view of data already in hand, so switching repaints these
  // sections rather than re-running the route, which would refetch both endpoints.
  const sections = element("div", "incidents-sections");
  const paint = () => {
    sections.replaceChildren();
    const grid = element("div", "grid-incidents");
    // "resolved" drops the active card, so the feed takes the whole row rather
    // than leaving the column it vacated empty.
    if (filter === "resolved") grid.classList.add("grid-incidents-single");
    else grid.append(activePanel(incidents.active, providerName));
    grid.append(feedPanel(feed.notifications, providerName));
    sections.append(grid);
    if (filter !== "active") sections.append(closedList(incidents.closed, providerName));
  };

  container.append(filterRow(incidents, paint));
  paint();
  container.append(sections);
}

/**
 * The counts ride inside the pills so the operator reads how much each filter
 * holds without having to switch to it.
 */
function filterRow(incidents, onChange) {
  const counts = {
    all: incidents.active.length + incidents.closed.length,
    active: incidents.active.length,
    resolved: incidents.closed.length,
  };

  const row = element("div", "header-actions");
  const seg = element("div", "seg seg-pills");
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", t("incidents.filter.label"));

  for (const entry of FILTERS) {
    const option = element("button", "seg-opt mono", t(entry.key));
    option.type = "button";
    option.setAttribute("aria-pressed", String(entry.value === filter));
    option.append(element("span", "seg-count", String(counts[entry.value])));
    option.addEventListener("click", () => {
      if (filter === entry.value) return;
      filter = entry.value;
      rememberFilter();
      for (const sibling of seg.children) {
        sibling.setAttribute("aria-pressed", String(sibling === option));
      }
      onChange();
    });
    seg.append(option);
  }

  // A grouped control is walked with the arrow keys, not only tabbed through.
  seg.addEventListener("keydown", (event) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const options = [...seg.children];
    const next = options[(options.indexOf(document.activeElement) + step + options.length) % options.length];
    next.focus();
    next.click();
  });

  row.append(seg);
  return row;
}

function activePanel(active, providerName) {
  const panel = animate(element("div", "panel panel-accent"), "anim-rise", "60ms");
  panel.append(
    (() => {
      const head = element("div", "row-between");
      head.append(element("span", "kicker kicker-accent", t("incidents.active")));
      if (active.length > 0) {
        head.append(
          element("span", "mono muted", `${active[0].incidentId} · ${formatRelative(active[0].startedAt)}`),
        );
      }
      return head;
    })(),
  );

  if (active.length === 0) {
    panel.append(element("p", "empty", t("incidents.empty-active")));
    return panel;
  }

  const incident = active[0];
  const title = element("span");
  title.style.font = "500 17px var(--font-heading)";
  title.textContent = `${providerName(incident.providerId)} — ${incident.name}`;
  panel.append(title);

  panel.append(
    element(
      "span",
      "muted",
      t("incidents.impact-line", {
        impact: t(impactKey(incident.impact)),
        status: t(incidentStatusKey(incident.status)),
      }),
    ),
  );

  const actions = element("div", "header-actions");
  const details = element("button", "btn btn-primary", t("action.incident-details"));
  details.type = "button";
  details.addEventListener("click", () => navigate(`#/incidents/${incident.providerId}/${incident.incidentId}`));
  actions.append(details);
  panel.append(actions);

  if (active.length > 1) {
    const more = element("div", "stack-tight");
    for (const other of active.slice(1)) {
      const link = element("button", "btn btn-ghost", `${providerName(other.providerId)} — ${other.name}`);
      link.type = "button";
      link.style.justifyContent = "flex-start";
      link.addEventListener("click", () => navigate(`#/incidents/${other.providerId}/${other.incidentId}`));
      more.append(link);
    }
    panel.append(more);
  }
  return panel;
}

function feedPanel(notifications, providerName) {
  const panel = animate(element("div", "panel"), "anim-rise", "140ms");
  panel.append(element("span", "kicker", t("incidents.notifications-sent")));

  if (notifications.length === 0) {
    panel.append(element("p", "empty", t("incidents.empty-notifications")));
    return panel;
  }

  notifications.forEach((record, index) => {
    const row = animate(element("div"), "anim-fade", stagger(index, 65));
    row.style.display = "flex";
    row.style.alignItems = "baseline";
    row.style.gap = "9px";
    row.style.padding = "5px 0";
    row.style.borderTop = "1px solid var(--color-divider)";

    const dot = element("span", "dot dot-sm");
    dot.style.background = record.ok ? "var(--status-operational-fill)" : "var(--status-major-outage-fill)";
    dot.style.transform = "translateY(-2px)";

    const text = element("div", "stack-tight");
    // The stored text is the message actually delivered, first line only here.
    text.append(element("span", undefined, record.text.split("\n")[0]));
    const meta = element("span", "mono muted");
    meta.style.fontSize = "10.5px";
    meta.textContent = `${record.channel} · ${formatDateTime(record.sentAt)} · ${providerName(record.providerId)}`;
    text.append(meta);

    row.append(dot, text);
    panel.append(row);
  });
  return panel;
}

function closedList(closed, providerName) {
  const section = element("div", "incident-list");
  section.append(element("span", "kicker", t("incidents.closed")));

  if (closed.length === 0) {
    section.append(element("p", "empty", t("incidents.empty-closed")));
    return section;
  }

  closed.forEach((incident, index) => {
    const row = animate(element("div", "incident-row"), "anim-rise anim-rise-row", stagger(index, 70));
    row.append(element("span", "mono muted", formatDateTime(incident.startedAt)));

    const middle = element("div", "stack-tight");
    const heading = element("div", "row-between");
    heading.style.justifyContent = "flex-start";
    heading.style.gap = "8px";
    heading.append(
      statusDot(impactStatus(incident.impact)),
      element("span", "provider-name", `${providerName(incident.providerId)} — ${incident.name}`),
    );
    middle.append(heading);
    middle.append(
      element(
        "span",
        "muted",
        t("incidents.impact-line", {
          impact: t(impactKey(incident.impact)),
          status: t(incidentStatusKey(incident.status)),
        }),
      ),
    );

    const state = element("span", "mono muted");
    state.style.border = "1px solid var(--color-neutral-800)";
    state.style.borderRadius = "4px";
    state.style.padding = "2px 7px";
    state.textContent = t("incident.status.resolved");

    const open = element("button", "btn btn-ghost", t("action.incident-details"));
    open.type = "button";
    open.addEventListener("click", () =>
      navigate(`#/incidents/${incident.providerId}/${incident.incidentId}`),
    );

    const right = element("div", "header-actions");
    right.append(state, open);
    row.append(middle, right);
    section.append(row);
  });
  return section;
}

const IMPACT_KEYS = {
  none: "impact.none",
  minor: "impact.minor",
  major: "impact.major",
  critical: "impact.critical",
};
export const impactKey = (impact) => IMPACT_KEYS[impact] ?? "impact.none";

const INCIDENT_STATUS_KEYS = {
  investigating: "incident.status.investigating",
  identified: "incident.status.identified",
  monitoring: "incident.status.monitoring",
  resolved: "incident.status.resolved",
  postmortem: "incident.status.postmortem",
};
export const incidentStatusKey = (status) =>
  INCIDENT_STATUS_KEYS[status] ?? "incident.status.investigating";

/** Impact drives the dot colour, mapped onto the severity model's own tokens. */
const IMPACT_STATUS = {
  none: "operational",
  minor: "degraded",
  major: "partial_outage",
  critical: "major_outage",
};
export const impactStatus = (impact) => IMPACT_STATUS[impact] ?? "unknown";
export const impactColor = (impact) => statusColor(impactStatus(impact));
export const impactFill = (impact) => statusFill(impactStatus(impact));

export function nameLookup(state) {
  const names = new Map((state.status?.providers ?? []).map((provider) => [provider.id, provider.name]));
  return (providerId) => names.get(providerId) ?? providerId;
}
