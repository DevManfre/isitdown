/**
 * Design 3a's Providers table: one row per configured provider with its status,
 * an inline uptime strip, its uptime and incident counts, and edit/remove.
 *
 * The add-service dialog is opened both from the header button and from the
 * dashed hint row at the bottom of the table.
 */

import * as api from "../api.js";
import { animate, element, stagger, statusColor, statusDot, uptimeStrip } from "../charts.js";
import { formatPercent, t } from "../i18n.js";
import { confirmModal, openModal } from "../components/modal.js";
import { createComponentPicker } from "../components/componentPicker.js";
import { refresh } from "../app.js";

const RANGE_DAYS = 90;

/**
 * The table's columns in order. `num` is the alignment the cell uses too, so a
 * header can never drift away from the figures under it.
 */
const COLUMNS = [
  { key: "column.provider" },
  { key: "column.status" },
  { key: "column.range", className: "col-range" },
  { key: "column.uptime", className: "num" },
  { key: "column.incidents", className: "num" },
  { key: "column.poll", className: "num" },
  { key: "column.adapter", className: "num" },
];

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

  // The filter is client-side, so a toggle swaps only the list below it: the
  // pills stay mounted and their accent outline transitions instead of
  // snapping through a full re-render.
  let list = listFor(all, byId, state);
  container.append(
    headerRow(() => {
      const next = listFor(all, byId, state);
      list.replaceWith(next);
      list = next;
    }),
  );
  container.append(list);
  container.append(addHint());
}

function listFor(all, byId, state) {
  const providers = showIssuesOnly
    ? all.filter((provider) => provider.overallStatus !== "operational")
    : all;
  return providers.length === 0
    ? element("p", "empty", t("providers.empty"))
    : table(providers, byId, state);
}

function headerRow(onToggle) {
  const row = element("div", "row-between");
  row.append(element("span", "muted", t("providers.intro")));

  const seg = element("div", "seg seg-pills");
  for (const [label, issuesOnly] of [
    [t("filter.all"), false],
    [t("filter.issues"), true],
  ]) {
    const option = element("button", "seg-opt mono", label);
    option.type = "button";
    option.setAttribute("aria-pressed", String(showIssuesOnly === issuesOnly));
    option.addEventListener("click", () => {
      if (showIssuesOnly === issuesOnly) return;
      showIssuesOnly = issuesOnly;
      for (const sibling of seg.children) {
        sibling.setAttribute("aria-pressed", String(sibling === option));
      }
      onToggle();
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
  for (const column of COLUMNS) {
    const label = column.key === "column.range" ? t(column.key, { days: RANGE_DAYS }) : t(column.key);
    headRow.append(element("th", column.className, label));
  }
  headRow.append(element("th", "col-actions"));
  head.append(headRow);
  table.append(head);

  const body = element("tbody");
  providers.forEach((provider, index) => {
    const history = byId.get(provider.id);
    const row = animate(element("tr"), "anim-rise anim-rise-table-row", stagger(index, 60));

    const nameCell = element("td");
    const nameWrap = element("div", "row-between");
    nameWrap.style.justifyContent = "flex-start";
    nameWrap.style.gap = "9px";
    const names = element("div", "stack-tight");
    names.append(element("span", "provider-name", provider.name));
    const host = element("span", "mono muted", hostOf(provider.baseUrl));
    host.style.fontSize = "10px";
    names.append(host);
    nameWrap.append(statusDot(provider.overallStatus, 8), names);
    nameCell.append(nameWrap);

    const statusCell = element("td");
    const statusLabel = element("span", "mono", t(statusKey(provider.overallStatus)).toUpperCase());
    statusLabel.style.fontSize = "10.5px";
    statusLabel.style.letterSpacing = "0.05em";
    statusLabel.style.color = statusColor(provider.overallStatus);
    statusCell.append(statusLabel);

    const barsCell = element("td", "col-range");
    barsCell.append(uptimeStrip(history?.buckets ?? []));

    const uptimeCell = element("td", "mono num", formatPercent(provider.uptime90));
    const incidentsCell = element("td", "mono muted num", String(history?.incidentCount ?? 0));
    const pollCell = element("td", "mono muted num", `${state.status?.pollIntervalMinutes ?? "-"}m`);
    const adapterCell = element("td", "mono muted num", provider.adapter);

    const actionsCell = element("td", "num");
    const actions = element("div", "row-actions");
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
  });
  table.append(body);
  return table;
}

export function editButton(provider) {
  const button = element("button", "btn btn-primary btn-row", t("action.edit"));
  button.type = "button";
  button.addEventListener("click", () => {
    // `modal` is assigned right after openModal below; the picker's load
    // button only becomes clickable once the dialog is on screen, so the
    // closure below always sees it set by the time it runs. Reading the live
    // input (rather than the `provider` captured at click time) means editing
    // the base URL and then choosing components previews the new one.
    /** @type {ReturnType<typeof openModal>} */
    let modal;
    const picker = createComponentPicker({
      load: () =>
        api.previewComponents({ adapter: provider.adapter, baseUrl: modal.inputs.baseUrl.value.trim() }),
      initial: provider.componentSelection ?? [],
      initialScope: provider.scopeToComponents === true,
    });
    modal = openModal({
      title: provider.name,
      confirmLabel: t("action.save"),
      fields: [
        { name: "name", label: t("field.name"), value: provider.name },
        { name: "baseUrl", label: t("field.base-url"), value: provider.baseUrl, mono: true },
        { label: t("components.field"), render: (wrap) => picker.mount(wrap) },
      ],
      onConfirm: async (values) => {
        await api.patchService(provider.id, {
          name: values.name,
          baseUrl: values.baseUrl,
          components: picker.value(),
          scopeToComponents: picker.scopeToComponents(),
        });
        await refresh();
      },
    });
  });
  return button;
}

export function removeButton(provider) {
  const button = element("button", "btn btn-danger btn-row", t("action.remove"));
  button.type = "button";
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
  // Last in, after the table has finished settling.
  const hint = animate(element("div", "add-hint"), "anim-rise", "340ms");
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
  // `modal` is assigned right after openModal below; the picker's load button
  // only becomes clickable once the dialog is on screen, so the closure below
  // always sees it set by the time it runs.
  /** @type {ReturnType<typeof openModal>} */
  let modal;
  const picker = createComponentPicker({
    load: () => api.previewComponents({ adapter, baseUrl: modal.inputs.baseUrl.value.trim() }),
  });
  modal = openModal({
    title: t("add.title"),
    subtitle: t("add.subtitle"),
    confirmLabel: t("action.add"),
    fields: [
      { name: "name", label: t("field.name"), placeholder: "Vercel", half: true },
      { name: "id", label: t("field.id"), placeholder: "vercel", mono: true, half: true },
      {
        label: t("field.adapter"),
        render: (wrap) => {
          const seg = element("div", "seg seg-pills");
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
        },
      },
      {
        name: "baseUrl",
        label: t("field.base-url"),
        placeholder: "https://www.vercel-status.com",
        mono: true,
        hint: t("add.note"),
      },
      { label: t("components.field"), render: (wrap) => picker.mount(wrap) },
    ],
    onConfirm: async (values) => {
      await api.addService({
        ...values,
        adapter,
        enabled: true,
        components: picker.value(),
        scopeToComponents: picker.scopeToComponents(),
      });
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
