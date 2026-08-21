/**
 * The dashboard shell: hash router, rail, header and the shared data it hands to
 * views. Vanilla ES modules, no framework and no build step.
 *
 * The rail is generated from the route table, so a view that is not registered
 * cannot be linked to. `/status` is re-read every 30 seconds — it is a pure DB
 * read on the server, which is why polling it is cheap.
 *
 * That poll must not be visible: it repaints only when the payload changed,
 * and when it does it builds the new view off-screen and swaps it in one go,
 * so the page never blanks while a view waits for its own requests.
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
import { entryAnimationPlan, shouldHoldRefresh, snapshot } from "./refresh.js";

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

/** Fingerprint of the state the current DOM was built from. */
let rendered;

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
  await load(true);
}

/**
 * Re-reads the shell's data. A write repaints unconditionally — the operator
 * asked for it and is waiting to see it; the background poll repaints only on
 * a changed payload, which on a five-minute poll interval is one tick in ten.
 *
 * @param {boolean} force repaint even when nothing changed
 */
async function load(force) {
  const [status, config] = await Promise.all([api.getStatus(), api.getConfig()]);
  state.status = status;
  state.config = config;
  const fingerprint = snapshot(status, config);
  const changed = fingerprint !== rendered;
  rendered = fingerprint;
  if (!force && !changed) return;
  renderRail();
  renderHeader();
  await renderView({ offscreen: true });
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
      ? "var(--status-operational-fill)"
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

/** The mark motion.css silences a single node's entry animation with. */
const QUIET = "anim-quiet";

/** Stamps the container so every entry animation inside it plays from the start. */
function playEntryAnimations() {
  // What an earlier quiet repaint held still is exactly what a replay moves.
  for (const node of dom.view.querySelectorAll(`.${QUIET}`)) node.classList.remove(QUIET);
  dom.view.removeAttribute("data-animate");
  // Reading a layout property between the two writes is what makes the
  // container's own animation restart rather than continue where it was.
  void dom.view.offsetWidth;
  dom.view.setAttribute("data-animate", viewName());
}

/**
 * Holds the repaint the operator did not ask for still, then puts the gate
 * back. Leaving the gate off instead is what used to silence the view for the
 * rest of its life: every list a filter rebuilt afterwards appeared without
 * animating, because the marks its nodes carry only mean anything inside a
 * gated container.
 */
function silenceEntryAnimations() {
  for (const node of dom.view.querySelectorAll('[class*="anim-"]')) node.classList.add(QUIET);
  dom.view.setAttribute("data-animate", viewName());
}

/**
 * @param {{ offscreen?: boolean }} [options] render into a detached container
 * and swap it in once it is complete. Clearing `#view` up front instead would
 * leave the page empty for as long as the view's own requests take, which on a
 * refresh reads as the page reloading itself under the operator.
 */
async function renderView(options) {
  const offscreen = options?.offscreen === true;
  const route = ROUTES.find((entry) => entry.path === state.route.path) ?? ROUTES[0];
  const render =
    state.route.params.length > 0 && route.detail !== undefined ? route.detail : route.render;
  const key = animationKey();
  const { replay, quiet } = entryAnimationPlan(animatedKey, key);
  animatedKey = key;

  // Views are handed a container they may restyle (the overview drops `.view`),
  // so the class list travels with the swap.
  const target = offscreen ? document.createElement("div") : dom.view;
  target.className = `view view-${viewName()}`;
  // Nothing half-built may play, so the gate comes off for the build and goes
  // back on below — restamped by a replay, or with the new nodes held still.
  if (!offscreen) dom.view.removeAttribute("data-animate");
  target.replaceChildren();
  try {
    await render(target, state);
  } catch (error) {
    target.replaceChildren(element("p", "empty", t("error.load-failed", { error: error.message })));
  }
  if (offscreen) {
    dom.view.className = target.className;
    dom.view.removeAttribute("data-animate");
    dom.view.replaceChildren(...target.childNodes);
  }
  // After the content is in place, so the whole view animates as one.
  if (replay) playEntryAnimations();
  if (quiet) silenceEntryAnimations();
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

/** What the background refresh needs to know about the page right now. */
function pageState() {
  const active = document.activeElement;
  const tag = active === null ? "" : active.tagName;
  return {
    hidden: document.hidden,
    dialogOpen: document.querySelector(".dialog-backdrop") !== null,
    editing:
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      (active instanceof HTMLElement && active.isContentEditable),
  };
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
    if (shouldHoldRefresh(pageState())) return;
    void load(false).catch(() => {
      /* a failed refresh keeps the last view rather than blanking it */
    });
  }, REFRESH_MS);
  // A tab that was hidden across several ticks catches up the moment it is
  // looked at again, rather than showing stale data for up to 30 seconds.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    void load(false).catch(() => {});
  });
  setInterval(renderCountdown, 1000);
}

void start();
