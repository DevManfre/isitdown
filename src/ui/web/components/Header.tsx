import { useTranslation } from "react-i18next";
import { PollIndicator } from "./PollIndicator.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { usePreferencesMutation, useStatusChrome } from "@/hooks/queries.ts";
import { useTheme } from "@/hooks/useTheme.tsx";
import { supportedLocales, switchLocale } from "@/lib/i18n.ts";
import { formatRelative } from "@/lib/format.ts";
import { cn } from "@/lib/utils.ts";

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
          className="theme-btn rounded p-1.5"
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
          <span className="theme-dot block size-3 rounded-full bg-primary" />
        </button>

        <Separator orientation="vertical" className="header-sep h-6" />
        <PollIndicator />
      </div>
    </header>
  );
}
