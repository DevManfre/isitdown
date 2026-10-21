import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { ArrowLeft } from "lucide-react";
import { AppearanceSection } from "@/components/settings/AppearanceSection.tsx";
import { SettingsLauncher } from "@/components/settings/SettingsLauncher.tsx";
import {
  openCategory,
  SETTINGS_CATEGORIES,
} from "@/components/settings/sectionIndex.ts";
import { DeliverySection } from "@/components/settings/DeliverySection.tsx";
import { DELIVERY_OFF } from "@/components/settings/deliveryDefaults.ts";
import { NotificationsSection } from "@/components/settings/NotificationsSection.tsx";
import { ServicesSection } from "@/components/settings/ServicesSection.tsx";
import { RemovedSection } from "@/components/settings/RemovedSection.tsx";
import { EngineSection } from "@/components/settings/EngineSection.tsx";
import { DataSection } from "@/components/settings/DataSection.tsx";
import {
  SettingsChromeProvider,
  SettingsToolbar,
  useSettingsChrome,
} from "@/components/settings/SettingsChrome.tsx";
import { SettingsNav } from "@/components/settings/SettingsNav.tsx";
import {
  SettingsToastsProvider,
} from "@/components/settings/SettingsToasts.tsx";
import {
  useConfig,
  usePreferences,
  useStorage,
} from "@/hooks/queries.ts";

/**
 * Settings as one column of named sections — engine, monitored services,
 * notification channels, appearance — each its own card of divided rows.
 * Port of src/ui/public/js/views/settings.js.
 *
 * A secret can be typed here but never read back: a channel field is one box
 * for the credential, and a save sends it one way — to the secrets file beside
 * the database and into the server's environment, so the channel works without
 * a restart. The value never appears again, because no route sends one. Which
 * environment variable carries it is behind the row's own toggle, along with
 * whether that variable currently resolves.
 */
function SettingsView() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { query, counts } = useSettingsChrome();
  const { data: config } = useConfig();
  const { data: preferences } = usePreferences();
  const { data: storage } = useStorage();

  if (config === undefined) return null;

  // Defaulted rather than assumed: the section only exists when a removal is
  // waiting, and an older payload carries no list at all.
  const removed = config.removed ?? [];
  const delivery = config.delivery ?? DELIVERY_OFF;

  // The launcher grid, or one category's rows. The category comes from the URL
  // rather than component state, so a category is a place: it can be linked to,
  // reloaded, and left with the browser's own back button.
  const open = openCategory(pathname);
  const categories = SETTINGS_CATEGORIES.filter(
    // "Recently removed" is a category only while something is restorable.
    (category) => category.id !== "removed" || removed.length > 0,
  );

  return (
    // Not centred as a pair: the rail belongs against the view's own left
    // edge, under the page title, rather than floating in the gutter between
    // the sidebar and a centred column.
    <div className="flex w-full gap-10">
      {open !== undefined && (
        <SettingsNav categories={categories} active={open} />
      )}

      {/* The rows read as prose, so they stay capped at a comfortable
          measure; the launcher grid is tiles, not prose, and takes the
          whole width it is given. */}
      <div
        className={`flex min-w-0 flex-1 flex-col gap-8 ${open === undefined ? "" : "max-w-5xl"}`}
      >
        {/* The subtitle moved into the rail (SettingsNav), where it stays in view
          for the whole page rather than scrolling off above the first section.
          Below the `lg` breakpoint the rail is hidden, so it is said here
          instead — the sentence is never absent, only ever in one place. */}
        <div className="flex flex-col gap-3">
          <span className="text-xs leading-relaxed text-muted-foreground lg:hidden">
            {t("settings.subtitle")}
          </span>
          {open === undefined ? (
            <SettingsToolbar density={false} />
          ) : (
            <div className="flex flex-col gap-3">
              <Link
                to="/settings"
                className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                {t("settings.back")}
              </Link>
              <SettingsToolbar />
            </div>
          )}
        </div>

        {open === undefined && (
          <SettingsLauncher
            categories={categories}
            query={query}
            counts={{ services: config.services.length }}
          />
        )}

        {open === "engine" && <EngineSection config={config} />}

        {open === "services" && (
          <ServicesSection
            services={config.services}
            removedCount={removed.length}
          />
        )}

        {/* Only while something is restorable: an empty "recently removed" card
          would be permanent chrome for a state that is normally absent — and
          the launcher drops its tile for the same reason. */}
        {open === "removed" && removed.length > 0 && (
          <RemovedSection removed={removed} />
        )}

        {open === "notifications" && (
          <NotificationsSection
            config={config}
            quietHours={delivery.quietHours}
          />
        )}

        {open === "delivery" && (
          <DeliverySection config={config} delivery={delivery} />
        )}

        {open === "data" && <DataSection config={config} storage={storage} />}

        {open === "appearance" && <AppearanceSection preferences={preferences} />}

        {/* The filter can empty the category being read, and the launcher says so
          itself — this is the same sentence for the one open category. */}
        {open !== undefined &&
          query.trim() !== "" &&
          (counts[open] ?? 0) === 0 && (
            <p className="px-1 text-sm text-muted-foreground">
              {t("settings.filter.empty", { query: query.trim() })}
            </p>
          )}
      </div>
    </div>
  );
}

/**
 * The page, with the filter, the density switch and the section rail wrapped
 * around it — they are one piece of chrome shared by every section, and the
 * provider is what lets a row decide its own visibility without the query being
 * threaded through seven sections to reach it.
 */
export function Settings() {
  return (
    <SettingsToastsProvider>
      <SettingsChromeProvider>
        <SettingsView />
      </SettingsChromeProvider>
    </SettingsToastsProvider>
  );
}
