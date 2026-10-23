import { useTranslation } from "react-i18next";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { useStatus } from "@/hooks/queries.ts";
import { cn } from "@/lib/utils.ts";
import type { FleetFilter } from "../../../dashboardLayout.ts";
import type { DraftAction } from "../layoutDraft.ts";

interface Option {
  id: string;
  label: string;
  /** Named by the filter but gone from the fleet: shown struck, one press drops it. */
  removed: boolean;
}

function options(known: { id: string; label: string }[], chosen: string[], removedLabel: (id: string) => string): Option[] {
  const ids = new Set(known.map((o) => o.id));
  return [
    ...known.map((o) => ({ ...o, removed: false })),
    ...chosen.filter((id) => !ids.has(id)).map((id) => ({ id, label: removedLabel(id), removed: true })),
  ];
}

/**
 * A fleet widget's filter, unfolded under its toolbar. Two multi-select toggle
 * groups — groups, then providers — whose union is the slice. A long fleet's
 * provider list scrolls inside its own box instead of pushing the grid away.
 */
export function FilterPanel({
  id,
  widgetId,
  filter,
  dispatch,
}: {
  id: string;
  widgetId: string;
  filter: FleetFilter;
  dispatch: (action: DraftAction) => void;
}) {
  const { t } = useTranslation();
  const { data: status } = useStatus();
  const removed = (name: string) => t("dashboard.filter.removed", { name });
  const groups = options(
    (status?.groups ?? []).map((g) => ({ id: g.id, label: g.id })),
    filter.groups,
    removed,
  );
  const providers = options(
    (status?.providers ?? []).filter((p) => p.enabled).map((p) => ({ id: p.id, label: p.name })),
    filter.providers,
    removed,
  );

  const toggle = (field: keyof FleetFilter, next: string[]) => {
    const before = new Set(filter[field]);
    const after = new Set(next);
    const value = [...after].find((v) => !before.has(v)) ?? [...before].find((v) => !after.has(v));
    if (value !== undefined) dispatch({ type: "toggleFilter", id: widgetId, field, value });
  };

  const chips = (field: keyof FleetFilter, list: Option[], labelKey: string) => (
    <ToggleGroup
      type="multiple"
      variant="outline"
      spacing={1.5}
      size="sm"
      aria-label={t(labelKey)}
      className="flex-wrap"
      value={filter[field]}
      onValueChange={(next) => toggle(field, next)}
    >
      {list.map((option) => (
        <ToggleGroupItem
          key={option.id}
          value={option.id}
          className={cn(
            "rounded-full px-3 data-[state=on]:border-primary data-[state=on]:bg-primary/10 data-[state=on]:text-foreground",
            option.removed && "border-dashed line-through",
          )}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );

  return (
    <div
      id={id}
      data-slot="widget-filter"
      className="mt-3 flex flex-col gap-3 rounded-lg border border-primary/60 bg-card p-3.5"
    >
      <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
        {t("dashboard.filter.groups")}
      </span>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("dashboard.filter.no-groups")}</p>
      ) : (
        chips("groups", groups, "dashboard.filter.groups")
      )}
      <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
        {t("dashboard.filter.providers")}
      </span>
      <div className="max-h-48 overflow-y-auto">{chips("providers", providers, "dashboard.filter.providers")}</div>
      <p className="text-xs text-muted-foreground">{t("dashboard.filter.union")}</p>
    </div>
  );
}
