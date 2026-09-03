import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import type { DescribedChannel, RoutingResponse, RoutingRule } from "@/lib/types.ts";
// `explain` is core's own evaluator, imported rather than copied: a dry run
// computed from a second copy of the matching logic could disagree with what
// actually routes, and a preview that lies is worse than no preview. `@/`
// only maps `src/ui/web/*`, so this one import stays relative.
import { EVENT_CLASSES, SEVERITY_FLOORS, explain, type EventClass, type SeverityFloor } from "../../../core/routing.ts";
import type { StatusChange, StatusChangeKind } from "../../../core/types.ts";

/**
 * Which earlier rule, if any, makes this one unreachable: one above it that
 * matches everything it would. First-match-wins is invisible in a plain table,
 * and a rule that can never fire is exactly the kind of silent routing change
 * this panel exists to prevent.
 *
 * A different question from the dry run below (which rule wins for ONE event):
 * this asks whether a rule can EVER win, for any event, so it stays a
 * client-side computation over `SEVERITY_FLOORS` rather than a call to `explain`.
 */
function shadowedBy(rules: RoutingRule[], index: number): number | undefined {
  const rule = rules[index];
  if (rule === undefined) return undefined;

  for (let above = 0; above < index; above += 1) {
    const earlier = rules[above];
    if (earlier === undefined) continue;
    if (earlier.provider !== "*" && earlier.provider !== rule.provider) continue;
    if (!rule.classes.every((eventClass) => earlier.classes.includes(eventClass))) continue;
    if (SEVERITY_FLOORS.indexOf(earlier.minSeverity) > SEVERITY_FLOORS.indexOf(rule.minSeverity)) continue;
    return above;
  }
  return undefined;
}

/**
 * The four canned events the dry run picks from, as the `StatusChange` shape
 * `explain` takes. Fixed, not free text: the panel is teaching its evaluation
 * model with a worked example, not standing in for a real event feed.
 */
const DRYRUN_EVENTS: { id: string; change: Omit<StatusChange, "providerId" | "at"> }[] = [
  {
    id: "major-outage",
    change: { kind: "status_change", previousStatus: "operational", currentStatus: "major_outage" },
  },
  {
    id: "degraded",
    change: { kind: "status_change", previousStatus: "operational", currentStatus: "degraded" },
  },
  {
    id: "maintenance",
    change: { kind: "maintenance_started" as StatusChangeKind, currentStatus: "operational" },
  },
  {
    id: "monitoring",
    change: { kind: "monitoring_degraded" as StatusChangeKind, currentStatus: "unknown" },
  },
];

function DryRun({
  rules,
  channels,
  services,
}: {
  rules: RoutingRule[];
  channels: DescribedChannel[];
  services: { id: string; name: string }[];
}) {
  const { t } = useTranslation();
  const [providerId, setProviderId] = useState<string | undefined>(services[0]?.id);
  const [eventId, setEventId] = useState(DRYRUN_EVENTS[0]!.id);

  if (providerId === undefined) return null;

  const enabledChannelIds = channels.filter((channel) => channel.enabled).map((channel) => channel.id);
  const event = DRYRUN_EVENTS.find((candidate) => candidate.id === eventId) ?? DRYRUN_EVENTS[0]!;
  const change: StatusChange = { ...event.change, providerId, at: new Date().toISOString() };
  const result = explain(change, rules, enabledChannelIds);

  const won = result.winner === null ? undefined : rules[result.winner];
  let verdict: string;
  if (won === undefined) {
    verdict = t("routing.dryrun.none");
  } else if (won.channels.length === 0) {
    verdict = t("routing.dryrun.muted", { rule: result.winner! + 1 });
  } else {
    verdict = won.channels
      .flatMap((channel) => (channel === "*" ? enabledChannelIds : [channel]))
      .filter((id, at, all) => all.indexOf(id) === at)
      .map((id) => t(`channel.name.${id}`))
      .join(" · ");
  }

  return (
    <div className="flex flex-col gap-3 rounded-md bg-muted/40 p-3">
      <span className="text-xs uppercase tracking-widest text-muted-foreground">
        {t("routing.dryrun.title")}
      </span>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 shrink-0 font-mono text-[10px] text-muted-foreground">
            {t("routing.dryrun.provider")}
          </span>
          {services.map((service) => (
            <Button
              key={service.id}
              type="button"
              size="sm"
              variant={service.id === providerId ? "default" : "outline"}
              onClick={() => setProviderId(service.id)}
            >
              {service.name}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 shrink-0 font-mono text-[10px] text-muted-foreground">
            {t("routing.dryrun.event")}
          </span>
          {DRYRUN_EVENTS.map((candidate) => (
            <Button
              key={candidate.id}
              type="button"
              size="sm"
              variant={candidate.id === eventId ? "default" : "outline"}
              onClick={() => setEventId(candidate.id)}
            >
              {t(`routing.dryrun.event.${candidate.id}`)}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {rules.map((_, index) => {
          const outcome = result.outcomes[index];
          if (outcome === undefined) return null;
          const text =
            outcome.kind === "won"
              ? t("routing.dryrun.won")
              : outcome.kind === "unreached"
                ? t("routing.dryrun.unreached")
                : t(`routing.dryrun.skipped.${outcome.because}`);
          return (
            <div key={index} className="flex gap-2 text-sm">
              <span className="w-16 shrink-0 font-mono text-[10px] text-muted-foreground">
                {t("routing.dryrun.rule", { rule: index + 1 })}
              </span>
              <span className={outcome.kind === "won" ? "text-foreground" : "text-muted-foreground"}>
                {text}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2 text-sm">
        <span className="w-16 shrink-0 font-mono text-[10px] text-muted-foreground">
          {t("routing.dryrun.result")}
        </span>
        <span data-testid="routing-dryrun-verdict" className="font-medium">
          {verdict}
        </span>
      </div>
    </div>
  );
}

export function RoutingRules({
  routing,
  channels,
  services,
  onSave,
}: {
  routing: RoutingResponse;
  channels: DescribedChannel[];
  services: { id: string; name: string }[];
  onSave?: (rules: RoutingRule[]) => void | Promise<unknown>;
}) {
  const { t } = useTranslation();
  const rules = routing.rules;

  /** Every edit, add, delete and reorder saves the whole ordered list: per-row position writes can interleave. */
  const save = (next: RoutingRule[]) => void onSave?.(next);

  const patch = (index: number, changes: Partial<RoutingRule>) =>
    save(rules.map((rule, at) => (at === index ? { ...rule, ...changes } : rule)));

  const move = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= rules.length) return;
    const next = [...rules];
    const [moved] = next.splice(index, 1);
    if (moved !== undefined) next.splice(to, 0, moved);
    save(next);
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t("routing.note")}</p>

      {routing.invalidRules > 0 && (
        <p className="text-sm text-destructive">
          {t("routing.invalid", { count: routing.invalidRules })}
        </p>
      )}

      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("routing.empty")}</p>
      ) : (
        // A dedicated scroll container, not just BentoTile's own width: on a
        // narrow viewport the row (five columns, a four-item toggle-group, a
        // channel multi-select, three action buttons) is wider than any tile
        // can be, so this is what turns "clipped with no way to reach it"
        // into "scrolls within its own box" instead. `min-w-0` alongside it
        // matters as much as the `overflow-x-auto` itself: without it, this
        // flex/grid ancestry refuses to shrink below the table's natural
        // width and the grid track blows out past the viewport instead of
        // this container ever getting the chance to scroll.
        <div data-testid="routing-table-scroll" className="min-w-0 overflow-x-auto">
          {/* shadcn's Table defaults to w-full, which happily shrinks the
              table down to fit whatever width this wrapper offers instead
              of ever overflowing it — silently squeezing/clipping columns
              rather than letting overflow-x-auto do its job. min-w-max pins
              the table to its content's natural width so a narrow ancestor
              triggers a real horizontal scrollbar instead. */}
          <Table className="min-w-max">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">{t("routing.column.order")}</TableHead>
                <TableHead className="w-28">{t("routing.column.provider")}</TableHead>
                <TableHead>{t("routing.column.classes")}</TableHead>
                <TableHead className="w-40">{t("routing.column.severity")}</TableHead>
                <TableHead className="w-56">{t("routing.column.channels")}</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
          <TableBody>
            {rules.map((rule, index) => {
              const shadow = shadowedBy(rules, index);
              return (
                <TableRow key={index} className={shadow === undefined ? undefined : "opacity-60"}>
                  {/* Rendered, not merely visual: the operator has to be able to
                      say "rule 2" when reasoning about what shadows what. */}
                  <TableCell>{index + 1}</TableCell>

                  <TableCell>
                    <Select value={rule.provider} onValueChange={(provider) => patch(index, { provider })}>
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="*">{t("routing.provider.any")}</SelectItem>
                        {services.map((service) => (
                          <SelectItem key={service.id} value={service.id}>
                            {service.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>

                  <TableCell className="max-w-64 whitespace-normal">
                    {/* Same reasoning as the channels column below: four
                        event-class buttons read better wrapped over two
                        lines than forcing this column (and the whole row)
                        to the width of one unbroken line. */}
                    <ToggleGroup
                      type="multiple"
                      value={rule.classes}
                      onValueChange={(classes: string[]) => patch(index, { classes: classes as EventClass[] })}
                      className="flex-wrap"
                    >
                      {EVENT_CLASSES.map((eventClass) => (
                        <ToggleGroupItem key={eventClass} value={eventClass}>
                          {t(`routing.class.${eventClass}`)}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </TableCell>

                  <TableCell>
                    <Select
                      value={rule.minSeverity}
                      onValueChange={(minSeverity) =>
                        patch(index, { minSeverity: minSeverity as SeverityFloor })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SEVERITY_FLOORS.map((floor) => (
                          <SelectItem key={floor} value={floor}>
                            {t(`routing.severity.${floor}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>

                  <TableCell className="max-w-56 whitespace-normal">
                    {/* flex-wrap, not a wider column: five-plus channel
                        buttons plus the wildcard read better stacked over two
                        or three short lines than forcing this column (and so
                        the whole row) wider than the tile can ever be. */}
                    <ToggleGroup
                      type="multiple"
                      value={rule.channels}
                      onValueChange={(next: string[]) => patch(index, { channels: next })}
                      className="flex-wrap"
                    >
                      {/* The wildcard is an option rather than a computed state:
                          a rule that says "every channel" must keep meaning that
                          after a new channel ships. */}
                      <ToggleGroupItem value="*">{t("routing.channels.all")}</ToggleGroupItem>
                      {channels.map((channel) => (
                        <ToggleGroupItem key={channel.id} value={channel.id}>
                          {t(`channel.name.${channel.id}`)}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    {rule.channels.length === 0 && (
                      <Badge variant="secondary">{t("routing.channels.none")}</Badge>
                    )}
                  </TableCell>

                  <TableCell>
                    <div className="flex items-center gap-0.5">
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon-sm"
                        aria-label={t("routing.move-up")}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon-sm"
                        aria-label={t("routing.move-down")}
                        disabled={index === rules.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        ↓
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        aria-label={t("action.remove")}
                        onClick={() => save(rules.filter((_, at) => at !== index))}
                      >
                        {t("action.remove")}
                      </Button>
                    </div>
                    {/* Said in the row, not in a tooltip: a rule that can never
                        fire is the panel's most important warning, and a hover
                        target hides it from anyone who never hovers. */}
                    {shadow !== undefined && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("routing.shadowed", { rule: shadow + 1 })}
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          </Table>
        </div>
      )}

      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            save([...rules, { provider: "*", classes: [...EVENT_CLASSES], minSeverity: "any", channels: ["*"] }])
          }
        >
          {t("routing.add")}
        </Button>
      </div>

      {rules.length > 0 && <DryRun rules={rules} channels={channels} services={services} />}
    </div>
  );
}
