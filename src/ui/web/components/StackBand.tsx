import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { statusColor, statusLabelKey } from "@/lib/chartConfig.ts";
import type { ProviderGroupStatus, ProviderStatus } from "@/lib/types.ts";

/**
 * "My stack" — one tile per provider group, in the group's derived status
 * (roadmap 2.6).
 *
 * The fleet below this is a flat list, which answers "is GitHub healthy" and
 * never "is my deploy path healthy". A group is the second question, and its
 * status is the server's own derivation (`/status`'s `groups`) — never
 * recomputed here, so the tile and the rows under it cannot disagree.
 *
 * Renders nothing at all while no provider is grouped: an empty band on a
 * dashboard nobody has grouped yet would be a promise, not a feature.
 */
export function StackBand({
  groups, providers,
}: {
  groups: ProviderGroupStatus[];
  providers: ProviderStatus[];
}) {
  const { t } = useTranslation();
  if (groups.length === 0) return null;

  const nameOf = (id: string): string => providers.find((provider) => provider.id === id)?.name ?? id;

  return (
    <section aria-label={t("stack.title")} className="flex flex-col gap-2">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">{t("stack.title")}</span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((group) => (
          <Card key={group.id} className="anim-rise flex flex-col gap-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium">
                <StatusDot status={group.status} size={10} label={t(statusLabelKey(group.status))} />
                {group.id}
              </span>
              <span className="font-mono text-[11px] uppercase" style={{ color: statusColor(group.status) }}>
                {t(statusLabelKey(group.status))}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {/* What the composite is made of, named: a group that reads
                  "partial outage" is only actionable once it says which member
                  is the one having the bad day. */}
              {group.affected.length === 0
                ? t("stack.all-well", { count: group.providers.length })
                : t("stack.affected", {
                    count: group.affected.length,
                    names: group.affected.map(nameOf).join(", "),
                    total: group.providers.length,
                  })}
            </span>
          </Card>
        ))}
      </div>
    </section>
  );
}
