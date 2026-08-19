/**
 * Design 3a's Providers table: one row per configured provider with its status,
 * an inline uptime strip, its uptime and incident counts, and edit/remove.
 *
 * The add-service dialog is opened both from the header button and from the
 * dashed hint row at the bottom of the table.
 */

import * as api from "../api.js";
import { element, statusColor, statusDot, uptimeStrip } from "../charts.js";
import { formatPercent, t } from "../i18n.js";
import { confirmModal, openModal } from "../components/modal.js";
import { refresh } from "../app.js";

const RANGE_DAYS = 90;

const STATUS_KEYS = {
  operational: "status.operational",
  degraded: "status.degraded",
  partial_outage: "status.partial-outage",
  major_outage: "status.major-outage",
  unknown: "status.unknown",
};
const statusKey = (status) => STATUS_KEYS[status] ?? STATUS_KEYS.unknown;

let showIssuesOnly = false;

export async function renderProviders(container, state) {
  const summary = await api.getHistory(RANGE_DAYS);
  const byId = new Map(summary.providers.map((entry) => [entry.providerId, entry]));
  const all = state.status?.providers ?? [];
  const providers = showIssuesOnly
    ? all.filter((provider) => provider.overallStatus !== "operational")
    : all;

  container.append(headerRow());
  container.append(providers.length === 0 ? element("p", "empty", t("providers.empty")) : table(providers, byId, state));
  container.append(addHint());
}

function headerRow() {
  const row = element("div", "row-between");
  row.append(element("span", "muted", t("providers.intro")));

  const seg = element("div", "seg");
  for (const [label, issuesOnly] of [
    [t("filter.all"), false],
    [t("filter.issues"), true],
  ]) {
    const option = element("button", "seg-opt mono", label);
    option.type = "button";
    option.setAttribute("aria-pressed", String(showIssuesOnly === issuesOnly));
    option.addEventListener("click", () => {
      showIssuesOnly = issuesOnly;
      void refresh();
    });
    seg.append(option);
  }
  row.append(seg);
  return row;
}

function table(providers, byId, state) {
  const table = element("table", "table");
  const head = element("thead");
  const headRow = element("tr");
  for (const key of [
    "column.provider",
    "column.status",
    "column.range",
    "column.uptime",
    "column.incidents",
    "column.poll",
    "column.adapter",
  ]) {
    headRow.append(element("th", undefined, key === "column.range" ? t(key, { days: RANGE_DAYS }) : t(key)));
  }
  headRow.append(element("th"));
  head.append(headRow);
  table.append(head);

  const body = element("tbody");
  for (const provider of providers) {
    const history = byId.get(provider.id);
    const row = element("tr");

    const nameCell = element("td");
    const nameWrap = element("div", "row-between");
    nameWrap.style.justifyContent = "flex-start";
    nameWrap.style.gap = "9px";
    const names = element("div", "stack-tight");
    names.append(element("span", "provider-name", provider.name));
    const host = element("span", "mono muted", hostOf(provider.baseUrl));
    host.style.fontSize = "10px";
    names.append(host);
    nameWrap.append(statusDot(provider.overallStatus, true), names);
    nameCell.append(nameWrap);

    const statusCell = element("td");
    const statusLabel = element("span", "mono", t(statusKey(provider.overallStatus)).toUpperCase());
    statusLabel.style.fontSize = "10.5px";
    statusLabel.style.letterSpacing = "0.05em";
    statusLabel.style.color = statusColor(provider.overallStatus);
    statusCell.append(statusLabel);

    const barsCell = element("td");
    barsCell.style.width = "210px";
    barsCell.append(uptimeStrip(history?.buckets ?? []));

    const uptimeCell = element("td", "mono");
    uptimeCell.style.textAlign = "right";
    uptimeCell.textContent = formatPercent(provider.uptime90);

    const incidentsCell = element("td", "mono muted");
    incidentsCell.style.textAlign = "right";
    incidentsCell.textContent = String(history?.incidentCount ?? 0);

    const pollCell = element("td", "mono muted");
    pollCell.style.textAlign = "right";
    pollCell.textContent = `${state.status?.pollIntervalMinutes ?? "-"}m`;

    const adapterCell = element("td", "mono muted");
    adapterCell.style.textAlign = "right";
    adapterCell.textContent = provider.adapter;

    const actionsCell = element("td");
    actionsCell.style.textAlign = "right";
    const actions = element("div", "header-actions");
    actions.style.justifyContent = "flex-end";
    actions.append(editButton(provider), removeButton(provider));
    actionsCell.append(actions);

    row.append(
      nameCell,
      statusCell,
      barsCell,
      uptimeCell,
      incidentsCell,
      pollCell,
      adapterCell,
      actionsCell,
    );
    body.append(row);
  }
  table.append(body);
  return table;
}

function editButton(provider) {
  const button = element("button", "btn btn-ghost", t("action.edit"));
  button.type = "button";
  button.addEventListener("click", () => {
    openModal({
      title: provider.name,
      confirmLabel: t("action.save"),
      fields: [
        { name: "name", label: t("field.name"), value: provider.name },
        { name: "baseUrl", label: t("field.base-url"), value: provider.baseUrl, mono: true },
      ],
      onConfirm: async (values) => {
        await api.patchService(provider.id, { name: values.name, baseUrl: values.baseUrl });
        await refresh();
      },
    });
  });
  return button;
}

function removeButton(provider) {
  const button = element("button", "btn btn-ghost", t("action.remove"));
  button.type = "button";
  button.style.color = "var(--color-neutral-600)";
  button.addEventListener("click", () => {
    confirmModal({
      title: t("action.remove"),
      body: t("providers.remove-confirm", { name: provider.name }),
      confirmLabel: t("action.remove"),
      onConfirm: async () => {
        await api.removeService(provider.id);
        await refresh();
      },
    });
  });
  return button;
}

function addHint() {
  const hint = element("div", "add-hint");
  hint.append(element("span", "muted", t("providers.add-hint", { adapter: "statuspage" })));
  const button = element("button", "btn btn-primary", t("action.add-service"));
  button.type = "button";
  button.addEventListener("click", openAddServiceDialog);
  hint.append(button);
  return hint;
}

/** Shared with the header's add button, which dispatches an event. */
export function openAddServiceDialog() {
  let adapter = "statuspage";
  const modal = openModal({
    title: t("add.title"),
    subtitle: t("add.subtitle"),
    confirmLabel: t("action.add"),
    fields: [
      { name: "name", label: t("field.name"), placeholder: "Vercel" },
      { name: "id", label: t("field.id"), placeholder: "vercel", mono: true },
      { name: "baseUrl", label: t("field.base-url"), placeholder: "https://www.vercel-status.com", mono: true },
    ],
    extra: (dialog) => {
      const wrap = element("div", "field");
      wrap.append(element("label", undefined, t("field.adapter")));
      const seg = element("div", "seg");
      for (const option of ["statuspage", "custom"]) {
        const choice = element("button", "seg-opt mono", option);
        choice.type = "button";
        choice.setAttribute("aria-pressed", String(option === adapter));
        choice.addEventListener("click", () => {
          adapter = option;
          for (const sibling of seg.children) {
            sibling.setAttribute("aria-pressed", String(sibling.textContent === adapter));
          }
        });
        seg.append(choice);
      }
      wrap.append(seg);
      wrap.append(element("span", "mono muted", t("add.note")));
      dialog.append(wrap);
    },
    onConfirm: async (values) => {
      await api.addService({ ...values, adapter, enabled: true });
      const result = await api.testService(values.id);
      await refresh();
      if (!result.ok) {
        // The provider was added; it simply did not answer. Say so rather than
        // pretending the whole action failed.
        modal.message.textContent = t("add.test-failed", { error: result.error });
        modal.message.hidden = false;
      }
    },
  });
  return modal;
}

const hostOf = (baseUrl) => {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
};
