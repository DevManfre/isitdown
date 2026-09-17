import { useCallback } from "react";
import { Menu, Monitor, Moon, Search, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler.tsx";
import { PollIndicator } from "./PollIndicator.tsx";
import { openCommandPalette } from "./CommandPalette.tsx";
import { openMoreSheet } from "./MobileNav.tsx";
import { usePreferencesMutation, useStatusChrome } from "@/hooks/queries.ts";
import { useTheme, type ThemeMode } from "@/hooks/useTheme.tsx";
import { supportedLocales, switchLocale } from "@/lib/i18n.ts";
import { formatRelative } from "@/lib/format.ts";
import { cn } from "@/lib/utils.ts";

/**
 * One glyph per mode, so the button says which theme is on without being read.
 * The prototype spun a single dot 180° between two modes; there are three here,
 * and a rotation cannot distinguish "system" from either end of it.
 */
const THEME_ICONS: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const TITLE_KEYS: Record<string, string> = {
  overview: "nav.overview",
  providers: "nav.providers",
  incidents: "nav.incidents",
  incident: "nav.incidents",
  history: "nav.history",
  "delivery-log": "nav.delivery-log",
  settings: "nav.settings",
};

export function Header({ view }: { view: string }) {
  const { t, i18n } = useTranslation();
  const { mode, cycle } = useTheme();
  const { data: status } = useStatusChrome();
  const savePreferences = usePreferencesMutation();

  // Undefined status is "the read has not answered", which is not the same
  // claim as an answer whose lastPollAt is null — collapsing the two put a
  // "not polled yet" the server had never said under the title on every
  // visit, and left it there for good when the read failed. The span stays,
  // with the line it will fill reserved, so the header keeps its height.
  const lastSeen = status?.lastPollAt ?? null;
  // theme.mode's template needs {mode}; an empty call would leak the raw
  // "{mode} mode" placeholder into the aria-label instead of "Light mode".
  const themeTitle = t("theme.mode", { mode: t(`theme.${mode}`) });
  // cycle() both applies the local choice and hands back the mode it switched
  // to, so the persisted preference can never drift from what the button just
  // did. The toggler calls this inside the view transition.
  const onToggleTheme = useCallback(() => {
    savePreferences.mutate({ theme: cycle() });
  }, [cycle, savePreferences]);
  const ThemeIcon = THEME_ICONS[mode];

  return (
    /* One grid for both widths, because the desktop header is the same shape
       as the phone one with the second column merged: title over meta on the
       left, controls on the right. On a phone the right column splits in two —
       the two icon buttons above, the poll cluster below — so seven controls
       stop competing for one 390px line. */
    <header className="header grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border px-4 py-2 md:gap-x-4 md:px-8 md:py-3">
      <h1 className="header-title col-start-1 row-start-1 truncate text-base font-medium md:text-lg">
        {t(TITLE_KEYS[view] ?? "nav.overview")}
      </h1>

      {/* The phone's own pair: search, and everything the desktop header shows
          inline. Both are 44px targets; the desktop keeps the labelled
          controls below. */}
      <div className="header-compact col-start-2 row-start-1 flex items-center justify-end lg:hidden">
        <button
          type="button"
          className="header-search-compact flex size-11 items-center justify-center rounded-md text-muted-foreground"
          aria-label={t("palette.open")}
          onClick={openCommandPalette}
        >
          <Search className="size-5" strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="header-more flex size-11 items-center justify-center rounded-md text-muted-foreground"
          aria-label={t("nav.more")}
          onClick={openMoreSheet}
        >
          <Menu className="size-5" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>

      <span className="header-meta col-start-1 row-start-2 min-h-4 truncate text-xs text-muted-foreground">
        {status !== undefined && (
          <>
            {lastSeen === null
              ? t("meta.never-polled")
              : t("meta.interval", { minutes: status.pollIntervalMinutes })}
            {lastSeen !== null && ` · ${formatRelative(i18n.language, lastSeen)}`}
          </>
        )}
      </span>

      <div className="header-actions col-start-2 row-start-2 flex items-center justify-end gap-2 md:row-span-2 md:row-start-1">
        {/* ⌘K existed before this button did, and nothing on screen said so.
            The button is the palette's only visible surface; it carries the
            shortcut on it so the second use is the keystroke. Hidden on a
            phone, where the icon button above says the same thing in 44px. */}
        <button
          type="button"
          className="header-search hidden items-center gap-2 rounded-md border border-border bg-card/60 py-1.5 pl-3 pr-2 text-xs text-muted-foreground lg:flex"
          onClick={openCommandPalette}
        >
          <Search className="size-3.5" strokeWidth={1.8} aria-hidden="true" />
          {t("palette.open")}
          <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">⌘K</kbd>
        </button>

        <div className="lang-switch hidden gap-1 rounded-md bg-muted/60 p-0.5 lg:flex">
          {supportedLocales.map((lang) => (
            <button
              key={lang}
              type="button"
              className={cn(
                "lang-opt rounded px-2 py-1 text-xs",
                i18n.language === lang && "bg-card text-primary shadow-sm",
              )}
              aria-pressed={i18n.language === lang}
              onClick={() => {
                void switchLocale(lang).then((applied) =>
                  savePreferences.mutate({ uiLocale: applied }),
                );
              }}
            >
              {lang.toUpperCase()}
            </button>
          ))}
        </div>

        {/* The switch reveals itself: the next theme is wiped over the page
            through a circle growing out of this button, so the operator sees
            where the change came from instead of the whole screen flipping at
            once. Browsers without View Transitions, and operators who asked
            for reduced motion, get the plain swap. */}
        <AnimatedThemeToggler
          className="theme-btn hidden rounded-md border border-border bg-card/60 p-1.5 text-primary lg:inline-flex"
          aria-label={themeTitle}
          title={themeTitle}
          onToggle={onToggleTheme}
        >
          {/* Keyed on the mode so every swap mounts a fresh element and plays
              the entry animation — two different icons are two different
              elements, and a transition has nothing to interpolate across
              that. The button's aria-label already names the mode. */}
          <ThemeIcon
            key={mode}
            data-testid="theme-icon"
            data-mode={mode}
            className="theme-icon size-4"
            strokeWidth={1.6}
            aria-hidden="true"
          />
        </AnimatedThemeToggler>

        {/* The separator is gone with the rule that drew it: the poll cluster
            carries its own outline now, which is a stronger edge than a
            hairline between two groups of controls ever was. */}
        <PollIndicator />
      </div>
    </header>
  );
}
