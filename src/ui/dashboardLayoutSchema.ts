import { z } from "zod";
import { MAX_WIDGETS, WIDGET_WIDTHS, WIDTHS, type DashboardLayout, type Width, type WidgetType } from "./dashboardLayout.ts";

/** The check a stored or submitted layout passes — server side only (see `dashboardLayout.ts`). */
const filterSchema = z
  .object({
    groups: z.array(z.string().min(1)).default([]),
    providers: z.array(z.string().min(1)).default([]),
  })
  .strict();

const fleetProps = z.object({ filter: filterSchema.default({}) }).strict();
const noProps = z.object({}).strict();

function widget<T extends WidgetType, P extends z.ZodTypeAny>(type: T, props: P) {
  return z
    .object({
      id: z.string().min(1).max(40),
      type: z.literal(type),
      width: z.enum(WIDTHS),
      props,
    })
    .strict();
}

const widgetSchema = z.discriminatedUnion("type", [
  widget("fleet-rings", fleetProps),
  widget("geo-map", noProps),
  widget("shared-failure", noProps),
  widget("stack-band", fleetProps),
  widget("fleet-list", fleetProps),
]);

export const layoutSchema: z.ZodType<DashboardLayout, z.ZodTypeDef, unknown> = z
  .object({
    version: z.literal(1),
    widgets: z.array(widgetSchema).max(MAX_WIDGETS),
  })
  .superRefine((layout, ctx) => {
    const seen = new Set<string>();
    layout.widgets.forEach((w, index) => {
      if (seen.has(w.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["widgets", index, "id"], message: `duplicate widget id "${w.id}"` });
      }
      seen.add(w.id);
      if (!(WIDGET_WIDTHS[w.type] as readonly Width[]).includes(w.width)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["widgets", index, "width"], message: `${w.type} cannot be ${w.width}` });
      }
    });
  });
