import { isValidElement, type ReactNode } from "react";
import { useSettingsChrome, useSettingVisible } from "@/components/settings/SettingsChrome.tsx";
import { cn } from "@/lib/utils.ts";

/** What the filter reads: the row's own words, plus whatever `search` adds. */
const words = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(words).join(" ");
  if (isValidElement<{ children?: ReactNode }>(node)) return words(node.props.children);
  return "";
};

/**
 * One row of a settings list: what the setting is on the left, the control
 * that changes it on the right.
 *
 * The shape is decided here once, the way `BentoTile` decides tile shape
 * once — five blocks each with their own idea of where a label, a hint
 * and a control belonged is what made the old grid read as a pile. The text
 * column carries `min-w-0` and the control slot `shrink-0`, so a long
 * description wraps and a control never does; `data-align="top"` is for rows
 * whose description is long enough that a centred control looks stranded.
 *
 * Two things the page's chrome decides rather than the row: whether the filter
 * still admits it (a row that does not match the typed query renders nothing,
 * and tells its section so the rail's count follows), and whether the
 * description is on screen at all — in compact density every hint folds away,
 * because the page is forty rows long and the hints are most of its height once
 * they have been read once.
 */
export function SettingRow({
  label,
  description,
  status,
  leading,
  meta,
  align = "center",
  search,
  className,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  /**
   * What just happened to this row — a reclaimed figure, a refused import.
   * Kept apart from `description` because it survives compact density: a hint
   * can be folded away once it has been read, an answer cannot.
   */
  status?: ReactNode;
  leading?: ReactNode;
  meta?: ReactNode;
  align?: "center" | "top";
  /** Extra words the filter should match — synonyms, units, the field's id. */
  search?: string;
  className?: string;
  children: ReactNode;
}) {
  const { density } = useSettingsChrome();
  const visible = useSettingVisible(`${words(label)} ${words(description)} ${search ?? ""}`);


  if (!visible) return null;

  return (
    <div
      data-slot="setting-row"
      data-align={align}
      className={cn("flex gap-6 px-4 py-3", align === "top" ? "items-start" : "items-center", className)}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {leading}
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm">{label}</span>
          {description !== undefined && (
            // Compact density folds this away rather than unmounting it: forty
            // rows losing a line each in one frame moved the page out from
            // under whatever was being read. The row is a collapsing grid
            // track (motion.css), so the hint keeps a height nothing here has
            // to know, and `aria-hidden` keeps a folded sentence out of the
            // accessibility tree the way the old unmount did.
            <span
              data-slot="setting-row-description"
              data-collapsed={density === "compact" ? "true" : undefined}
              aria-hidden={density === "compact" ? "true" : undefined}
              className="text-xs leading-relaxed text-muted-foreground"
            >
              <span>{description}</span>
            </span>
          )}
          {status !== undefined && (
            <span data-slot="setting-row-status" className="text-xs leading-relaxed">
              {status}
            </span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {meta !== undefined && <span className="font-mono text-[11px] text-muted-foreground">{meta}</span>}
        {children}
      </div>
    </div>
  );
}
