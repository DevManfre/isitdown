import { useTranslation } from "react-i18next";
import { BellOff } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { useServiceMutations, useStatus } from "@/hooks/queries.ts";
import { useNow } from "@/hooks/useNow.ts";
import { formatDateTime, formatDuration } from "@/lib/format.ts";
import { isMuted } from "@/lib/mute.ts";
import { MINUTE } from "./shared.ts";
import { WidgetCard } from "./WidgetCard.tsx";

/**
 * Who will not tell you, and until when — widget 16. A muted provider still
 * records its incidents; it just sends nothing (roadmap 3.x mute). Lifting one
 * early is the same write the provider's own mute button makes.
 */
export function Muted() {
  const { t, i18n } = useTranslation();
  const now = useNow(MINUTE);
  const { data: status } = useStatus();
  const { patch } = useServiceMutations();
  const title = t("dashboard.widget.muted.title");
  if (status === undefined) return <WidgetCard title={title} busy />;

  const rows = status.providers
    .filter((p) => p.enabled && isMuted(p.mutedUntil, now))
    .sort((a, b) => Date.parse(a.mutedUntil!) - Date.parse(b.mutedUntil!));

  if (rows.length === 0) {
    return (
      <WidgetCard title={title} meta={t("widget.muted.none-meta")}>
        <p className="text-sm">{t("widget.muted.none")}</p>
        <p className="font-mono text-xs text-muted-foreground">{t("widget.muted.where")}</p>
      </WidgetCard>
    );
  }

  return (
    <WidgetCard
      title={title}
      meta={t("widget.count-providers", { count: rows.length })}
      conclusion={t("widget.muted.conclusion")}
      className="@container"
    >
      <ul className="flex flex-col">
        {rows.map((p) => (
          <li key={p.id} className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-border py-2 text-sm">
            <BellOff aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate font-medium">{p.name}</span>
            <span className="hidden text-muted-foreground @md:inline">
              {t("widget.muted.until", { when: formatDateTime(i18n.language, p.mutedUntil!) })}
            </span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {t("widget.muted.left", { time: formatDuration(i18n.language, (Date.parse(p.mutedUntil!) - now) / MINUTE) })}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={patch.isPending}
              aria-label={t("widget.muted.unmute-named", { provider: p.name })}
              onClick={() => patch.mutate({ id: p.id, patch: { mutedUntil: null } })}
            >
              {t("action.unmute")}
            </Button>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}
