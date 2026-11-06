import { useCallback } from "react";
import { Contrast, Eye, Monitor, Moon, MoonStar, Search, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isApplePlatform } from "@/lib/shortcut.ts";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler.tsx";
import { PollIndicator } from "./PollIndicator.tsx";
import { openCommandPalette } from "./CommandPalette.tsx";
import { DashboardMenu } from "./dashboards/DashboardMenu.tsx";
import { usePreferencesMutation, useStatusChrome } from "@/hooks/queries.ts";
import { useTheme, type ThemeMode } from "@/hooks/useTheme.tsx";
import { formatRelative } from "@/lib/format.ts";

/**
 * One glyph per mode, so the button says which theme is on without being read.
 * The prototype spun a single dot 180° between two modes; there are three here,
 * and a rotation cannot distinguish "system" from either end of it.
 */
const THEME_ICONS: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
  // Roadmap 4.18: reachable from Settings, shown here so the button still
  // says which theme is on.
  contrast: Contrast,
  colorblind: Eye,
  oled: MoonStar,
};

const TITLE_KEYS: Record<string, string> = {
  overview: "nav.overview",
  providers: "nav.providers",
  components: "nav.components",
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
    /* One line at every width (dashboard-design-direction): the title with
       how often the estate is read beside it, then search, the poll control
       and the theme. The phone keeps the same order with the words folded
       into 44px icons; the views and everything else behind "More" live in
       the tab bar at the foot of the screen, so the header no longer carries
       a second door to that sheet. */
    <header className="header flex h-14 items-center justify-between gap-3 border-b border-border px-4 md:h-16 md:gap-4 md:px-8">
      {/* Roadmap 4.2: on the Overview the title carries which named dashboard
          is open, and the menu of what can be done with it. */}
      <div className="flex min-w-0 items-center gap-2">
        <h1 className="header-title truncate text-base font-semibold">
          {t(TITLE_KEYS[view] ?? "nav.overview")}
        </h1>
        {view === "overview" && <DashboardMenu />}
        {/* The cadence, and how long ago the last read was. Whether a poll has
            happened at all is the poll control's to say — it said "not polled
            yet" here and again beside the countdown. Undefined status is "the
            read has not answered", so the span stays empty rather than
            claiming anything. Off on a phone, where the countdown says enough. */}
        <span className="header-meta hidden min-w-0 truncate text-sm text-muted-foreground md:inline">
          {status !== undefined && (
            <>
              {t("meta.interval", { minutes: status.pollIntervalMinutes })}
              {lastSeen !== null && ` · ${formatRelative(i18n.language, lastSeen)}`}
            </>
          )}
        </span>
      </div>

      <div className="header-actions flex shrink-0 items-center gap-2">
        {/* ⌘K existed before this button did, and nothing on screen said so:
            the button carries the shortcut so the second use is the keystroke.
            On a phone it is a 44px icon. */}
        <button
          type="button"
          data-tour="search"
          className="header-search hidden h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-muted-foreground transition-colors duration-(--duration-fast) hover:text-foreground lg:flex"
          onClick={openCommandPalette}
        >
          <Search className="size-4" strokeWidth={1.8} aria-hidden="true" />
          {t("palette.open")}
          <kbd className="font-mono text-xs text-muted-foreground">
            {t(isApplePlatform() ? "palette.shortcut-mac" : "palette.shortcut-other")}
          </kbd>
        </button>
        <button
          type="button"
          className="header-search-compact flex size-11 items-center justify-center rounded-md text-muted-foreground lg:hidden"
          aria-label={t("palette.open")}
          onClick={openCommandPalette}
        >
          <Search className="size-5" strokeWidth={1.8} aria-hidden="true" />
        </button>

        <PollIndicator />

        {/* The switch reveals itself: the next theme is wiped over the page
            through a circle growing out of this button. Browsers without View
            Transitions, and operators who asked for reduced motion, get the
            plain swap. On a phone the theme lives in the More sheet. */}
        <AnimatedThemeToggler
          className="theme-btn hidden size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground lg:inline-flex"
          aria-label={themeTitle}
          title={themeTitle}
          onToggle={onToggleTheme}
        >
          {/* Keyed on the mode so every swap mounts a fresh element and plays
              the entry animation. The button's aria-label names the mode. */}
          <ThemeIcon
            key={mode}
            data-testid="theme-icon"
            data-mode={mode}
            className="theme-icon size-4"
            strokeWidth={1.8}
            aria-hidden="true"
          />
        </AnimatedThemeToggler>
      </div>
    </header>
  );
}
