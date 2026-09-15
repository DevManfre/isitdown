import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils.ts";

/**
 * Every number on the Settings page, in one shape.
 *
 * There were four widths of bare `<input type="number">` here, each with its
 * unit floating outside the box as a separate span, and the browser's own
 * spinners — which only appear on hover and are two pixels tall. The unit moves
 * inside the field (it is part of reading the value, not a note beside it), the
 * width is the same for all of them, and −/+ are real buttons, because almost
 * every change made here is one step: a timeout of 8 seconds becomes 9, not 34.
 *
 * A step commits on the spot rather than waiting for a blur — the click *is*
 * the decision, and the value it applies is passed to `onCommit` rather than
 * read back from state, which would still hold the value before the click.
 */
export function NumberSetting({
  id,
  label,
  unit,
  value,
  min = 1,
  max,
  disabled = false,
  onChange,
  onCommit,
  onFocus,
  onBlur,
}: {
  id: string;
  label: string;
  /** Shown inside the field — minutes, seconds, polls. Omitted when the number needs none. */
  unit?: string;
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const { t } = useTranslation();

  const step = (by: number): void => {
    const next = Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, (Number.isFinite(value) ? value : min) + by));
    if (next === value) return;
    onChange(next);
    onCommit(next);
  };

  const stepper = "flex w-7 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

  return (
    <div
      data-slot="number-setting"
      className={cn(
        "flex h-9 items-stretch overflow-hidden rounded-md border border-input bg-transparent",
        "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        disabled && "opacity-50",
      )}
    >
      <button
        type="button"
        className={cn(stepper, "border-r border-input")}
        disabled={disabled || value <= min}
        aria-label={t("action.decrease", { field: label })}
        onClick={() => step(-1)}
      >
        <Minus className="size-3" />
      </button>
      <div className="flex items-center gap-1 px-2">
        <input
          id={id}
          aria-label={label}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          disabled={disabled}
          className="w-12 bg-transparent text-right font-mono text-sm tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          onFocus={onFocus}
          onBlur={() => {
            onBlur?.();
            onCommit(value);
          }}
        />
        {unit !== undefined && (
          <span aria-hidden="true" className="font-mono text-[11px] text-muted-foreground">
            {unit}
          </span>
        )}
      </div>
      <button
        type="button"
        className={cn(stepper, "border-l border-input")}
        disabled={disabled || (max !== undefined && value >= max)}
        aria-label={t("action.increase", { field: label })}
        onClick={() => step(1)}
      >
        <Plus className="size-3" />
      </button>
    </div>
  );
}
