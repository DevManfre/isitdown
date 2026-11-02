import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingRow } from "@/components/SettingRow.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { statusLabelKey } from "@/lib/chartConfig.ts";
import { MIN_SEVERITIES, playAlert, useSoundPrefs, VOLUMES, writeSound, type MinSeverity } from "@/lib/sound.ts";
import { statusRank } from "@/lib/statusChanges.ts";

/**
 * The alert sound's three settings — roadmap 4.28: on or off, how loud, and the
 * mildest worsening that still makes a sound. Off by default.
 *
 * Kept in this browser (see `lib/sound.ts`), so unlike the rows around it a
 * change here has no mutation and no receipt to wait for: it is already true.
 * The two rows under the switch are still shown while it is off, dimmed by the
 * disabled controls rather than hidden, so the operator can see what turning it
 * on will do.
 */
export function SoundRows() {
  const { t } = useTranslation();
  const prefs = useSoundPrefs();
  // `null` before the test button is used, then whether the browser let it sound.
  const [tested, setTested] = useState<boolean | null>(null);

  return (
    <>
      <SettingRow label={t("settings.sound.label")} description={t("settings.sound.hint")} align="top">
        <Switch
          id="sound-enabled"
          aria-label={t("settings.sound.label")}
          checked={prefs.enabled}
          onCheckedChange={(enabled) => writeSound({ ...prefs, enabled })}
        />
      </SettingRow>
      <SettingRow label={t("settings.sound.volume")} status={tested === false ? t("settings.sound.blocked") : undefined}>
        <div className="flex items-center gap-2">
          <Select
            value={String(prefs.volume)}
            disabled={!prefs.enabled}
            onValueChange={(value) => writeSound({ ...prefs, volume: Number(value) })}
          >
            <SelectTrigger id="sound-volume" className="w-28" aria-label={t("settings.sound.volume")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VOLUMES.map((volume) => (
                <SelectItem key={volume} value={String(volume)}>
                  {`${volume}%`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!prefs.enabled}
            // The tone for the chosen severity, so what is set is what is heard.
            onClick={() => void playAlert(prefs, statusRank(prefs.minSeverity)).then(setTested)}
          >
            {t("settings.sound.test")}
          </Button>
        </div>
      </SettingRow>
      <SettingRow label={t("settings.sound.severity")} description={t("settings.sound.severity-hint")}>
        <Select
          value={prefs.minSeverity}
          disabled={!prefs.enabled}
          onValueChange={(minSeverity) => writeSound({ ...prefs, minSeverity: minSeverity as MinSeverity })}
        >
          <SelectTrigger id="sound-severity" className="w-48" aria-label={t("settings.sound.severity")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MIN_SEVERITIES.map((severity) => (
              <SelectItem key={severity} value={severity}>
                {t(statusLabelKey(severity))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
    </>
  );
}
