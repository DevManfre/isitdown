import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supportedLocales } from "@/lib/i18n.ts";
import type { Story } from "./stories.tsx";

const THEMES = ["light", "dark"] as const;

/*
 * The catalog's index: every story, light and dark side by side, in the
 * language picked at the top. Each story renders in its own frame, so its
 * fixtures, its storage and its theme are its own — two stories of one
 * component never share a query cache, and a dark frame cannot repaint the
 * light one next to it.
 *
 * Development-only: this page is never shipped (see index.html). Its own few
 * words still go through the catalogs, like every other string in src/ui/web.
 */
export function CatalogIndex({ stories, missing }: { stories: Story[]; missing: string | null }) {
  const { t } = useTranslation();
  const [locale, setLocale] = useState<string>("en");
  const [component, setComponent] = useState<string>("all");
  const [heights, setHeights] = useState<Record<string, number>>({});

  useEffect(() => {
    const onMessage = (event: MessageEvent<{ catalog?: string; height?: number }>) => {
      const { catalog, height } = event.data ?? {};
      if (event.origin !== location.origin || catalog === undefined || height === undefined) return;
      setHeights((current) => (current[catalog] === height ? current : { ...current, [catalog]: height }));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const components = [...new Set(stories.map((story) => story.id.split("--")[0] ?? story.id))];
  const shown = stories.filter((story) => component === "all" || story.id.startsWith(`${component}--`));

  return (
    <main className="flex flex-col gap-8 bg-background p-8 text-foreground">
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="text-lg font-medium">{t("component-catalog.title")}</h1>
        <label className="flex items-center gap-2 text-sm">
          {t("component-catalog.component")}
          <select className="rounded-md border border-border bg-card px-2 py-1" value={component} onChange={(event) => setComponent(event.target.value)}>
            <option value="all">{t("component-catalog.all")}</option>
            {components.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          {t("component-catalog.language")}
          <select className="rounded-md border border-border bg-card px-2 py-1" value={locale} onChange={(event) => setLocale(event.target.value)}>
            {supportedLocales.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        {missing !== null && <p className="text-sm text-muted-foreground">{t("component-catalog.missing", { id: missing })}</p>}
      </header>

      {shown.map((story) => (
        <section key={story.id} className="flex flex-col gap-2">
          <h2 className="font-mono text-sm">
            {story.id} <span className="text-muted-foreground">· {story.state}</span>
          </h2>
          <div className="grid gap-4 xl:grid-cols-2">
            {THEMES.map((theme) => {
              const search = `?${new URLSearchParams({ story: story.id, theme, locale })}`;
              return (
                <iframe
                  key={theme}
                  title={`${story.id} ${theme} ${locale}`}
                  src={search}
                  loading="lazy"
                  className="w-full rounded-lg border border-border"
                  style={{ height: heights[search] ?? 240 }}
                />
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
