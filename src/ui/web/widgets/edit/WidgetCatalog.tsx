import { useTranslation } from "react-i18next";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet.tsx";
import { WIDGET_ORDER, WIDGETS } from "@/widgets/registry.tsx";
import { WIDTHS, type WidgetConfig, type WidgetType } from "../../../dashboardLayout.ts";
import { widthLabelKey } from "../widths.ts";

/**
 * "+ Add widget": every widget there is, with what it shows and the widths it
 * takes. A widget already on the page stays offered — the same list twice with
 * two filters is the point of having filters.
 */
export function WidgetCatalog({
  open,
  onOpenChange,
  widgets,
  onAdd,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widgets: readonly WidgetConfig[];
  onAdd: (type: WidgetType) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[420px] max-w-full gap-0 overflow-y-auto" onCloseAutoFocus={onCloseAutoFocus}>
        <SheetHeader>
          <SheetTitle>{t("dashboard.add")}</SheetTitle>
          <SheetDescription>{t("dashboard.catalog.description")}</SheetDescription>
        </SheetHeader>
        <ul className="flex flex-col gap-3 px-4 pb-6">
          {WIDGET_ORDER.map((type) => {
            const def = WIDGETS[type];
            const present = widgets.filter((w) => w.type === type).length;
            const widths = WIDTHS.filter((w) => (def.widths as readonly string[]).includes(w))
              .map((w) => t(widthLabelKey(w)))
              .join(" · ");
            return (
              <li key={type}>
                <button
                  type="button"
                  onClick={() => onAdd(type)}
                  className="flex w-full flex-col gap-1.5 rounded-xl border border-border px-4 py-3.5 text-left transition-colors hover:border-primary hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{t(def.titleKey)}</span>
                    {present > 0 && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {t("dashboard.catalog.present", { count: present })}
                      </span>
                    )}
                  </span>
                  <span className="text-sm leading-relaxed text-muted-foreground">{t(def.descriptionKey)}</span>
                  <span className="font-mono text-xs text-primary">{t("dashboard.catalog.widths", { widths })}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
