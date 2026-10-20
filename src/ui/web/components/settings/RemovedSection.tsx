import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { SettingRow } from "@/components/SettingRow.tsx";
import { SettingsSection } from "@/components/SettingsSection.tsx";
import { SECTION_REELS } from "@/components/settings/reels.ts";
import { SECTION_CASCADE } from "@/components/settings/sectionCascade.ts";
import { useSettingsReceipt } from "@/components/settings/useSettingsReceipt.ts";
import { useServiceMutations } from "@/hooks/queries.ts";
import { formatRelative, hostOf } from "@/lib/format.ts";
import { stagger } from "@/lib/stagger.ts";
import type { RemovedService } from "@/lib/types.ts";

export function RemovedSection({ removed }: { removed: RemovedService[] }) {
  const { t, i18n } = useTranslation();
  const { restore: serviceRestore, purge: servicePurge } =
    useServiceMutations();
  const receipt = useSettingsReceipt();
  return (
    <SettingsSection
      id="removed"
      reel={SECTION_REELS.removed}
      className="lg:col-span-2"
      title={t("settings.section.removed")}
      note={t("settings.removed-note")}
      delay={stagger(2, SECTION_CASCADE)}
    >
      {removed.map((service) => (
        <SettingRow
          key={service.id}
          className="service-row"
          label={service.name}
          description={`${service.adapter} · ${hostOf(service.baseUrl)}`}
          meta={t("providers.restore-until", {
            when: formatRelative(i18n.language, service.restoreUntil),
          })}
        >
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={serviceRestore.isPending}
            onClick={() =>
              serviceRestore.mutate(
                service.id,
                receipt(
                  "services",
                  t("toast.service.restored", { name: service.name }),
                ),
              )
            }
          >
            {t("action.restore")}
          </Button>
          {/* The destructive half: everything the removal's confirmation
            named goes now instead of when the window closes. */}
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={servicePurge.isPending}
            onClick={() =>
              servicePurge.mutate(
                service.id,
                receipt(
                  "services",
                  t("toast.service.purged", { name: service.name }),
                ),
              )
            }
          >
            {t("action.remove-now")}
          </Button>
        </SettingRow>
      ))}
    </SettingsSection>
  );
}
