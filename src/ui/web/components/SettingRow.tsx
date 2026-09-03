import type { ReactNode } from "react";
import { cn } from "@/lib/utils.ts";

/**
 * One row of a settings list: what the setting is on the left, the control
 * that changes it on the right.
 *
 * The shape is decided here once, the way `BentoTile` used to decide tile
 * shape once — five blocks each with their own idea of where a label, a hint
 * and a control belonged is what made the old grid read as a pile. The text
 * column carries `min-w-0` and the control slot `shrink-0`, so a long
 * description wraps and a control never does; `data-align="top"` is for rows
 * whose description is long enough that a centred control looks stranded.
 */
export function SettingRow({
  label,
  description,
  leading,
  meta,
  align = "center",
  className,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  meta?: ReactNode;
  align?: "center" | "top";
  className?: string;
  children: ReactNode;
}) {
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
            <span data-slot="setting-row-description" className="text-xs leading-relaxed text-muted-foreground">
              {description}
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
