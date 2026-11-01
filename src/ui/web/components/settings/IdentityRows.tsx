import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingRow } from "@/components/SettingRow.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { useSettingsReceipt } from "@/components/settings/useSettingsReceipt.ts";
import { usePreferencesMutation } from "@/hooks/queries.ts";
import { ACCENT_PATTERN, accentReadability, rgbToHex } from "@/lib/accent.ts";
import { tokenHex } from "@/lib/tokenRgb.ts";
import type { Preferences } from "@/lib/types.ts";

/** What a colour input shows when the live token cannot be read — black, the input's own default. */
const NO_SWATCH = rgbToHex([0, 0, 0]);

/** Mirrors the server's own limit, so the field stops where the API would refuse. */
const NAME_MAX = 40;

/**
 * Accent, name and logo — roadmap 4.19. Three rows because they are three
 * separate answers: an operator who only wants the name on the wallboard should
 * not have to pick a colour, and each one falls back on the product's own when
 * it is empty.
 *
 * The name and the logo address are text, so they are written when the field is
 * left rather than on every keystroke: a half-typed address is not a logo, and
 * a request per character is a request per refusal.
 */
export function IdentityRows({ preferences }: { preferences: Preferences | undefined }) {
  const { t } = useTranslation();
  const patch = usePreferencesMutation();
  const receipt = useSettingsReceipt();

  const storedAccent = preferences?.accentColor ?? "";
  const storedName = preferences?.instanceName ?? "";
  const storedLogo = preferences?.logoUrl ?? "";
  const [name, setName] = useState(storedName);
  const [logo, setLogo] = useState(storedLogo);
  const [logoRefused, setLogoRefused] = useState(false);
  // What the server holds replaces what is typed — a second browser's change, a
  // refusal that left the field showing something never saved.
  useEffect(() => setName(storedName), [storedName]);
  useEffect(() => setLogo(storedLogo), [storedLogo]);

  // The ground the accent will most often be read on, for the hint beside the
  // picker. Resolved from the live token, so it follows whichever theme is on.
  const ground = tokenHex("--color-bg");
  const ratio = storedAccent === "" || ground === null ? null : accentReadability(storedAccent, ground);

  return (
    <>
      <SettingRow
        label={t("settings.accent.label")}
        description={t("settings.accent.hint")}
        status={
          ratio !== null && ratio < 3 ? (
            <span role="status">{t("settings.accent.low-contrast", { ratio: ratio.toFixed(1) })}</span>
          ) : undefined
        }
        align="top"
      >
        <div className="flex items-center gap-2">
          <input
            id="accent-color"
            type="color"
            className="h-8 w-12 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
            aria-label={t("settings.accent.label")}
            value={ACCENT_PATTERN.test(storedAccent) ? storedAccent : (tokenHex("--color-accent") ?? NO_SWATCH)}
            onChange={(event) => patch.mutate({ accentColor: event.target.value }, receipt("appearance"))}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={storedAccent === ""}
            onClick={() => patch.mutate({ accentColor: "" }, receipt("appearance"))}
          >
            {t("settings.accent.reset")}
          </Button>
        </div>
      </SettingRow>

      <SettingRow label={t("settings.instance-name.label")} description={t("settings.instance-name.hint")} align="top">
        <Input
          id="instance-name"
          className="w-56"
          maxLength={NAME_MAX}
          value={name}
          placeholder={t("app.name")}
          aria-label={t("settings.instance-name.label")}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (name.trim() === storedName) return;
            patch.mutate({ instanceName: name.trim() }, receipt("appearance"));
          }}
        />
      </SettingRow>

      <SettingRow
        label={t("settings.logo.label")}
        description={t("settings.logo.hint")}
        status={logoRefused ? <span role="alert">{t("settings.logo.refused")}</span> : undefined}
        align="top"
      >
        <Input
          id="instance-logo"
          type="url"
          className="w-56"
          value={logo}
          placeholder={t("settings.logo.placeholder")}
          aria-label={t("settings.logo.label")}
          aria-invalid={logoRefused || undefined}
          onChange={(event) => {
            setLogo(event.target.value);
            setLogoRefused(false);
          }}
          onBlur={() => {
            const next = logo.trim();
            if (next === storedLogo) return;
            patch.mutate(
              { logoUrl: next },
              {
                ...receipt("appearance"),
                // The server's own refusal is the authority on what an address
                // may be; the field says so rather than reverting silently.
                onError: () => setLogoRefused(true),
              },
            );
          }}
        />
      </SettingRow>
    </>
  );
}
