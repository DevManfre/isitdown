/**
 * The dashboard shell: hash router, rail, header and the shared data it hands to
 * views. Vanilla ES modules, no framework and no build step.
 *
 * The rail is generated from the route table, so a view that is not registered
 * cannot be linked to. `/status` is re-read every 30 seconds — it is a pure DB
 * read on the server, which is why polling it is cheap.
 */

import * as api from "./api.js";
import { applyTranslations, loadCatalog, t } from "./i18n.js";
import { currentTheme, initTheme, nextTheme, setTheme } from "./theme.js";
import { element } from "./charts.js";
import { renderOverview } from "./views/overview.js";
import { renderProviders } from "./views/providers.js";
import { renderIncidents } from "./views/incidents.js";
import { renderIncident } from "./views/incident.js";
import { renderHistory } from "./views/history.js";
import { renderSettings } from "./views/settings.js";

const REFRESH_MS = 30_000;

/** Route table. A view is linkable only once it is registered here. */
const ROUTES = [
  { path: "overview", nav: "nav.overview", render: renderOverview },
  { path: "providers", nav: "nav.providers", render: renderProviders },
  { path: "incidents", nav: "nav.incidents", render: renderIncidents, detail: renderIncident },
  { path: "history", nav: "nav.history", render: renderHistory },
  { path: "settings", nav: "nav.settings", render: renderSettings },
];

/**
 * The prototype restarts a view's entry animations whenever the view, the
 * language or the theme changes, and never otherwise — which is what keeps the
 * 30-second refresh from re-playing the page under the operator's cursor. That
 * remount key lives here; `data-animate` on the container is how CSS sees it.
 */
let animatedKey;

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
  pollDot: document.getElementById("poll-next-dot"),
  pollTime: document.getElementById("poll-next-time"),
  pollNow: /** @type {HTMLButtonElement} */ (document.getElementById("poll-now")),
  railToggle: document.getElementById("rail-toggle"),
  rail: document.querySelector(".rail"),
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
    if (badge !== undefined) {
      // The incidents count only appears when something is open, so it is the
      // one badge that carries the alert tint.
      const alert = route.path === "incidents" ? " rail-badge-alert" : "";
      link.append(element("span", `rail-badge${alert}`, badge));
    }
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

const railCollapsed = () => document.documentElement.getAttribute("data-rail") === "collapsed";

/**
 * Pinned open or collapsed to the hover strip. The attribute lives on <html>
 * so the pre-paint script in index.html can restore it before the first frame;
 * hover-expanding a collapsed rail is CSS alone.
 */
function setRailCollapsed(collapsed) {
  if (collapsed) document.documentElement.setAttribute("data-rail", "collapsed");
  else document.documentElement.removeAttribute("data-rail");
  labelRailToggle();
  try {
    localStorage.setItem("isitdown.railCollapsed", String(collapsed));
  } catch {
    /* only costs the choice surviving a reload */
  }
}

function labelRailToggle() {
  dom.railToggle.setAttribute("aria-expanded", String(!railCollapsed()));
  dom.railToggle.setAttribute("aria-label", t(railCollapsed() ? "nav.rail-expand" : "nav.rail-collapse"));
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
        ].join(" · ");

  const themeTitle = t("theme.mode", { mode: t(`theme.${currentTheme()}`) });
  dom.themeToggle.title = themeTitle;
  dom.themeToggle.setAttribute("aria-label", themeTitle);
  renderCountdown();
  labelRailToggle();
  applyTranslations(document);
}

/**
 * The next-poll readout counts down live: a 1s tick recomputes the remainder
 * from nextPollAt, so it needs no extra requests between status refreshes.
 */
function renderCountdown() {
  const nextPollAt = state.status?.nextPollAt ?? null;
  if (nextPollAt === null) {
    dom.pollTime.textContent = state.status === undefined ? "" : t("meta.never-polled");
    dom.pollDot.className = "poll-next-dot";
    return;
  }
  const remaining = Math.max(0, new Date(nextPollAt).getTime() - Date.now());
  const minutes = Math.floor(remaining / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  dom.pollTime.textContent =
    minutes > 0
      ? t("meta.countdown", { minutes, seconds })
      : t("meta.countdown-seconds", { seconds });
  dom.pollDot.className = "poll-next-dot dot-pulse";
}

/** "incident" for the detail route, otherwise the route's own path. */
function viewName() {
  const route = ROUTES.find((entry) => entry.path === state.route.path) ?? ROUTES[0];
  return state.route.params.length > 0 && route.detail !== undefined ? "incident" : route.path;
}

const animationKey = () =>
  [viewName(), state.route.params.join("/"), state.preferences.uiLocale, currentTheme()].join("|");

/** Stamps the container so every entry animation inside it plays from the start. */
function playEntryAnimations() {
  dom.view.removeAttribute("data-animate");
  // Reading a layout property between the two writes is what makes the
  // container's own animation restart rather than continue where it was.
  void dom.view.offsetWidth;
  dom.view.setAttribute("data-animate", viewName());
}

async function renderView() {
  const route = ROUTES.find((entry) => entry.path === state.route.path) ?? ROUTES[0];
  const render =
    state.route.params.length > 0 && route.detail !== undefined ? route.detail : route.render;
  const key = animationKey();
  const replay = key !== animatedKey;
  animatedKey = key;

  dom.view.className = `view view-${viewName()}`;
  dom.view.removeAttribute("data-animate");
  dom.view.replaceChildren();
  try {
    await render(dom.view, state);
  } catch (error) {
    dom.view.replaceChildren(element("p", "empty", t("error.load-failed", { error: error.message })));
  }
  // After the content is in place, so the whole view animates as one.
  if (replay) playEntryAnimations();
}

function wireHeader() {
  dom.railToggle.addEventListener("click", () => {
    const collapsing = !railCollapsed();
    setRailCollapsed(collapsing);
    if (collapsing) {
      // The pointer and the focus are both still on the rail, and either one
      // would hold it open: blur drops the focus, .rail-hold blinds :hover
      // until the pointer has actually left once.
      dom.railToggle.blur();
      dom.rail.classList.add("rail-hold");
      dom.rail.addEventListener("mouseleave", () => dom.rail.classList.remove("rail-hold"), {
        once: true,
      });
    } else {
      dom.rail.classList.remove("rail-hold");
    }
  });

  dom.themeToggle.addEventListener("click", async () => {
    const chosen = setTheme(nextTheme());
    renderHeader();
    // A theme flip re-plays the view, exactly as the prototype's remount does.
    animatedKey = animationKey();
    playEntryAnimations();
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
    localStorage.setItem("isitdown.uiLocale", state.preferences.uiLocale);
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
  setInterval(renderCountdown, 1000);
}

void start();
