import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ChevronRight } from "lucide-react";
import { SETTINGS_CATEGORIES, type SettingsCategory } from "@/components/settings/sectionIndex.ts";

/**
 * The front of Settings: one row per category, each opening its own route.
 *
 * Forty rows on one scrolling page meant every visit started by scrolling past
 * the thirty-nine that were not the reason for the visit. The list answers
 * "where does this live" in one look instead, and the rows are a click away on
 * a page that holds only them.
 *
 * The search field above the grid is the other half of that: it reads the row
 * index (`sectionIndex.ts`) rather than the page, so typing still finds a
 * single setting by name and says which tile it is behind.
 */

/** Accent-insensitive, like the row filter's own fold. */
const fold = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

function CategoryRow({ category, count }: { category: SettingsCategory; count?: number }) {
  const { t } = useTranslation();
  return (
    // The whole row is the link: one target, and its accessible name is the
    // category, not "open" said seven times.
    <Link
      to={`/settings/${category.id}`}
      className="settings-category group flex min-h-16 items-center gap-4 px-5 py-4 transition-colors duration-(--duration-fast) hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.03] focus-visible:outline-none"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2 text-sm font-medium">
          {t(category.labelKey)}
          {count !== undefined && <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>}
        </span>
        <span className="text-sm text-muted-foreground">{t(category.blurbKey)}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
  );
}

export function SettingsLauncher({
  categories,
  query,
  counts,
}: {
  categories: SettingsCategory[];
  /** The page's filter, so typing can answer with rows rather than tiles. */
  query: string;
  /** A live figure a category can show on its tile — services watched, say. */
  counts: Record<string, number>;
}) {
  const { t } = useTranslation();
  const needle = fold(query.trim());

  if (needle !== "") {
    const hits = SETTINGS_CATEGORIES.filter((category) => categories.includes(category)).flatMap((category) =>
      category.rowKeys
        .filter((key) => fold(t(key)).includes(needle))
        .map((key) => ({ key, category })),
    );

    return (
      <section
        className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
        aria-label={t("settings.launcher.results")}
      >
        {hits.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">{t("settings.filter.empty", { query: query.trim() })}</p>
        ) : (
          hits.map(({ key, category }) => (
            <Link
              key={`${category.id}-${key}`}
              to={`/settings/${category.id}`}
              className="flex min-h-12 items-center justify-between gap-4 px-5 py-3 text-sm transition-colors duration-(--duration-fast) hover:bg-foreground/[0.03]"
            >
              <span>{t(key)}</span>
              <span className="text-xs text-muted-foreground">
                {t("settings.launcher.in-section", { section: t(category.labelKey) })}
              </span>
            </Link>
          ))
        )}
      </section>
    );
  }

  return (
    /* One divided list (dashboard-design-direction): a category is a name and
       one line of what it holds. The illustrated tiles it replaces painted a
       looping animation behind every one of them. */
    <nav
      aria-label={t("settings.nav.label")}
      className="anim-rise flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
    >
      {categories.map((category) => (
        <CategoryRow
          key={category.id}
          category={category}
          {...(counts[category.id] === undefined ? {} : { count: counts[category.id] })}
        />
      ))}
    </nav>
  );
}
