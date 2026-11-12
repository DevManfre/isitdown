import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { useAiSettings, useIncidentSummary } from "@/hooks/queries.ts";

/**
 * The provider's updates in one or two sentences — roadmap 6.10.
 *
 * Absent while AI is off (or the server predates it): an offer of something
 * that cannot work is chrome on every incident page, and Settings is where the
 * feature is switched on. Written only when the button is pressed, because it
 * spends the operator's tokens, and kept only in memory, because the provider
 * may post another update a minute later.
 *
 * The four states: idle (the button and what it does), writing (skeleton
 * lines, announced), failed (the server's own reason, and the button again),
 * written (the text, who wrote it, and from how much).
 */
export function IncidentSummaryBlock({ providerId, incidentId }: { providerId: string; incidentId: string }) {
  const { t, i18n } = useTranslation();
  const { data: ai } = useAiSettings();
  const summary = useIncidentSummary(providerId, incidentId);

  if (ai === undefined || ai.provider === "off") return null;

  const write = (): void => summary.mutate(i18n.language);

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-muted-foreground">{t("incident.summary.title")}</h3>
      {/* Always mounted, so a screen reader hears the change rather than a
          region that arrived with its words already in it. */}
      <span className="sr-only" role="status">
        {summary.isPending
          ? t("incident.summary.loading")
          : summary.isSuccess
            ? t("incident.summary.by", { model: summary.data.model, count: summary.data.updates })
            : ""}
      </span>

      {summary.isPending && (
        <div className="flex flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}

      {summary.isSuccess && (
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-relaxed">{summary.data.summary}</p>
          <p className="text-xs text-muted-foreground">
            {t("incident.summary.by", { model: summary.data.model, count: summary.data.updates })}
          </p>
        </div>
      )}

      {summary.isError && (
        <p role="alert" className="text-sm text-destructive">
          {summary.error instanceof Error ? summary.error.message : String(summary.error)}
        </p>
      )}

      {/* The caveat stays beside a written summary too: model text is where it matters. */}
      {(summary.isIdle || summary.isSuccess) && (
        <p className="text-sm text-muted-foreground">{t("incident.summary.hint")}</p>
      )}

      {!summary.isPending && (
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={write}>
          <Sparkles className="size-4" aria-hidden="true" />
          {summary.isSuccess
            ? t("incident.summary.again")
            : summary.isError
              ? t("action.retry")
              : t("incident.summary.action")}
        </Button>
      )}
    </section>
  );
}
