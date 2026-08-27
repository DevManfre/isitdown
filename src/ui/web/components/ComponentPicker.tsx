import { useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { Switch } from "@/components/ui/switch.tsx";

/** One entry as `previewComponents` reports it — before any service row exists for it. */
export interface ComponentPickerEntry {
  id: string;
  name: string;
  group: string | null;
}

/** What a `ServiceDefinition.components` row actually keeps: no group, no showcase flag. */
export interface ComponentPickerSelection {
  id: string;
  name: string;
}

/**
 * Controlled component picker: owns no selection state of its own, so the
 * dialog around it stays the single source of truth (Task 5's contract).
 * Port of src/ui/public/js/components/componentPicker.js, with vanilla's
 * per-group collapsible sections and per-group "select all" flattened into
 * one search box, one flat "select all visible" action, and grouped headers.
 */
export function ComponentPicker({
  available,
  supported,
  value,
  onChange,
  loading,
  scopeToComponents,
  onScopeChange,
}: {
  available: ComponentPickerEntry[];
  /**
   * `previewComponents`'s own `supported` flag — distinct from an empty
   * `available`. Mirrors vanilla's own two-message split
   * (componentPicker.js:106-116): the adapter cannot list components at all
   * (`components.unsupported`) versus it can, and this provider just has
   * none (`components.empty`). Collapsing the two into one message was a
   * defect, not a simplification — restored here.
   */
  supported: boolean;
  value: ComponentPickerSelection[];
  onChange: (next: ComponentPickerSelection[]) => void;
  loading: boolean;
  scopeToComponents?: boolean;
  onScopeChange?: (next: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState("");
  const scopeId = useId();

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t("components.load")}</p>;
  }

  if (!supported) {
    return <p className="text-sm text-muted-foreground">{t("components.unsupported")}</p>;
  }

  if (available.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("components.empty")}</p>;
  }

  const selectedIds = new Set(value.map((entry) => entry.id));
  const needle = search.trim().toLowerCase();
  const visible = available.filter(
    (component) => needle === "" || component.name.toLowerCase().includes(needle),
  );

  // Bucket by the group each component first appears in — vanilla's own
  // grouping rule (componentPicker.js's groupComponents), ungrouped last.
  const groups = new Map<string, ComponentPickerEntry[]>();
  for (const component of visible) {
    const label = component.group ?? t("components.ungrouped");
    const bucket = groups.get(label);
    if (bucket === undefined) groups.set(label, [component]);
    else bucket.push(component);
  }

  const toggle = (component: ComponentPickerEntry, checked: boolean): void => {
    if (checked) {
      if (selectedIds.has(component.id)) return;
      onChange([...value, { id: component.id, name: component.name }]);
    } else {
      onChange(value.filter((entry) => entry.id !== component.id));
    }
  };

  const selectAllVisible = (): void => {
    const additions = visible
      .filter((component) => !selectedIds.has(component.id))
      .map((component) => ({ id: component.id, name: component.name }));
    if (additions.length === 0) return;
    onChange([...value, ...additions]);
  };

  return (
    <div className="component-picker flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          type="search"
          role="searchbox"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("components.search")}
          aria-label={t("components.search")}
          className="max-w-xs"
        />
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            <Trans
              i18nKey="components.selected"
              count={value.length}
              values={{ count: value.length }}
              components={[<NumberTicker locale={i18n.language} value={value.length} />]}
            />
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={selectAllVisible}>
            {t("components.select-all")}
          </Button>
        </div>
      </div>

      <div className="component-picker-list flex max-h-64 flex-col gap-3 overflow-y-auto">
        {[...groups.entries()].map(([label, members]) => (
          <div key={label} className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
            {members.map((component) => (
              <label key={component.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border border-input accent-primary"
                  checked={selectedIds.has(component.id)}
                  onChange={(event) => toggle(component, event.target.checked)}
                />
                {component.name}
              </label>
            ))}
          </div>
        ))}
      </div>

      <span className="font-mono text-xs text-muted-foreground">{t("components.hint")}</span>

      {onScopeChange !== undefined && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Switch
              id={scopeId}
              checked={scopeToComponents ?? false}
              disabled={value.length === 0}
              onCheckedChange={onScopeChange}
            />
            <Label htmlFor={scopeId}>{t("components.scope")}</Label>
          </div>
          <span className="text-xs text-muted-foreground">{t("components.scope-hint")}</span>
        </div>
      )}
    </div>
  );
}
