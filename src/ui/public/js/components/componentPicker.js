/**
 * The component picker of the add/edit service dialog. Renders nothing until
 * `load` is invoked from its button, then shows the provider's components as
 * grouped, collapsible checkbox sections with a client-side search filter.
 * Nothing is preselected unless `initial` says so.
 */

import { element } from "../charts.js";
import { t } from "../i18n.js";

// Static, literal markup only — never anything derived from provider data —
// so parsing it as HTML carries no injection risk.
const ICON_SEARCH =
  '<svg class="component-picker-search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
  '<circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5"></circle>' +
  '<line x1="10.5" y1="10.5" x2="14" y2="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></line>' +
  "</svg>";
const ICON_CHEVRON =
  '<svg class="component-picker-chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">' +
  '<polyline points="2.5,3.5 5,6.5 7.5,3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></polyline>' +
  "</svg>";
const ICON_CHECK =
  '<svg class="component-picker-check-icon" width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">' +
  '<polyline points="1.5,5.5 4,8 8.5,2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></polyline>' +
  "</svg>";

/** @param {string} markup one of the constants above */
function icon(markup) {
  const template = document.createElement("template");
  template.innerHTML = markup;
  return /** @type {SVGElement} */ (template.content.firstElementChild);
}

/**
 * Buckets components by their resolved group label, preserving the order each
 * group and each member first appears in. A null group (Statuspage's
 * ungrouped components) becomes one bucket named with the ungrouped key.
 * @param {{ id: string, name: string, group: string | null }[]} components
 * @returns {Map<string, { id: string, name: string }[]>}
 */
function groupComponents(components) {
  const groups = new Map();
  for (const component of components) {
    const label = component.group ?? t("components.ungrouped");
    const members = groups.get(label) ?? [];
    members.push({ id: component.id, name: component.name });
    groups.set(label, members);
  }
  return groups;
}

/**
 * @param {{
 *   load: () => Promise<{ supported: boolean, components: { id: string, name: string, group: string | null, showcase: boolean }[] }>,
 *   initial?: { id: string, name: string }[],
 * }} options
 */
export function createComponentPicker(options) {
  const selected = new Map((options.initial ?? []).map((entry) => [entry.id, entry.name]));
  const root = element("div", "stack-tight component-picker");
  const count = element("span", "mono muted", t("components.selected", { count: selected.size }));
  const message = element("p", "muted");
  message.hidden = true;

  const searchWrap = element("div", "component-picker-search");
  searchWrap.hidden = true;
  const search = /** @type {HTMLInputElement} */ (
    element("input", "input component-picker-search-input")
  );
  search.type = "search";
  search.placeholder = t("components.search");
  searchWrap.append(icon(ICON_SEARCH), search);

  const listWrap = element("div", "component-picker-list");
  listWrap.hidden = true;

  const loadButton = element("button", "btn btn-ghost", t("components.load"));
  loadButton.type = "button";
  loadButton.addEventListener("click", async () => {
    loadButton.disabled = true;
    message.hidden = true;
    searchWrap.hidden = true;
    listWrap.hidden = true;
    listWrap.replaceChildren();
    try {
      const preview = await options.load();
      if (!preview.supported) {
        message.textContent = t("components.unsupported");
        message.hidden = false;
        return;
      }
      if (preview.components.length === 0) {
        message.textContent = t("components.empty");
        message.hidden = false;
        return;
      }
      renderList(preview.components);
    } catch (error) {
      message.textContent = /** @type {Error} */ (error).message;
      message.hidden = false;
    } finally {
      loadButton.disabled = false;
    }
  });

  /** @param {{ id: string, name: string }} member */
  function memberRow(member) {
    const row = element("label", "component-picker-row");
    row.dataset.name = member.name.toLowerCase();
    const checkWrap = element("span", "component-picker-check");
    const box = /** @type {HTMLInputElement} */ (element("input", "component-picker-checkbox"));
    box.type = "checkbox";
    box.checked = selected.has(member.id);
    box.addEventListener("change", () => {
      if (box.checked) selected.set(member.id, member.name);
      else selected.delete(member.id);
      count.textContent = t("components.selected", { count: selected.size });
    });
    checkWrap.append(box, icon(ICON_CHECK));
    row.append(checkWrap, element("span", "component-picker-row-name", member.name));
    return row;
  }

  /**
   * @param {string} label
   * @param {{ id: string, name: string }[]} members
   * @param {boolean} single
   */
  function groupSection(label, members, single) {
    const details = /** @type {HTMLDetailsElement} */ (
      element("details", "component-picker-group")
    );
    details.open = single;
    const summary = element("summary", "component-picker-group-summary");
    summary.append(
      icon(ICON_CHEVRON),
      element("span", "component-picker-group-name", label),
      element("span", "component-picker-group-count", String(members.length)),
    );
    details.append(summary);
    for (const member of members) details.append(memberRow(member));
    return details;
  }

  /** @param {{ id: string, name: string, group: string | null }[]} components */
  function renderList(components) {
    // A stale selection from a previously loaded provider (e.g. the base URL
    // changed between "Choose components" clicks) has no row here and would
    // otherwise still be saved by value(). Narrow the selection to this load.
    const freshIds = new Set(components.map((component) => component.id));
    for (const id of selected.keys()) {
      if (!freshIds.has(id)) selected.delete(id);
    }
    count.textContent = t("components.selected", { count: selected.size });

    search.value = "";
    listWrap.replaceChildren();
    const groups = groupComponents(components);
    const single = groups.size === 1;
    for (const [label, members] of groups) {
      listWrap.append(groupSection(label, members, single));
    }
    searchWrap.hidden = false;
    listWrap.hidden = false;
  }

  search.addEventListener("input", () => {
    const needle = search.value.trim().toLowerCase();
    for (const group of /** @type {NodeListOf<HTMLDetailsElement>} */ (
      listWrap.querySelectorAll(".component-picker-group")
    )) {
      let visible = 0;
      for (const row of /** @type {NodeListOf<HTMLElement>} */ (
        group.querySelectorAll(".component-picker-row")
      )) {
        const hit = needle === "" || (row.dataset.name ?? "").includes(needle);
        row.hidden = !hit;
        if (hit) visible += 1;
      }
      group.hidden = visible === 0;
      if (needle !== "") group.open = true;
    }
  });

  return {
    /** @param {HTMLElement} wrap */
    mount(wrap) {
      const header = element("div", "row-between");
      header.append(loadButton, count);
      root.append(header, message, searchWrap, listWrap);
      root.append(element("span", "mono field-hint", t("components.hint")));
      wrap.append(root);
    },
    value: () => [...selected.entries()].map(([id, name]) => ({ id, name })),
  };
}
