import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const KEY = "isitdown.theme";
import { BASE_THEMES, THEME_MODES, type ThemeMode } from "../../themeModes.ts";

const MODES = THEME_MODES;
export type { ThemeMode };

/**
 * What each mode stamps on <html> — roadmap 4.18. A variant rides beside a
 * ground (`data-theme`) rather than replacing it, so Tailwind's `dark:` and the
 * globe, which read the ground, keep working for every variant, and a variant's
 * stylesheet block only has to list what it changes. `system` stamps nothing:
 * the media query decides.
 */
const STAMPS: Record<ThemeMode, { theme: "light" | "dark" | null; variant: string | null }> = {
  light: { theme: "light", variant: null },
  dark: { theme: "dark", variant: null },
  system: { theme: null, variant: null },
  contrast: { theme: "light", variant: "contrast" },
  colorblind: { theme: "light", variant: "colorblind" },
  oled: { theme: "dark", variant: "oled" },
};

interface ThemeApi {
  mode: ThemeMode;
  cycle: () => ThemeMode;
  set: (mode: ThemeMode) => void;
  /**
   * Apply the server's remembered theme — but only if this browser has no
   * choice of its own. See `ThemeProvider` for why that precedence.
   */
  adopt: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeApi>({
  mode: "system",
  cycle: () => "system",
  set: () => {},
  adopt: () => {},
});

/** The operator's own choice in this browser, or `null` if they have none. */
const stored = (): ThemeMode | null => {
  try {
    const value = localStorage.getItem(KEY);
    return MODES.includes(value as ThemeMode) ? (value as ThemeMode) : null;
  } catch {
    /* a blocked localStorage only costs the pre-paint hint */
    return null;
  }
};

const read = (): ThemeMode => stored() ?? "system";

const stamp = (mode: ThemeMode) => {
  const root = document.documentElement;
  const { theme, variant } = STAMPS[mode];
  if (theme === null) root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  if (variant === null) root.removeAttribute("data-variant");
  else root.setAttribute("data-variant", variant);
};

/**
 * light / dark / system, in that cycle.
 *
 * The choice is stored twice on purpose: in localStorage so the inline head
 * script can apply it before first paint, and in the database — by whoever
 * consumes `set` — so a fresh browser against the same instance starts where
 * the operator left off. `usePreferenceSync` reads the database half back.
 *
 * localStorage wins when both exist, and `adopt` is how that is enforced. The
 * pre-paint script has already stamped the local choice on <html> before React
 * runs; letting a later server value override it would repaint the page into a
 * different theme a beat after it appeared, which is the exact flash the
 * pre-paint script exists to prevent. So the server value seeds the theme only
 * when this browser has none.
 *
 * Whether it has one is sampled here, at mount, and not inside `adopt`: the
 * effect below writes `mode` to localStorage on the very first render, so by
 * the time the preferences request comes back there is always *something*
 * stored and a check made then could never tell a real choice from that
 * write-back.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(read);
  const [hasOwnChoice] = useState(() => stored() !== null);

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

  // A prior click's mode change flows into this render's `mode` before the
  // handler that reads the return value runs again, so the closure over
  // `mode` is not stale; the alternative — computing off ref state instead
  // of `mode` — would only matter for two cycles dispatched within one
  // render, which a theme button cannot do.
  const cycle = useCallback((): ThemeMode => {
    // Only the base three: the button is a quick flip between moods, and the
    // variants answer a need, so they are chosen in Settings. From a variant
    // the button goes back to the start of the cycle.
    const at = BASE_THEMES.indexOf(mode as (typeof BASE_THEMES)[number]);
    const next = BASE_THEMES[(at + 1) % BASE_THEMES.length] as ThemeMode;
    // Stamped here and not only in the effect above: the theme button runs
    // this inside a view transition, which snapshots the document the moment
    // the callback returns. A passive effect is too late for that snapshot —
    // the reveal would wipe the old theme onto itself. The effect still runs
    // and writes the same attribute, so the two never disagree.
    stamp(next);
    setMode(next);
    return next;
  }, [mode]);

  const adopt = useCallback(
    (next: ThemeMode) => {
      if (hasOwnChoice) return;
      setMode(next);
    },
    [hasOwnChoice],
  );

  const api = useMemo<ThemeApi>(() => ({ mode, cycle, set: setMode, adopt }), [mode, cycle, adopt]);
  return <ThemeContext.Provider value={api}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
