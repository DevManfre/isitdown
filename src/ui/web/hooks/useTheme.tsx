import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const KEY = "isitdown.theme";
const MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof MODES)[number];

interface ThemeApi {
  mode: ThemeMode;
  cycle: () => void;
  set: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeApi>({ mode: "system", cycle: () => {}, set: () => {} });

const read = (): ThemeMode => {
  try {
    const stored = localStorage.getItem(KEY);
    return MODES.includes(stored as ThemeMode) ? (stored as ThemeMode) : "system";
  } catch {
    /* a blocked localStorage only costs the pre-paint hint */
    return "system";
  }
};

const stamp = (mode: ThemeMode) => {
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
};

/**
 * light / dark / system, in that cycle.
 *
 * The choice is stored twice on purpose: in localStorage so the inline head
 * script can apply it before first paint, and in the database — by whoever
 * consumes `set` — so a fresh browser against the same instance starts where
 * the operator left off.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(read);

  useEffect(() => {
    stamp(mode);
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* nothing to do: the attribute is already applied */
    }
  }, [mode]);

  // While following the system, react to the OS flipping without a reload.
  useEffect(() => {
    if (mode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => stamp("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [mode]);

  const cycle = useCallback(
    () => setMode((current) => MODES[(MODES.indexOf(current) + 1) % MODES.length] as ThemeMode),
    [],
  );

  const api = useMemo<ThemeApi>(() => ({ mode, cycle, set: setMode }), [mode, cycle]);
  return <ThemeContext.Provider value={api}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
