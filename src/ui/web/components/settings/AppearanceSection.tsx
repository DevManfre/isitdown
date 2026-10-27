import { useTranslation } from "react-i18next";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { SettingRow } from "@/components/SettingRow.tsx";
import { SettingsSection } from "@/components/SettingsSection.tsx";
import { Button } from "@/components/ui/button.tsx";
import { startGuidedTour } from "@/components/GuidedTour.tsx";
import { InstallAppRow } from "@/components/settings/InstallAppRow.tsx";
import { SECTION_REELS } from "@/components/settings/reels.ts";
import { SECTION_CASCADE } from "@/components/settings/sectionCascade.ts";
import { useSettingsReceipt } from "@/components/settings/useSettingsReceipt.ts";
import { usePreferencesMutation } from "@/hooks/queries.ts";
import { localeName, supportedLocales, switchLocale } from "@/lib/i18n.ts";
import { effectiveTimeZone, setTimeZone, TIME_ZONES } from "@/lib/timeZone.ts";
import { stagger } from "@/lib/stagger.ts";
import type { MapView, Preferences } from "@/lib/types.ts";

/**
 * `preferences` is read by the view, not here: its query starts with the page
 * rather than when this section mounts, so a stored choice is already in the
 * control the first time the section paints.
 */
export function AppearanceSection({
  preferences,
}: {
  preferences: Preferences | undefined;
}) {
  const { t, i18n } = useTranslation();
  const patchPreferences = usePreferencesMutation();
  const receipt = useSettingsReceipt();
  return (
    <SettingsSection
      id="appearance"
      title={t("settings.section.appearance")}
      reel={SECTION_REELS.appearance}
      className="lg:col-span-3"
      delay={stagger(5, SECTION_CASCADE)}
    >
      {/* Language leads the section: it decides the words every other row on
      this page is read in, so it belongs above them rather than after.
      It used to sit in the header as six code pills; six is where that
      stopped being a glance and started being a row of chrome. */}
      <SettingRow
        label={t("settings.language.label")}
        description={t("settings.language.hint")}
        align="top"
      >
        <Select
          value={i18n.language}
          onValueChange={(value) => {
            // Applied here as well as stored, like the time zone beside it:
            // `switchLocale` is what actually changes the language, and the
            // mutation only remembers the choice for the next browser.
            void switchLocale(value).then((applied) =>
              patchPreferences.mutate(
                { uiLocale: applied },
                receipt("appearance"),
              ),
            );
          }}
        >
          <SelectTrigger
            id="ui-locale"
            className="w-56"
            aria-label={t("settings.language.label")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {supportedLocales.map((locale) => (
              <SelectItem key={locale} value={locale}>
                {localeName(locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow
        label={t("settings.timezone.label")}
        description={t("settings.timezone.hint", {
          zone: effectiveTimeZone(),
        })}
        align="top"
      >
        <Select
          value={preferences?.timeZone ?? "auto"}
          onValueChange={(value) => {
            // Applied here as well as stored: the mutation only writes the
            // preference back, and the formatters read the module value.
            setTimeZone(value);
            patchPreferences.mutate(
              { timeZone: value },
              receipt("appearance"),
            );
          }}
        >
          <SelectTrigger
            id="time-zone"
            className="w-56"
            aria-label={t("settings.timezone.label")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">
              {t("settings.timezone.auto")}
            </SelectItem>
            {TIME_ZONES.map((zone) => (
              <SelectItem key={zone} value={zone}>
                {zone === "UTC"
                  ? t("settings.timezone.utc")
                  : zone.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow
        label={t("settings.map-view.label")}
        description={t("settings.map-view.hint")}
        align="top"
      >
        <Select
          value={preferences?.mapView ?? "off"}
          onValueChange={(value) =>
            patchPreferences.mutate(
              { mapView: value as MapView },
              receipt("appearance"),
            )
          }
        >
          <SelectTrigger
            id="map-view"
            className="w-42"
            aria-label={t("settings.map-view.label")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="off">
              {t("settings.map-view.off")}
            </SelectItem>
            <SelectItem value="map">
              {t("settings.map-view.map")}
            </SelectItem>
            <SelectItem value="globe">
              {t("settings.map-view.globe")}
            </SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
      {/* Roadmap 5.21. Last in Appearance: it is about the window the
      dashboard lives in rather than about what is drawn inside it. */}
      <InstallAppRow />
      {/* Roadmap 4.6 */}
      <SettingRow label={t("tour.setting.label")} description={t("tour.setting.hint")}>
        <Button type="button" variant="outline" size="sm" onClick={startGuidedTour}>
          {t("tour.setting.action")}
        </Button>
      </SettingRow>
    </SettingsSection>
  );
}
