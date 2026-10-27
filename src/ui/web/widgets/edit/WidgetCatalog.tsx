import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet.tsx";
import { WidgetBody } from "@/components/DashboardGrid.tsx";
import { WIDGET_ORDER, WIDGETS } from "@/widgets/registry.tsx";
import { WIDTHS, type WidgetConfig, type WidgetType } from "../../../dashboardLayout.ts";
import { newWidget } from "../layoutDraft.ts";
import { widthLabelKey } from "../widths.ts";

/**
 * The width a preview is drawn at before it is scaled down to the card: wide
 * enough that a widget lays itself out as it would in a full-width cell, not
 * as its squeezed third.
 */
const PREVIEW_WIDTH = 720;

/**
 * What the widget would draw if added now: the real widget, on today's data,
 * shrunk into the card. Mounted only once the card scrolls into view — thirty
 * live widgets at once would each fetch and animate for a sheet nobody has
 * scrolled yet — and inert, so none of its links or buttons can be reached
 * from inside the card's own button.
 */
function WidgetPreview({ type }: { type: WidgetType }) {
  const { t } = useTranslation();
  const frame = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = frame.current;
    if (el === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = frame.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setScale(entry.contentRect.width / PREVIEW_WIDTH);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={frame}
      aria-hidden="true"
      inert
      data-slot="catalog-preview"
      className="pointer-events-none relative h-40 overflow-hidden rounded-t-xl border-b border-border bg-background/60 select-none"
    >
      {seen && scale > 0 && (
        <div
          className="absolute top-0 left-0 origin-top-left p-4"
          style={{ width: PREVIEW_WIDTH, transform: `scale(${scale})` }}
        >
          <div className="peer">
            <WidgetBody widget={newWidget(type, `preview-${type}`)} />
          </div>
          {/* A widget with nothing to draw today still shows what it is for. */}
          <p className="hidden rounded-lg border border-dashed border-border px-5 py-4 text-sm leading-relaxed text-muted-foreground peer-empty:block">
            {t(WIDGETS[type].idleKey)}
          </p>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}

/**
 * "+ Add widget": every widget there is, with a preview of what it draws, what
 * it shows and the widths it takes. A widget already on the page stays offered
 * — the same list twice with two filters is the point of having filters.
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
      <SheetContent side="right" className="w-[560px] max-w-full gap-0 overflow-y-auto sm:max-w-[560px]" onCloseAutoFocus={onCloseAutoFocus}>
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
            // The button is the card's text; its ::after stretches over the
            // preview too, so the whole card is one target without a button
            // having to wrap a widget's own links.
            return (
              <li
                key={type}
                className="relative rounded-xl border border-border transition-colors has-[button:hover]:border-primary has-[button:hover]:bg-accent/40 has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-offset-2 has-[button:focus-visible]:outline-ring"
              >
                <WidgetPreview type={type} />
                <button
                  type="button"
                  onClick={() => onAdd(type)}
                  className="flex w-full flex-col gap-1.5 px-4 py-3.5 text-left outline-none after:absolute after:inset-0 after:rounded-xl"
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
