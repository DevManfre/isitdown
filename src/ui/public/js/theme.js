/**
 * light / dark / system, in that cycle.
 *
 * The choice is stored twice on purpose: in localStorage so the inline head
 * script can apply it before first paint, and in the database so a fresh browser
 * against the same instance starts where the operator left off.
 */

const KEY = "isitdown.theme";
const MODES = ["light", "dark", "system"];

let mode = "system";
/** @type {(mode: string) => void} */
let onChange = () => {};

export function initTheme(stored, notify) {
  onChange = notify ?? (() => {});
  mode = MODES.includes(stored) ? stored : "system";
  apply();

  // While following the system, react to the OS flipping without a reload.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (mode === "system") onChange(mode);
  });
  return mode;
}

export const currentTheme = () => mode;

export function nextTheme() {
  return MODES[(MODES.indexOf(mode) + 1) % MODES.length];
}

export function setTheme(next) {
  mode = MODES.includes(next) ? next : "system";
  apply();
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* a blocked localStorage only costs the pre-paint hint */
  }
  onChange(mode);
  return mode;
}

function apply() {
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
}
