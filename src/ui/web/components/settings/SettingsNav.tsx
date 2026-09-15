import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useSettingsChrome } from "@/components/settings/SettingsChrome.tsx";
import type { SettingsCategory } from "@/components/settings/sectionIndex.ts";
import { cn } from "@/lib/utils.ts";

/**
 * The rail beside an open Settings category: every other category one click
 * away, with the number of rows each still shows under the filter.
 *
 * It replaced a scroll-spy over one long column when the page became a
 * launcher. Same job — say where you are and what else there is — but the
 * targets are routes now, so the browser's own history carries them and a
 * category can be linked to.
 */
export function SettingsNav({ categories, active }: { categories: SettingsCategory[]; active: string }) {
  const { t } = useTranslation();
  const { counts } = useSettingsChrome();

  return (
    // `self-start` is what makes `sticky` do anything: a flex item stretches to
    // the row's full height by default, and a sticky box as tall as its
    // container has nowhere to travel.
    <nav
      aria-label={t("settings.nav.label")}
      className="sticky top-6 hidden w-44 shrink-0 self-start flex-col gap-0.5 lg:flex"
    >
      {categories.map((category) => {
        // Only the open category has rendered its rows, so only it has a count
        // to show; the others would report 0 and read as "empty", which they
        // are not.
        const count = category.id === active ? counts[category.id] : undefined;
        return (
          <Link
            key={category.id}
            to={`/settings/${category.id}`}
            aria-current={category.id === active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors",
              "hover:bg-accent hover:text-foreground",
              category.id === active && "bg-accent font-medium text-foreground shadow-[inset_2px_0_0_var(--primary)]",
            )}
          >
            {t(category.labelKey)}
            {count !== undefined && <span className="ml-auto font-mono text-[11px] tabular-nums">{count}</span>}
          </Link>
        );
      })}

      {/* The one sentence that governs every control on the page: it answers
          "will this restart anything" once, where it stays in view for the
          whole scroll. */}
      <p className="mt-3 rounded-lg border border-primary/25 bg-primary/8 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        <span className="mb-1 block font-medium text-primary">{t("settings.applied-live")}</span>
        {t("settings.subtitle")}
      </p>
    </nav>
  );
}
