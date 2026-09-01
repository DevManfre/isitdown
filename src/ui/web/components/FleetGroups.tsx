import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible.tsx";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { ProviderRow } from "@/components/FleetRows.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { statusColor, statusLabelKey } from "@/lib/chartConfig.ts";
import { stagger } from "@/lib/stagger.ts";
import type { HistoryBucket, ProviderStatus } from "@/lib/types.ts";
import { cn } from "@/lib/utils.ts";

function GroupHeader({
  label, count, tone, open,
}: {
  label: string;
  count: number;
  tone: "alarm" | "ok";
  open: boolean;
}) {
  const { i18n } = useTranslation();

  return (
    <CollapsibleTrigger className="flex w-full items-center gap-2 text-left">
      {/* One glyph rotated, not two swapped: Radix already owns the state, and
          a second icon is a second thing that can disagree with it. */}
      <ChevronRight
        className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")}
      />
      <span className={cn("text-[13px] font-medium", tone === "ok" && "text-muted-foreground")}>
        {label}
      </span>
      <Badge
        variant="outline"
        className={cn(
          "font-mono",
          tone === "alarm"
            ? "border-destructive/40 bg-destructive/12 text-destructive"
            : "border-status-operational/35 bg-status-operational/10 text-status-operational",
        )}
      >
        <NumberTicker locale={i18n.language} value={count} />
      </Badge>
    </CollapsibleTrigger>
  );
}

/**
 * The operational fleet while its group is shut: one dot per provider, with the
 * detail on hover.
 *
 * A hover card is pointer-only by nature, so this is deliberately a redundant
 * affordance — the group's own trigger expands to the full rows, and that is
 * the keyboard and screen-reader path to the same facts.
 */
function DotStrip({ providers }: { providers: ProviderStatus[] }) {
  const { t, i18n } = useTranslation();

  return (
    <div className="fleet-dots anim-fade flex flex-wrap items-center gap-1.5 pt-2.5">
      {providers.map((provider) => (
        <HoverCard key={provider.id} openDelay={120} closeDelay={60}>
          <HoverCardTrigger asChild>
            <span className="cursor-default">
              <StatusDot status={provider.overallStatus} size={10} />
            </span>
          </HoverCardTrigger>
          <HoverCardContent className="flex w-auto flex-col gap-1 p-3">
            <span className="text-sm">{provider.name}</span>
            <span className="font-mono text-[11px] text-muted-foreground">
              <Trans
                i18nKey="overview.uptime-window"
                values={{ uptime: provider.uptime90 }}
                components={[
                  <NumberTicker locale={i18n.language} value={provider.uptime90} decimalPlaces={2} suffix="%" />,
                ]}
              />
            </span>
            <span
              className="font-mono text-[11px]"
              style={{ color: statusColor(provider.overallStatus) }}
            >
              {t(statusLabelKey(provider.overallStatus)).toUpperCase()}
            </span>
          </HoverCardContent>
        </HoverCard>
      ))}
      <span className="pl-1.5 font-mono text-[11px] text-muted-foreground">
        {t("overview.dots-hint")}
      </span>
    </div>
  );
}

/**
 * The fleet grouped by severity — the `dense` shape.
 *
 * What is wrong is open and drawn in full; what is fine is shut and reduced to
 * a strip of dots. That is what keeps the list a fixed few hundred pixels
 * however large the fleet gets, and it puts the providers an operator actually
 * has to act on at the top instead of alphabetically among fifty healthy ones.
 */
export function FleetGroups({
  providers, buckets,
}: {
  providers: ProviderStatus[];
  buckets: Map<string, HistoryBucket[]>;
}) {
  const { t } = useTranslation();
  const [openProblems, setOpenProblems] = useState(true);
  const [openHealthy, setOpenHealthy] = useState(false);

  const problems = providers.filter((provider) => provider.overallStatus !== "operational");
  const healthy = providers.filter((provider) => provider.overallStatus === "operational");

  return (
    <div className="fleet-groups flex flex-col gap-5">
      {problems.length > 0 && (
        <Collapsible open={openProblems} onOpenChange={setOpenProblems}>
          <GroupHeader
            label={t("overview.group.problems")}
            count={problems.length}
            tone="alarm"
            open={openProblems}
          />
          <CollapsibleContent>
            <div className="anim-unfold pt-2.5">
              <div className="flex flex-col gap-2">
                {problems.map((provider, index) => (
                  <ProviderRow
                    key={provider.id}
                    provider={provider}
                    buckets={buckets.get(provider.id) ?? []}
                    delay={stagger(index, { step: 32, cap: 340 })}
                  />
                ))}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <Collapsible open={openHealthy} onOpenChange={setOpenHealthy}>
        <GroupHeader
          label={t("overview.group.operational")}
          count={healthy.length}
          tone="ok"
          open={openHealthy}
        />
        <CollapsibleContent>
          <div className="anim-unfold pt-2.5">
            <div className="flex flex-col gap-2">
              {healthy.map((provider, index) => (
                <ProviderRow
                  key={provider.id}
                  provider={provider}
                  buckets={buckets.get(provider.id) ?? []}
                  delay={stagger(index, { step: 26, cap: 340 })}
                />
              ))}
            </div>
          </div>
        </CollapsibleContent>
        {!openHealthy && <DotStrip providers={healthy} />}
      </Collapsible>
    </div>
  );
}
