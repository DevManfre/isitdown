import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PollIndicator } from "./PollIndicator.tsx";
import { Separator } from "@/components/ui/separator.tsx";
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
  settings: "nav.settings",
};

export function Header({ view }: { view: string }) {
  const { t, i18n } = useTranslation();
  const { mode, cycle } = useTheme();
  const { data: status } = useStatusChrome();
  const savePreferences = usePreferencesMutation();

  const lastSeen = status?.lastPollAt ?? null;
  // theme.mode's template needs {mode}; an empty call would leak the raw
  // "{mode} mode" placeholder into the aria-label instead of "Light mode".
  const themeTitle = t("theme.mode", { mode: t(`theme.${mode}`) });
  const ThemeIcon = THEME_ICONS[mode];

  return (
    <header className="header flex items-center justify-between gap-4 border-b border-border px-8 py-4">
      <div className="header-title flex flex-col">
        <h1 className="text-lg font-medium">{t(TITLE_KEYS[view] ?? "nav.overview")}</h1>
        <span className="header-meta text-xs text-muted-foreground">
          {lastSeen === null
            ? t("meta.never-polled")
            : t("meta.interval", { minutes: status?.pollIntervalMinutes ?? 0 })}
          {lastSeen !== null && ` · ${formatRelative(i18n.language, lastSeen)}`}
        </span>
      </div>

      <div className="header-actions flex items-center gap-4">
        <div className="lang-switch flex gap-1">
          {supportedLocales.map((lang) => (
            <button
              key={lang}
              type="button"
              className={cn("lang-opt rounded px-2 py-1 text-xs", i18n.language === lang && "text-primary")}
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

        <button
          type="button"
          className="theme-btn rounded p-1.5 text-primary"
          aria-label={themeTitle}
          title={themeTitle}
          onClick={() => {
            // cycle() both applies the local choice and hands back the mode
            // it switched to, so the persisted preference can never drift
            // from what the button just did.
            const next = cycle();
            savePreferences.mutate({ theme: next });
          }}
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
        </button>

        <Separator orientation="vertical" className="header-sep h-6" />
        <PollIndicator />
      </div>
    </header>
  );
}
