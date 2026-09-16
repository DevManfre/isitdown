import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ArrowRight } from "lucide-react";
import { BentoCard, BentoGrid } from "@/components/ui/bento-grid.tsx";
import { SettingsReel } from "@/components/settings/SettingsReel.tsx";
import { SECTION_REELS } from "@/components/settings/reels.ts";
import { SETTINGS_CATEGORIES, type SettingsCategory } from "@/components/settings/sectionIndex.ts";
import { stagger } from "@/lib/stagger.ts";

/**
 * The front of Settings: one tile per category, each opening its own route.
 *
 * Forty rows on one scrolling page meant every visit started by scrolling past
 * the thirty-nine that were not the reason for the visit. The grid answers
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

function CategoryTile({ category, index, count }: { category: SettingsCategory; index: number; count?: number }) {
  const { t } = useTranslation();
  const painter = SECTION_REELS[category.id as keyof typeof SECTION_REELS];

  return (
    <BentoCard
      className="anim-rise focus-within:ring-2 focus-within:ring-ring"
      style={{ animationDelay: stagger(index) }}
      background={
        painter === undefined ? undefined : (
          <SettingsReel painter={painter} className="pointer-events-none absolute inset-x-0 top-0 h-32" />
        )
      }
    >
      {/* `pt-32` reserves the band's own height, so no word is ever laid over
          moving pixels and the copy keeps the card's own contrast. */}
      <div className="flex flex-1 flex-col gap-2 p-5 pt-32">
        <span className="text-xs uppercase tracking-widest text-primary">{t(category.labelKey)}</span>
        <p className="text-sm leading-relaxed text-muted-foreground">{t(category.blurbKey)}</p>
        <span className="mt-auto flex items-center gap-1.5 pt-3 text-sm font-medium">
          {/* The whole tile is the link: one target, and the accessible name is
              the category, not the word "open" repeated seven times. */}
          <Link to={`/settings/${category.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
            {t(category.labelKey)}
          </Link>
          {count !== undefined && <span className="font-mono text-xs text-muted-foreground">({count})</span>}
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
      </div>
    </BentoCard>
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
      <section className="flex flex-col gap-2" aria-label={t("settings.launcher.results")}>
        {hits.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">{t("settings.filter.empty", { query: query.trim() })}</p>
        ) : (
          hits.map(({ key, category }) => (
            <Link
              key={`${category.id}-${key}`}
              to={`/settings/${category.id}`}
              className="flex items-center justify-between gap-4 rounded-lg border bg-card px-4 py-3 text-sm transition-colors hover:bg-accent"
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
    /* Equal tiles that pack the row, rather than spans of four and three that
       left a two-column hole after "Notifications" and a lone tile at the
       foot. Three across on a wide screen is also the width at which the
       blurbs stop breaking every few words. */
    <BentoGrid className="items-stretch gap-5 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
      {categories.map((category, index) => (
        <CategoryTile
          key={category.id}
          category={category}
          index={index}
          {...(counts[category.id] === undefined ? {} : { count: counts[category.id] })}
        />
      ))}
    </BentoGrid>
  );
}
