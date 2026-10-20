import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { ServiceDialog } from "@/components/ServiceDialog.tsx";
import { SettingsSection } from "@/components/SettingsSection.tsx";
import { SECTION_REELS } from "@/components/settings/reels.ts";
import { SECTION_CASCADE } from "@/components/settings/sectionCascade.ts";
import { ServiceRow } from "@/components/settings/ServiceRow.tsx";
import { isMuted } from "@/lib/mute.ts";
import { stagger } from "@/lib/stagger.ts";
import type { ServiceDefinition } from "@/lib/types.ts";

/** Which providers the services card lists — the state, not the search. */
type ServiceFilter = "all" | "enabled" | "disabled" | "muted";

const SERVICE_FILTERS: {
  id: ServiceFilter;
  labelKey: string;
  of: (service: ServiceDefinition) => boolean;
}[] = [
  { id: "all", labelKey: "service.filter.all", of: () => true },
  {
    id: "enabled",
    labelKey: "service.filter.enabled",
    of: (service) => service.enabled,
  },
  {
    id: "disabled",
    labelKey: "service.filter.disabled",
    of: (service) => !service.enabled,
  },
  {
    id: "muted",
    labelKey: "service.filter.muted",
    of: (service) => isMuted(service.mutedUntil),
  },
];

export function ServicesSection({
  services,
  removedCount,
}: {
  services: ServiceDefinition[];
  removedCount: number;
}) {
  const { t } = useTranslation();
  // One provider's actions open at a time, same rule as the channel rows: every
  // row expanded is the layout this replaced.
  const [openService, setOpenService] = useState<string | undefined>(undefined);
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>("all");
  // The state chips filter the list; the search field above filters the rows
  // inside it. They compose — "muted" and "cloud" together is a fair question.
  const stateFilter = SERVICE_FILTERS.find(
    (entry) => entry.id === serviceFilter,
  );
  const shownServices =
    stateFilter === undefined
      ? services
      : services.filter(stateFilter.of);

  return (
    <SettingsSection
      id="services"
      reel={SECTION_REELS.services}
      // The services list gives up two columns to "Recently removed" only while
      // something is restorable; on its own it takes the whole row rather
      // than leaving a hole beside itself.
      className={removedCount > 0 ? "lg:col-span-4" : "lg:col-span-6"}
      title={t("settings.section.services")}
      action={
        <ServiceDialog
          mode="add"
          trigger={
            <Button type="button" size="sm">
              {t("action.add-service")}
            </Button>
          }
        />
      }
      delay={stagger(1, SECTION_CASCADE)}
    >
      {services.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          {t("providers.empty")}
        </p>
      ) : (
        <div className="flex flex-col">
          {/* The other half of what the filter field cannot answer: typing a
          name finds one provider, and this finds the ones whose state is
          the question — which of them am I currently hearing nothing
          from, and why. The counts are on the chips because "muted: 0"
          is itself the answer often enough. */}
          <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5">
            {SERVICE_FILTERS.map((filter) => (
              <Button
                key={filter.id}
                type="button"
                size="sm"
                variant={
                  serviceFilter === filter.id ? "secondary" : "ghost"
                }
                aria-pressed={serviceFilter === filter.id}
                className="h-7 rounded-full px-3 text-xs"
                onClick={() => setServiceFilter(filter.id)}
              >
                {t(filter.labelKey)}
                <span className="font-mono text-[11px] tabular-nums opacity-70">
                  {services.filter(filter.of).length}
                </span>
              </Button>
            ))}
          </div>
          <div className="flex flex-col divide-y divide-border border-t border-border">
            {shownServices.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                {t("service.filter.none")}
              </p>
            ) : (
              shownServices.map((service) => (
                <ServiceRow
                  key={service.id}
                  service={service}
                  open={openService === service.id}
                  onOpenChange={(next) =>
                    setOpenService(next ? service.id : undefined)
                  }
                />
              ))
            )}
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
