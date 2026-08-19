/**
 * The dashboard shell: hash router, rail, header and the shared data it hands to
 * views. Vanilla ES modules, no framework and no build step.
 *
 * The rail is generated from the route table, so a view that is not registered
 * cannot be linked to. `/status` is re-read every 30 seconds — it is a pure DB
 * read on the server, which is why polling it is cheap.
 */

import * as api from "./api.js";
import { applyTranslations, loadCatalog, t, formatTime } from "./i18n.js";
import { currentTheme, initTheme, nextTheme, setTheme } from "./theme.js";
import { element } from "./charts.js";
import { renderOverview } from "./views/overview.js";
import { openAddServiceDialog, renderProviders } from "./views/providers.js";
import { renderIncidents } from "./views/incidents.js";
import { renderIncident } from "./views/incident.js";

const REFRESH_MS = 30_000;

/** Route table. A view is linkable only once it is registered here. */
const ROUTES = [
  { path: "overview", nav: "nav.overview", render: renderOverview },
  { path: "providers", nav: "nav.providers", render: renderProviders },
  { path: "incidents", nav: "nav.incidents", render: renderIncidents, detail: renderIncident },
];

const state = {
  status: undefined,
  config: undefined,
  preferences: { theme: "system", uiLocale: "en", notificationLocale: "en" },
  route: { path: "overview", params: [] },
};

const dom = {
  view: document.getElementById("view"),
  title: document.getElementById("view-title"),
  meta: document.getElementById("view-meta"),
  railLinks: document.getElementById("rail-links"),
  railChannels: document.getElementById("rail-channels"),
  langSwitch: document.getElementById("lang-switch"),
  themeToggle: document.getElementById("theme-toggle"),
  themeLabel: document.getElementById("theme-label"),
  addService: document.getElementById("add-service"),
  pollNow: /** @type {HTMLButtonElement} */ (document.getElementById("poll-now")),
};

export const appState = state;
export const navigate = (hash) => {
  window.location.hash = hash;
};

/** Views call this after a write so the whole shell reflects the new state. */
export async function refresh() {
  const [status, config] = await Promise.all([api.getStatus(), api.getConfig()]);
  state.status = status;
  state.config = config;
  renderRail();
  renderHeader();
  await renderView();
}

function parseRoute() {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [path, ...params] = raw.split("/").filter((part) => part !== "");
  const known = ROUTES.some((route) => route.path === path);
  return { path: known ? path : ROUTES[0].path, params };
}

function renderRail() {
  dom.railLinks.replaceChildren();
  for (const route of ROUTES) {
    const link = element("button", "rail-link");
    link.type = "button";
    link.append(element("span", undefined, t(route.nav)));
    const badge = badgeFor(route.path);
    if (badge !== undefined) link.append(element("span", "rail-badge", badge));
    if (route.path === state.route.path) link.setAttribute("aria-current", "page");
    link.addEventListener("click", () => navigate(`#/${route.path}`));
    dom.railLinks.append(link);
  }

  dom.railChannels.replaceChildren();
  for (const channel of state.config?.channels ?? []) {
    const row = element("div", "rail-channel");
    const dot = element("span", "dot dot-sm");
    dot.style.background = channel.enabled
      ? "var(--status-operational)"
      : "var(--color-neutral-700)";
    row.append(dot, element("span", undefined, channel.id));
    dom.railChannels.append(row);
  }
}

function badgeFor(path) {
  if (state.status === undefined) return undefined;
  if (path === "providers") return String(state.status.providers.length);
  if (path === "incidents") {
    const open = state.status.providers.reduce(
      (total, provider) => total + provider.activeIncidents.length,
      0,
    );
    return open === 0 ? undefined : String(open);
  }
  return undefined;
}

function renderHeader() {
  const route = ROUTES.find((entry) => entry.path === state.route.path) ?? ROUTES[0];
  dom.title.textContent = t(route.nav);

  const status = state.status;
  dom.meta.textContent =
    status === undefined
      ? ""
      : [
          t("meta.watched", { count: status.providers.length }),
          t("meta.interval", { minutes: status.pollIntervalMinutes }),
          status.nextPollAt === null
            ? t("meta.never-polled")
            : t("meta.next-poll", { time: formatTime(status.nextPollAt) }),
        ].join(" · ");

  dom.themeLabel.textContent = t("theme.mode", { mode: t(`theme.${currentTheme()}`) });
  applyTranslations(document);
}

async function renderView() {
  const route = ROUTES.find((entry) => entry.path === state.route.path) ?? ROUTES[0];
  const render =
    state.route.params.length > 0 && route.detail !== undefined ? route.detail : route.render;
  dom.view.replaceChildren();
  try {
    await render(dom.view, state);
  } catch (error) {
    dom.view.replaceChildren(element("p", "empty", t("error.load-failed", { error: error.message })));
  }
}

function wireHeader() {
  dom.themeToggle.addEventListener("click", async () => {
    const chosen = setTheme(nextTheme());
    renderHeader();
    try {
      await api.patchPreferences({ theme: chosen });
    } catch {
      /* the local choice already applied; the server copy can wait */
    }
  });

  dom.pollNow.addEventListener("click", async () => {
    dom.pollNow.disabled = true;
    try {
      await api.pollNow();
      await refresh();
    } finally {
      dom.pollNow.disabled = false;
    }
  });

  dom.addService.addEventListener("click", () => {
    openAddServiceDialog();
  });
}

async function renderLangSwitch() {
  const languages = ["en", "it"];
  dom.langSwitch.replaceChildren();
  for (const language of languages) {
    const option = element("button", "lang-opt", language.toUpperCase());
    option.type = "button";
    option.setAttribute("aria-pressed", String(language === state.preferences.uiLocale));
    option.addEventListener("click", () => {
      void switchLanguage(language);
    });
    dom.langSwitch.append(option);
  }
}

async function switchLanguage(language) {
  state.preferences.uiLocale = await loadCatalog(language);
  document.documentElement.setAttribute("lang", state.preferences.uiLocale);
  try {
    localStorage.setItem("statuswatch.uiLocale", state.preferences.uiLocale);
  } catch {
    /* only costs the pre-paint hint */
  }
  await renderLangSwitch();
  renderRail();
  renderHeader();
  await renderView();
  try {
    await api.patchPreferences({ uiLocale: state.preferences.uiLocale });
  } catch {
    /* the switch already applied locally */
  }
}

async function start() {
  try {
    state.preferences = await api.getPreferences();
  } catch {
    /* defaults are fine if the server is not answering yet */
  }

  initTheme(state.preferences.theme, () => renderHeader());
  await loadCatalog(state.preferences.uiLocale);
  document.documentElement.setAttribute("lang", state.preferences.uiLocale);

  wireHeader();
  await renderLangSwitch();

  state.route = parseRoute();
  window.addEventListener("hashchange", () => {
    state.route = parseRoute();
    renderRail();
    renderHeader();
    void renderView();
  });

  await refresh();
  setInterval(() => {
    void refresh().catch(() => {
      /* a failed refresh keeps the last view rather than blanking it */
    });
  }, REFRESH_MS);
}

void start();
