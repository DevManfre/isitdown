import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { SettingRow } from "@/components/SettingRow.tsx";
import { useCatalogProposals, useServiceMutations } from "@/hooks/queries.ts";
import { formatRelative, hostOf } from "@/lib/format.ts";
import type { CatalogFeedStatus } from "@/lib/types.ts";

/**
 * Opt-in signed catalog updates — roadmap 2.2. The update check's row shape:
 * the switch is the whole form, the disclosure is always on screen, and the
 * last result sits beside it.
 *
 * Below it, only when there are any, the providers whose catalog entry moved —
 * "GitHub changed its status page's url: update?". Accepting one is the same
 * `PATCH` an edit by hand is; turning one down remembers that exact value, so
 * the row stays quiet until the catalog moves again.
 */
export function CatalogUpdatesRow({
  status,
  onToggle,
}: {
  status: CatalogFeedStatus | undefined;
  onToggle: (enabled: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const enabled = status?.enabled ?? false;
  const { query, dismiss } = useCatalogProposals(enabled);
  const { patch } = useServiceMutations();
  const proposals = enabled ? (query.data?.proposals ?? []) : [];

  const summary =
    !enabled || status === undefined || status.status === "unknown"
      ? undefined
      : status.status === "failed"
        ? t("settings.catalog-feed.status.failed")
        : t("settings.catalog-feed.status.ok", {
            count: status.entries,
            time: status.checkedAt === null ? "" : formatRelative(i18n.language, status.checkedAt),
          });

  return (
    <>
      <SettingRow
        label={
          <span className="inline-flex items-center gap-2">
            {t("field.catalog-feed")}
            {proposals.length > 0 && (
              <Badge variant="muted">{t("settings.catalog-feed.badge", { count: proposals.length })}</Badge>
            )}
          </span>
        }
        description={t("field.catalog-feed.hint")}
        status={summary === undefined ? undefined : <span className="text-muted-foreground">{summary}</span>}
        align="top"
      >
        <Switch
          id="catalog-feed"
          aria-label={t("field.catalog-feed")}
          checked={enabled}
          onCheckedChange={onToggle}
        />
      </SettingRow>

      {proposals.map((proposal) => (
        <SettingRow
          key={proposal.serviceId}
          label={t("settings.catalog-feed.proposal", { name: proposal.name })}
          description={
            <span className="font-mono text-xs">
              {proposal.from.adapter === proposal.to.adapter
                ? `${hostOf(proposal.from.baseUrl)} → ${hostOf(proposal.to.baseUrl)}`
                : `${proposal.from.adapter} ${hostOf(proposal.from.baseUrl)} → ${proposal.to.adapter} ${hostOf(proposal.to.baseUrl)}`}
            </span>
          }
          align="top"
        >
          <Button
            type="button"
            size="sm"
            disabled={patch.isPending}
            onClick={() =>
              patch.mutate({ id: proposal.serviceId, patch: { adapter: proposal.to.adapter, baseUrl: proposal.to.baseUrl } })
            }
          >
            {t("settings.catalog-feed.apply")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={dismiss.isPending}
            onClick={() => dismiss.mutate(proposal.serviceId)}
          >
            {t("settings.catalog-feed.dismiss")}
          </Button>
        </SettingRow>
      ))}
    </>
  );
}
