import { useTranslation } from "react-i18next";
import { useSettingsToastReport } from "@/components/settings/SettingsToasts.tsx";

/**
 * The receipt every plain write leaves, and the refusal when one fails. Every
 * instant-apply answer on the Settings page — receipt or refusal — leaves as a
 * card in the bottom-right stack rather than a line in the card that saved.
 */
export function useSettingsReceipt() {
  const { t } = useTranslation();
  const toast = useSettingsToastReport();
  return (kind: Parameters<typeof toast>[0], text?: string) => ({
    onSuccess: () =>
      toast(kind, { text: text ?? t("settings.saved"), tone: "ok" as const }),
    onError: (error: unknown) =>
      toast(kind, {
        text: t("toast.failed", {
          error: error instanceof Error ? error.message : String(error),
        }),
        tone: "error" as const,
      }),
  });
}
