import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsChrome } from "@/components/settings/SettingsChrome.tsx";
import { cn } from "@/lib/utils.ts";

export interface NavSection {
  id: string;
  labelKey: string;
}

/**
 * The page's own contents list: every section one click away, with the number
 * of rows each still shows under the filter.
 *
 * Settings stayed one scrolling column on purpose — instant-apply means a
 * change in Engine and a change in Delivery are the same act, and tabs would
 * have made them feel like different pages — but seven sections deep, reaching
 * the last one meant scrolling past forty rows. This is the half that was
 * missing: the column is unchanged, and the rail says where you are in it.
 *
 * Scroll-spy marks the section whose top has last crossed the upper quarter of
 * the viewport, rather than whichever is most visible: a short section at the
 * bottom of the page can never win an area contest against the long one above
 * it, and would stay unreachable in the rail.
 */
export function SettingsNav({ sections }: { sections: NavSection[] }) {
  const { t } = useTranslation();
  const { counts } = useSettingsChrome();
  const [active, setActive] = useState(sections[0]?.id);

  useEffect(() => {
    const observed = sections
      .map((section) => document.getElementById(`settings-${section.id}`))
      .filter((element): element is HTMLElement => element !== null);
    if (observed.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id.replace("settings-", ""));
        }
      },
      { rootMargin: "-25% 0px -70% 0px" },
    );
    observed.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [sections]);

  return (
    // `self-start` is what makes `sticky` do anything: a flex item stretches to
    // the row's full height by default, and a sticky box as tall as its
    // container has nowhere to travel — the rail stayed at the top of the
    // column and scrolled away with it.
    <nav
      aria-label={t("settings.nav.label")}
      className="sticky top-6 hidden w-44 shrink-0 self-start flex-col gap-0.5 lg:flex"
    >
      {sections.map((section) => {
        const count = counts[section.id];
        // A section the filter has emptied is not somewhere to navigate to.
        if (count === 0) return null;
        return (
          <a
            key={section.id}
            href={`#settings-${section.id}`}
            aria-current={active === section.id ? "true" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors",
              "hover:bg-accent hover:text-foreground",
              active === section.id && "bg-accent font-medium text-foreground shadow-[inset_2px_0_0_var(--primary)]",
            )}
            onClick={(event) => {
              // Handled here rather than left to the hash: the router owns the
              // hash (`#/settings`), so a `#settings-engine` navigation would
              // take the operator off the page it is meant to scroll.
              event.preventDefault();
              document.getElementById(`settings-${section.id}`)?.scrollIntoView({ block: "start" });
            }}
          >
            {t(section.labelKey)}
            {count !== undefined && <span className="ml-auto font-mono text-[11px] tabular-nums">{count}</span>}
          </a>
        );
      })}

      {/* The one sentence that governs every control on the page, moved out of
          the column and into the rail: it answers "will this restart anything"
          once, where it stays in view for the whole scroll, instead of sitting
          above the first section and scrolling away from the forty rows it
          actually describes. */}
      <p className="mt-3 rounded-lg border border-primary/25 bg-primary/8 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        <span className="mb-1 block font-medium text-primary">{t("settings.applied-live")}</span>
        {t("settings.subtitle")}
      </p>
    </nav>
  );
}
