import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { usePreferences } from "./queries.ts";
import { useTheme } from "./useTheme.tsx";
import { applyAccent, rememberIdentity } from "@/lib/accent.ts";

/** What this instance calls itself, and the mark it wears — roadmap 4.19. */
export interface InstanceIdentity {
  /** The operator's name for the instance, or the product's own. */
  name: string;
  /** Whether that name is the operator's rather than the product's. */
  custom: boolean;
  /** An image address, or null for the built-in mark. */
  logoUrl: string | null;
}

export function useInstanceIdentity(): InstanceIdentity {
  const { t } = useTranslation();
  const { data } = usePreferences();
  const customName = data?.instanceName?.trim() ?? "";
  return {
    name: customName === "" ? t("app.name") : customName,
    custom: customName !== "",
    logoUrl: data?.logoUrl ? data.logoUrl : null,
  };
}

/**
 * Applies the accent to the document. Mounted once, in the shell.
 *
 * The high-contrast theme keeps its own accent: its whole claim is that every
 * pair clears 7:1, which a colour picked by eye cannot promise, so there the
 * choice is remembered and simply not worn.
 */
export function useAccent(): void {
  const { data } = usePreferences();
  const { mode } = useTheme();
  const accent = data?.accentColor ?? null;
  useEffect(() => {
    // `null` is "the read has not answered": leave whatever the pre-paint
    // script stamped rather than flashing the default accent in between.
    if (accent === null) return;
    rememberIdentity({ accentColor: accent });
    applyAccent(mode === "contrast" ? "" : accent);
  }, [accent, mode]);
}
