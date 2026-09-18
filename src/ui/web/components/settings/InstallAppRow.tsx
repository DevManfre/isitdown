import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { SettingRow } from "@/components/SettingRow.tsx";
import { canInstall, isStandalone, onInstallabilityChange, promptInstall } from "@/lib/pwa.ts";

/**
 * "Install this app" — roadmap 5.21.
 *
 * Deliberately a row in Appearance rather than a banner over the dashboard. An
 * install prompt that interrupts is the thing every site does and everybody
 * dismisses, and the dashboard's first screen belongs to whether anything is on
 * fire. Somebody who wants the app on their phone will look in settings.
 *
 * Three states, and the third is the reason this is not one boolean:
 *
 * - **offered** — the browser fired `beforeinstallprompt`, so there is a button.
 * - **installed** — already running as the app, so the row says so and offers
 *   nothing.
 * - **unavailable** — Safari, Firefox, or Chrome that has not offered yet. The
 *   row still appears and explains how, because a row that vanishes on iOS
 *   reads as a feature that does not exist there, when in fact it does — it is
 *   Share → Add to Home Screen.
 */
export function InstallAppRow(): React.JSX.Element {
  const { t } = useTranslation();
  const offered = useSyncExternalStore(onInstallabilityChange, canInstall, () => false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    // `appinstalled` reaches the same listeners the installability store uses,
    // so re-reading here is what turns the button into the confirmation without
    // a reload.
    return onInstallabilityChange(() => setInstalled(isStandalone()));
  }, []);

  return (
    <SettingRow
      label={t("settings.install.label")}
      description={
        installed
          ? t("settings.install.installed")
          : offered
            ? t("settings.install.hint")
            : t("settings.install.manual")
      }
      align="top"
    >
      {installed ? (
        <span className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
          <Check className="size-4" aria-hidden />
          {t("settings.install.done")}
        </span>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={!offered}
          onClick={() => {
            void promptInstall();
          }}
        >
          <Download className="size-4" aria-hidden />
          {t("settings.install.action")}
        </Button>
      )}
    </SettingRow>
  );
}
