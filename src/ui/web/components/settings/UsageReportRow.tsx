import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ClipboardCopy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { SettingRow } from "@/components/SettingRow.tsx";
import { getUsageReport } from "@/lib/api.ts";
import { deprecatedUse, noteDeprecatedUse } from "@/lib/deprecatedUse.ts";
import { isStandalone } from "@/lib/pwa.ts";

const ISSUES = "https://github.com/devmanfre/isitdown/issues/new";

/**
 * The opt-in "what I use" report — roadmap 16.3. IsItDown has no telemetry, so
 * which surfaces are worth keeping is decided from reports operators choose to
 * share. Read from the server only when asked, with what only this browser
 * knows (the wallboard, the installed app) added on top.
 *
 * Copy is the whole action; the issue link opens GitHub with the same text
 * filled in, and the operator still reads it there before anything is posted.
 */
export function UsageReportRow() {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "pending" | "copied" | "failed">("idle");
  const [text, setText] = useState<string | null>(null);

  const build = async (): Promise<string> => {
    if (isStandalone()) noteDeprecatedUse("installed-app");
    const report = await getUsageReport();
    const browser = deprecatedUse();
    const merged = { ...report, deprecatedInUse: [...report.deprecatedInUse, ...browser].sort() };
    return `\`\`\`json\n${JSON.stringify(merged, null, 2)}\n\`\`\``;
  };

  const copy = async (): Promise<void> => {
    // A second copy starts clean: no stale "copied", no issue link carrying
    // the previous report if this one fails.
    setState("pending");
    setText(null);
    try {
      const built = await build();
      setText(built);
      await navigator.clipboard.writeText(built);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  const issueUrl =
    text === null
      ? undefined
      : `${ISSUES}?${new URLSearchParams({ title: t("settings.usage.issueTitle"), body: text }).toString()}`;

  return (
    <SettingRow
      label={t("settings.usage.label")}
      description={t("settings.usage.hint")}
      // The status slot survives compact density, which folds the hint away,
      // and stays mounted so a screen reader hears the text change.
      status={
        <span role="status">
          {state === "copied" ? t("settings.usage.copied") : state === "failed" ? t("settings.usage.failed") : ""}
        </span>
      }
      align="top"
    >
      <Button type="button" variant="outline" size="sm" disabled={state === "pending"} onClick={() => void copy()}>
        <ClipboardCopy className="size-4" aria-hidden />
        {t("settings.usage.copy")}
      </Button>
      {issueUrl !== undefined && (
        <Button asChild variant="outline" size="sm">
          <a href={issueUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" aria-hidden />
            {t("settings.usage.issue")}
            <span className="sr-only">{t("settings.usage.newTab")}</span>
          </a>
        </Button>
      )}
    </SettingRow>
  );
}
