/**
 * Design 3a's incident detail: the status stepper, the timeline of what
 * IsItDown observed, the action log of what it actually sent, the provider's
 * other open incidents, and the strip of recent polls.
 *
 * The timeline is our own observations rather than the provider's update feed —
 * the adapter does not normalise those, and inventing them would be worse than
 * showing less.
 */

import * as api from "../api.js";
import { element, pollStrip, statusDot } from "../charts.js";
import { formatDateTime, formatDuration, formatTime, t } from "../i18n.js";
import { navigate } from "../app.js";
import { impactKey, incidentStatusKey, impactColor, nameLookup } from "./incidents.js";

const STEPS = ["investigating", "identified", "monitoring", "resolved"];

export async function renderIncident(container, state) {
  const [providerId, incidentId] = state.route.params;
  if (providerId === undefined || incidentId === undefined) {
    navigate("#/incidents");
    return;
  }

  const detail = await api.getIncident(providerId, incidentId);
  const providerName = nameLookup(state);

  container.append(backLink(), heading(detail, providerName), stepper(detail.incident));

  const grid = element("div", "grid-detail");
  grid.append(leftColumn(detail), rightColumn(detail, providerName));
  container.append(grid);
}

function backLink() {
  const link = element("button", "btn btn-ghost mono", `← ${t("action.back")}`);
  link.type = "button";
  link.style.width = "fit-content";
  link.style.padding = "2px 0";
  link.addEventListener("click", () => navigate("#/overview"));
  return link;
}

function heading(detail, providerName) {
  const wrap = element("div", "row-between");
  const left = element("div", "stack-tight");

  const kickerRow = element("div", "header-actions");
  const kicker = element("span", "kicker", t("incident.kicker"));
  kicker.style.color = impactColor(detail.incident.impact);
  const severity = element("span", "mono", t(impactKey(detail.incident.impact)));
  severity.style.fontSize = "10.5px";
  severity.style.borderRadius = "4px";
  severity.style.padding = "1px 7px";
  severity.style.color = impactColor(detail.incident.impact);
  severity.style.border = "1px solid var(--status-degraded-border)";
  severity.style.background = "var(--status-degraded-tint)";
  kickerRow.append(kicker, severity, element("span", "mono muted", detail.incident.incidentId));
  left.append(kickerRow);

  const title = element("h2");
  title.style.margin = "0";
  title.style.fontSize = "32px";
  title.style.letterSpacing = "-0.025em";
  title.style.maxWidth = "26ch";
  title.textContent = detail.incident.name;
  left.append(title);

  const elapsed =
    detail.incident.resolvedAt === null
      ? t("incident.elapsed", { duration: durationSince(detail.incident.startedAt) })
      : t("incident.closed-after", {
          duration: durationBetween(detail.incident.startedAt, detail.incident.resolvedAt),
        });
  left.append(
    element("span", "mono muted", `${providerName(detail.incident.providerId)} · ${elapsed}`),
  );

  const actions = element("div", "header-actions");
  const copy = element("button", "btn btn-ghost mono", t("action.copy-payload"));
  copy.type = "button";
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(JSON.stringify(detail, null, 2));
    toast(t("incident.payload-copied"));
  });
  actions.append(copy);

  wrap.append(left, actions);
  return wrap;
}

function stepper(incident) {
  const wrap = element("div", "stepper");
  const reached = incident.resolvedAt === null ? STEPS.indexOf(incident.status) : STEPS.length - 1;

  STEPS.forEach((step, index) => {
    const entry = element("div", "step");
    const dot = element("span", "dot");
    dot.style.width = "9px";
    dot.style.height = "9px";
    const active = index <= reached;
    dot.style.background = active ? impactColor(incident.impact) : "var(--color-neutral-800)";

    const label = element("span", "mono", t(incidentStatusKey(step)));
    label.style.fontSize = "11px";
    label.style.color = active ? impactColor(incident.impact) : "var(--color-neutral-600)";
    label.style.fontWeight = index === reached ? "500" : "400";

    entry.append(dot, label, element("span", "step-line"));
    wrap.append(entry);
  });
  return wrap;
}

function leftColumn(detail) {
  const column = element("div", "stack");
  column.append(element("span", "kicker", t("incident.timeline")));

  for (const entry of detail.timeline) {
    const row = element("div", "timeline-entry");
    row.append(element("span", "mono muted", formatTime(entry.at)));
    const body = element("div", "stack-tight");
    body.append(element("span", "kicker", t(`incident.timeline.${entry.label}`)));
    if (entry.status !== undefined) {
      body.append(element("span", undefined, t(incidentStatusKey(entry.status))));
    }
    row.append(body);
    column.append(row);
  }

  const log = element("div", "stack-tight");
  log.append(element("span", "kicker kicker-accent", t("incident.what-we-did")));
  const panel = element("div", "panel panel-accent");
  if (detail.actionLog.length === 0) {
    panel.append(element("p", "empty", t("incidents.empty-notifications")));
  } else {
    for (const record of detail.actionLog) {
      const row = element("div");
      row.style.display = "grid";
      row.style.gridTemplateColumns = "70px 1fr";
      row.style.gap = "12px";
      row.style.alignItems = "baseline";
      row.append(element("span", "mono muted", formatTime(record.sentAt)));
      const line = element("span", "mono");
      line.style.fontSize = "11px";
      line.textContent = `${record.channel}: ${record.text.split("\n")[0]}${record.ok ? "" : ` — ${record.error}`}`;
      row.append(line);
      panel.append(row);
    }
  }
  log.append(panel);
  column.append(log);
  return column;
}

function rightColumn(detail, providerName) {
  const column = element("div", "stack");

  const others = element("div", "stack-tight");
  others.append(element("span", "kicker", t("incident.other-active")));
  if (detail.otherActiveIncidents.length === 0) {
    others.append(element("p", "empty", t("incident.no-other-active")));
  } else {
    for (const other of detail.otherActiveIncidents) {
      const row = element("div", "service-row");
      const left = element("div", "row-between");
      left.style.justifyContent = "flex-start";
      left.style.gap = "9px";
      left.append(statusDot(statusFromImpact(other.impact)), element("span", undefined, other.name));
      const status = element("span", "mono", t(incidentStatusKey(other.status)));
      status.style.fontSize = "10.5px";
      status.style.color = impactColor(other.impact);
      row.append(left, status);
      row.style.cursor = "pointer";
      row.addEventListener("click", () =>
        navigate(`#/incidents/${other.providerId}/${other.incidentId}`),
      );
      others.append(row);
    }
  }
  column.append(others);

  const polls = element("div", "stack-tight");
  polls.append(element("span", "kicker", t("incident.last-polls", { count: detail.polls.length })));
  polls.append(pollStrip(detail.polls));
  if (detail.polls.length > 0) {
    const first = detail.polls[detail.polls.length - 1];
    const last = detail.polls[0];
    polls.append(
      element(
        "span",
        "mono muted",
        `${formatTime(first.observedAt)} → ${formatTime(last.observedAt)} · ${providerName(detail.incident.providerId)}`,
      ),
    );
  }
  column.append(polls);

  const meta = element("div", "stack-tight");
  meta.append(element("span", "kicker", t("column.status")));
  const row = element("div", "service-row");
  row.append(
    element("span", undefined, t(incidentStatusKey(detail.incident.status))),
    element("span", "mono muted", formatDateTime(detail.incident.updatedAt)),
  );
  meta.append(row);
  column.append(meta);

  return column;
}

const statusFromImpact = (impact) =>
  ({ none: "operational", minor: "degraded", major: "partial_outage", critical: "major_outage" })[impact] ??
  "unknown";

const durationSince = (from) => formatDuration((Date.now() - Date.parse(from)) / 60_000);
const durationBetween = (from, to) => formatDuration((Date.parse(to) - Date.parse(from)) / 60_000);

function toast(message) {
  const node = element("div", "toast", message);
  document.body.append(node);
  setTimeout(() => node.remove(), 2500);
}
