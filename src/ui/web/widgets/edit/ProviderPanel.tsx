import { useTranslation } from "react-i18next";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { useStatus } from "@/hooks/queries.ts";
import { cn } from "@/lib/utils.ts";
import type { DraftAction } from "../layoutDraft.ts";

/** The value the toggle group uses for "follow the worst of the fleet". */
const WORST = "\u0000worst";

/**
 * A one-provider widget's choice, unfolded under its toolbar: the worst of the
 * fleet (the default, which follows trouble around), or one provider by name.
 * A provider the fleet no longer has stays listed, struck, until another is
 * chosen — the same rule the fleet filter keeps.
 */
export function ProviderPanel({
  id,
  widgetId,
  provider,
  dispatch,
}: {
  id: string;
  widgetId: string;
  provider: string | null;
  dispatch: (action: DraftAction) => void;
}) {
  const { t } = useTranslation();
  const { data: status } = useStatus();
  const providers = (status?.providers ?? []).filter((p) => p.enabled);
  const gone = provider !== null && !providers.some((p) => p.id === provider);

  return (
    <div id={id} data-slot="widget-provider" className="mt-3 flex flex-col gap-3 rounded-lg border border-primary/60 bg-card p-3.5">
      <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">{t("dashboard.provider.label")}</span>
      <div className="max-h-48 overflow-y-auto">
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={1.5}
          size="sm"
          aria-label={t("dashboard.provider.label")}
          className="flex-wrap"
          value={provider ?? WORST}
          onValueChange={(value) => {
            if (value === "") return;
            dispatch({ type: "setProvider", id: widgetId, provider: value === WORST ? null : value });
          }}
        >
          {[{ id: WORST, label: t("dashboard.provider.worst"), removed: false },
            ...providers.map((p) => ({ id: p.id, label: p.name, removed: false })),
            ...(gone ? [{ id: provider, label: t("dashboard.filter.removed", { name: provider }), removed: true }] : []),
          ].map((option) => (
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
      </div>
      <p className="text-xs text-muted-foreground">{t("dashboard.provider.hint")}</p>
    </div>
  );
}
