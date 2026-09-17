import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangleIcon, ArrowDownIcon, ArrowUpIcon, Trash2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { cn } from "@/lib/utils.ts";
import type { DescribedChannel, QuietHoursPolicy, RoutingResponse, RoutingRule } from "@/lib/types.ts";
// `explain` is core's own evaluator, imported rather than copied: a dry run
// computed from a second copy of the matching logic could disagree with what
// actually routes, and a preview that lies is worse than no preview. `@/`
// only maps `src/ui/web/*`, so this one import stays relative.
import {
  COMPONENT_SEPARATOR,
  EVENT_CLASSES,
  GROUP_PREFIX,
  SEVERITY_FLOORS,
  componentTargetOf,
  explain,
  type EventClass,
  type SeverityFloor,
} from "../../../core/routing.ts";
import type { StatusChange, StatusChangeKind } from "../../../core/types.ts";

/**
 * Which earlier rule, if any, makes this one unreachable: one above it that
 * matches everything it would. First-match-wins is invisible in a plain list,
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
  // `[].every(...)` is vacuously true, which would otherwise claim any rule
  // above "shadows" a rule with no event classes selected — the wrong
  // reason. A rule with no classes can never win a match regardless of what
  // (if anything) is above it, so it is dead on its own, not shadowed; see
  // `hasNoClasses` for the warning that actually applies to it.
  if (rule.classes.length === 0) return undefined;

  for (let above = 0; above < index; above += 1) {
    const earlier = rules[above];
    if (earlier === undefined) continue;
    // A provider rule above a rule for one of that provider's components covers
    // everything the narrower one would (roadmap 2.9): the component change is
    // the provider's change too, so the earlier rule wins it first.
    const component = componentTargetOf(rule.provider);
    const coversComponent = component !== null && earlier.provider === component.providerId;
    if (earlier.provider !== "*" && earlier.provider !== rule.provider && !coversComponent) continue;
    if (!rule.classes.every((eventClass) => earlier.classes.includes(eventClass))) continue;
    if (SEVERITY_FLOORS.indexOf(earlier.minSeverity) > SEVERITY_FLOORS.indexOf(rule.minSeverity)) continue;
    return above;
  }
  return undefined;
}

/** A rule with no event classes selected matches no change, ever — dead regardless of position. */
function hasNoClasses(rule: RoutingRule): boolean {
  return rule.classes.length === 0;
}

/**
 * The four canned events the dry run picks from, as the `StatusChange` shape
 * `explain` takes. Fixed, not free text: the panel is teaching its evaluation
 * model with a worked example, not standing in for a real event feed.
 */
/** The groups a fleet declares, in the order a select should list them. */
const groupsOf = (services: { group?: string | null }[]): string[] =>
  [...new Set(services.map((service) => service.group).filter((group): group is string => typeof group === "string" && group !== ""))].sort();

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
  {
    id: "incident",
    change: {
      kind: "incident_opened" as StatusChangeKind,
      currentStatus: "partial_outage",
      incident: { id: "dryrun", name: "Dry run incident", impact: "minor", status: "investigating", updatedAt: new Date().toISOString() },
    },
  },
];

/** A provider as this panel needs it: enough to name it, group it and address its components. */
interface RoutedService {
  id: string;
  name: string;
  group?: string | null;
  /** The operator's selected components, which are the ones a rule can name. */
  components?: { id: string; name: string }[];
}

/**
 * The same canned event, rephrased as one component's transition (roadmap 2.9).
 * Only a status change has a component form — an incident or a maintenance
 * window belongs to the provider, and pretending otherwise here would preview a
 * change the diff engine never emits.
 */
function asComponentChange(
  change: Omit<StatusChange, "providerId" | "at">,
  component: { id: string; name: string },
): Omit<StatusChange, "providerId" | "at"> {
  if (change.kind !== "status_change") return change;
  return { ...change, kind: "component_status_change" as StatusChangeKind, component };
}

/**
 * One labelled line inside a rule card: the label in the same narrow column on
 * every line, the control taking the rest of the width. A card whose labels do
 * not line up reads as four unrelated controls rather than one rule.
 */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <span className="shrink-0 pt-1.5 text-xs font-medium text-muted-foreground sm:w-24 sm:text-right">
        {label}
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** A rule's own warning: why it can never fire, said in the card rather than on hover. */
function RuleWarning({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function DryRun({
  rules,
  channels,
  services,
  quietHours,
}: {
  rules: RoutingRule[];
  channels: DescribedChannel[];
  services: RoutedService[];
  /**
   * The window as it stands, so the dry run answers the question an operator
   * is actually asking — "would this reach me?" — rather than "would it, if it
   * were the middle of the afternoon". Optional: a server from before quiet
   * hours existed sends none, and the run then reads as it always did.
   */
  quietHours?: QuietHoursPolicy | undefined;
}) {
  const { t } = useTranslation();
  const [providerId, setProviderId] = useState<string | undefined>(services[0]?.id);
  const [eventId, setEventId] = useState(DRYRUN_EVENTS[0]!.id);
  /** Undefined is the provider as a whole; a component id previews that component's own transition. */
  const [componentId, setComponentId] = useState<string | undefined>(undefined);

  if (providerId === undefined) return null;

  const enabledChannelIds = channels.filter((channel) => channel.enabled).map((channel) => channel.id);
  const event = DRYRUN_EVENTS.find((candidate) => candidate.id === eventId) ?? DRYRUN_EVENTS[0]!;
  const picked = services.find((service) => service.id === providerId);
  const components = picked?.components ?? [];
  const component = components.find((candidate) => candidate.id === componentId);
  const change: StatusChange = {
    ...(component === undefined ? event.change : asComponentChange(event.change, component)),
    providerId,
    at: new Date().toISOString(),
  };
  // Core's own evaluator, and now with the same quiet-hours window the
  // dispatcher reads: a preview that ignored it would say "Telegram" for an
  // event that, at this hour, reaches nobody.
  // The picked provider's own group, so a `group:` rule wins the preview
  // exactly where it would win a real change (roadmap 2.6).
  const group = picked?.group ?? undefined;
  const result = explain(change, rules, enabledChannelIds, {
    ...(quietHours === undefined ? {} : { quietHours }),
    ...(group === null || group === undefined ? {} : { providerGroup: group }),
  });

  const won = result.winner === null ? undefined : rules[result.winner];
  // Delivery, not the rule's raw wildcard: `result.targets` is `explain`'s own
  // expansion (never a second copy of it — see the header comment), and it is
  // further intersected with the enabled channels here because the
  // dispatcher only ever sends through `ctx.notifiers`, which `buildNotifiers`
  // filters on `enabled`. A rule naming a disabled channel by id must render
  // as nobody receiving it, exactly like the server.
  const enabledSet = new Set(enabledChannelIds);
  const delivered = result.targets.filter((id) => enabledSet.has(id));
  let verdict: string;
  /** Whether the verdict is a delivery or one of the three ways nothing is sent. */
  let delivers = false;
  if (result.quieted) {
    // Checked first: a rule did win, so every other branch below would report
    // a delivery that quiet hours have already taken away.
    verdict = t("routing.dryrun.quiet");
  } else if (won === undefined) {
    verdict = t("routing.dryrun.none");
  } else if (won.channels.length === 0) {
    verdict = t("routing.dryrun.muted", { rule: result.winner! + 1 });
  } else if (delivered.length === 0) {
    verdict = t("routing.dryrun.nobody");
  } else {
    verdict = delivered.map((id) => t(`channel.name.${id}`)).join(" · ");
    delivers = true;
  }

  /** The picker rows are one control each: same chip size, same gap, same label column. */
  const chip = (selected: boolean) => ({ size: "xs" as const, variant: selected ? ("default" as const) : ("outline" as const) });

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
      <span className="text-xs font-medium tracking-wide text-muted-foreground">
        {t("routing.dryrun.title")}
      </span>

      <div className="flex flex-col gap-2">
        <Field label={t("routing.dryrun.provider")}>
          {services.map((service) => (
            <Button
              key={service.id}
              type="button"
              {...chip(service.id === providerId)}
              onClick={() => {
                setProviderId(service.id);
                // The component belonged to the provider that was picked before.
                setComponentId(undefined);
              }}
            >
              {service.name}
            </Button>
          ))}
        </Field>
        {/* Only for a provider with components selected: a rule can name one
            (roadmap 2.9), so the preview has to be able to ask about one. */}
        {components.length > 0 && (
          <Field label={t("routing.dryrun.component")}>
            <Button type="button" {...chip(component === undefined)} onClick={() => setComponentId(undefined)}>
              {t("routing.dryrun.component.whole")}
            </Button>
            {components.map((candidate) => (
              <Button
                key={candidate.id}
                type="button"
                {...chip(candidate.id === componentId)}
                onClick={() => setComponentId(candidate.id)}
              >
                {candidate.name}
              </Button>
            ))}
          </Field>
        )}
        <Field label={t("routing.dryrun.event")}>
          {DRYRUN_EVENTS.map((candidate) => (
            <Button
              key={candidate.id}
              type="button"
              {...chip(candidate.id === eventId)}
              onClick={() => setEventId(candidate.id)}
            >
              {t(`routing.dryrun.event.${candidate.id}`)}
            </Button>
          ))}
        </Field>
      </div>

      <div className="flex flex-col gap-0.5 border-t pt-2">
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
            <div key={index} className="flex gap-3 text-xs">
              <span className="w-16 shrink-0 text-right font-medium text-muted-foreground">
                {t("routing.dryrun.rule", { rule: index + 1 })}
              </span>
              <span className={outcome.kind === "won" ? "font-medium text-foreground" : "text-muted-foreground"}>
                {text}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex gap-3 border-t pt-2 text-sm">
        <span className="w-16 shrink-0 pt-0.5 text-right text-xs font-medium text-muted-foreground">
          {t("routing.dryrun.result")}
        </span>
        <span
          data-testid="routing-dryrun-verdict"
          className={cn("font-medium", delivers ? "text-foreground" : "text-muted-foreground")}
        >
          {verdict}
        </span>
      </div>

      {/* Said once, not per event: with a window configured, every verdict here
          is a verdict about this hour, whichever way it came out. */}
      {quietHours?.enabled === true && (
        <span className="text-xs text-muted-foreground">{t("routing.dryrun.quiet-note")}</span>
      )}
    </div>
  );
}

export function RoutingRules({
  routing,
  channels,
  services,
  quietHours,
  onSave,
  saving = false,
}: {
  routing: RoutingResponse;
  channels: DescribedChannel[];
  services: RoutedService[];
  /** Passed through to the dry run, which evaluates with it — see `DryRun`. */
  quietHours?: QuietHoursPolicy | undefined;
  onSave?: (rules: RoutingRule[]) => void | Promise<unknown>;
  /**
   * True between a click and the refetch that follows it. The panel is fully
   * controlled from server state and every edit rebuilds the whole list from
   * `rules`, which is stale for that whole window — a second click in it
   * would compute its patch from the state the first click already made
   * obsolete, and silently lose the first edit. Disabling the row's controls
   * for that window is the cheap mitigation; an optimistic update is the
   * real fix and a follow-up.
   */
  saving?: boolean;
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
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("routing.note")}</p>

      {routing.invalidRules > 0 && (
        <p className="text-sm text-destructive">
          {t("routing.invalid", { count: routing.invalidRules })}
        </p>
      )}

      {rules.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          {t("routing.empty")}
        </p>
      ) : (
        // A card per rule, not a table. The five columns a rule needs (order,
        // provider, four event toggles, a severity floor, a channel
        // multi-select and three actions) are wider than any dialog can be, so
        // the table spent its life in a horizontal scroll box with the
        // channels column parked off-screen — the single most consequential
        // column of the panel, invisible until you thought to scroll sideways.
        // Stacked cards wrap instead of scrolling, and the fields read top to
        // bottom in the order the evaluator reads them.
        <ul data-testid="routing-rules" className="flex flex-col gap-3">
          {rules.map((rule, index) => {
            const shadow = shadowedBy(rules, index);
            const deadNoClasses = hasNoClasses(rule);
            const dead = shadow !== undefined || deadNoClasses;
            return (
              <li
                key={index}
                data-testid="routing-rule"
                className={cn(
                  "flex flex-col gap-3 rounded-lg border bg-card p-3",
                  // Dead rules stay legible — they are the ones most in need
                  // of editing — but read as set aside: dashed, not faded to
                  // the point of being hard to fix.
                  dead && "border-dashed bg-muted/20",
                )}
              >
                <div className="flex items-center gap-2">
                  {/* Rendered, not merely visual: the operator has to be able
                      to say "rule 2" when reasoning about what shadows what. */}
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium tabular-nums">
                    {index + 1}
                  </span>

                  <Select
                    value={rule.provider}
                    disabled={saving}
                    onValueChange={(provider) => patch(index, { provider })}
                  >
                    {/* The card's one unlabelled control: the field rows below
                        carry their label, the provider sits in the header next
                        to the rule number, so its name is said to a screen
                        reader instead. */}
                    <SelectTrigger aria-label={t("routing.column.provider")} className="h-8 w-full max-w-72 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="*">{t("routing.provider.any")}</SelectItem>
                      {/* Groups above the providers (roadmap 2.6): a rule
                          that had to name four ids to cover one stack went
                          stale the moment the stack gained a fifth. */}
                      {groupsOf(services).map((group) => (
                        <SelectItem key={group} value={`${GROUP_PREFIX}${group}`}>
                          {t("routing.provider.group", { group })}
                        </SelectItem>
                      ))}
                      {services.flatMap((service) => [
                        <SelectItem key={service.id} value={service.id}>
                          {service.name}
                        </SelectItem>,
                        // One component of one provider (roadmap 2.9): the
                        // transition already carries the component's own
                        // severity, and this is how a rule says which one it
                        // wants. Only selected components are offered — those
                        // are the only ones a reading ever reports.
                        ...(service.components ?? []).map((component) => (
                          <SelectItem
                            key={`${service.id}${COMPONENT_SEPARATOR}${component.id}`}
                            value={`${service.id}${COMPONENT_SEPARATOR}${component.id}`}
                          >
                            {t("routing.provider.component", {
                              service: service.name,
                              component: component.name,
                            })}
                          </SelectItem>
                        )),
                      ])}
                    </SelectContent>
                  </Select>

                  <div className="ml-auto flex shrink-0 items-center gap-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("routing.move-up")}
                      disabled={saving || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("routing.move-down")}
                      disabled={saving || index === rules.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                    {/* Icon only, and the one destructive control in the card:
                        a full-width "Remove" button next to two arrows made
                        deleting a rule the loudest thing in the row. */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={t("action.remove")}
                      disabled={saving}
                      onClick={() => save(rules.filter((_, at) => at !== index))}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </div>

                <Field label={t("routing.column.classes")}>
                  <ToggleGroup
                    type="multiple"
                    value={rule.classes}
                    onValueChange={(classes: string[]) => patch(index, { classes: classes as EventClass[] })}
                    className="flex-wrap"
                    disabled={saving}
                  >
                    {EVENT_CLASSES.map((eventClass) => (
                      <ToggleGroupItem key={eventClass} value={eventClass} className="h-7 text-xs">
                        {t(`routing.class.${eventClass}`)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </Field>

                <Field label={t("routing.column.severity")}>
                  <Select
                    value={rule.minSeverity}
                    disabled={saving}
                    onValueChange={(minSeverity) =>
                      patch(index, { minSeverity: minSeverity as SeverityFloor })
                    }
                  >
                    <SelectTrigger className="h-8 w-48 text-sm">
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
                </Field>

                <Field label={t("routing.column.channels")}>
                  <ToggleGroup
                    type="multiple"
                    value={rule.channels}
                    onValueChange={(next: string[]) => patch(index, { channels: next })}
                    className="flex-wrap"
                    disabled={saving}
                  >
                    {/* The wildcard is an option rather than a computed state:
                        a rule that says "every channel" must keep meaning that
                        after a new channel ships. */}
                    <ToggleGroupItem value="*" className="h-7 text-xs">
                      {t("routing.channels.all")}
                    </ToggleGroupItem>
                    {channels.map((channel) => (
                      <ToggleGroupItem key={channel.id} value={channel.id} className="h-7 text-xs">
                        {t(`channel.name.${channel.id}`)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  {rule.channels.length === 0 && (
                    <Badge variant="secondary">{t("routing.channels.none")}</Badge>
                  )}
                </Field>

                {/* Said in the card, not in a tooltip: a rule that can never
                    fire is the panel's most important warning, and a hover
                    target hides it from anyone who never hovers. */}
                {shadow !== undefined && (
                  <RuleWarning>{t("routing.shadowed", { rule: shadow + 1 })}</RuleWarning>
                )}
                {deadNoClasses && <RuleWarning>{t("routing.no-classes")}</RuleWarning>}
              </li>
            );
          })}
        </ul>
      )}

      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={saving}
          onClick={() =>
            save([...rules, { provider: "*", classes: [...EVENT_CLASSES], minSeverity: "any", channels: ["*"] }])
          }
        >
          {t("routing.add")}
        </Button>
      </div>

      {rules.length > 0 && (
        <DryRun rules={rules} channels={channels} services={services} quietHours={quietHours} />
      )}
    </div>
  );
}
