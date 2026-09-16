import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Bell, Database, Gauge, Palette, Send, Server, TriangleAlert, X } from "lucide-react";

import { AnimatedList } from "@/components/ui/animated-list.tsx";
import { cn } from "@/lib/utils.ts";

/**
 * What the settings page says back after an instant-apply write, as a stack in
 * the bottom-right corner instead of a line inside the card that saved.
 *
 * The footer line it replaces had to sit still to be read, which put it at the
 * bottom of a card the operator had usually already scrolled past — a "Saved"
 * nobody saw, and an out-of-range error that landed just as far from the field
 * that caused it. A corner stack is read wherever the page is scrolled to, and
 * it stacks: three rows saved in a row leave three receipts rather than one
 * line overwriting itself.
 *
 * A card is its sentence and an icon, nothing else. The section it came from is
 * carried by the icon alone: the operator is looking at that section when it
 * answers, so naming it in a title repeated the heading above the card for no
 * one. An error swaps the icon for the warning, because the tone matters more
 * than the origin when something failed.
 */
export type SettingsToastKind = "engine" | "services" | "notifications" | "delivery" | "data" | "appearance";

export interface SettingsToastStatus {
  text: string;
  tone: "ok" | "error";
}

interface SettingsToast extends SettingsToastStatus {
  id: number;
  kind: SettingsToastKind;
}

/** Long enough to read a sentence; an error stays twice as long as a receipt. */
const DISMISS_MS = { ok: 4000, error: 8000 } as const;

/** Older receipts fall off the top rather than growing a column up the page. */
const MAX_VISIBLE = 3;

const KIND_ICON: Record<SettingsToastKind, typeof Gauge> = {
  engine: Gauge,
  services: Server,
  notifications: Bell,
  delivery: Send,
  data: Database,
  appearance: Palette,
};

export type SettingsToastReport = (kind: SettingsToastKind, status: SettingsToastStatus | undefined) => void;

/**
 * Reporting into the stack from wherever the write happens. A provider rather
 * than props, because the rows that answer are not the page's own children in
 * any useful sense: a channel's credential is saved inside `ChannelRow`, a mute
 * inside `MuteMenu`, a provider inside a dialog Radix renders in a portal.
 *
 * The default is a no-op so a row still renders outside the settings page — in
 * a test, or anywhere else it is reused — without a provider around it.
 */
const ReportContext = createContext<SettingsToastReport>(() => {});

export function useSettingsToastReport(): SettingsToastReport {
  return use(ReportContext);
}

/**
 * Owns the stack and its timers. Exported for the page that mounts the
 * viewport; everything else reports through the context above.
 */
export function useSettingsToasts(): {
  toasts: SettingsToast[];
  report: (kind: SettingsToastKind, status: SettingsToastStatus | undefined) => void;
  dismiss: (id: number) => void;
} {
  const [toasts, setToasts] = useState<SettingsToast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  // Call sites clear their status before a mutation and set it on the answer,
  // so `undefined` means "nothing to say" — never "drop what is on screen".
  const report = useCallback(
    (kind: SettingsToastKind, status: SettingsToastStatus | undefined) => {
      if (status === undefined) return;
      const id = nextId.current++;
      setToasts((current) => [...current, { id, kind, ...status }].slice(-MAX_VISIBLE));
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DISMISS_MS[status.tone]),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return { toasts, report, dismiss };
}

/**
 * The stack, its viewport, and the context every row reports through — one
 * component so a page adds all three by wrapping itself in it once.
 */
export function SettingsToastsProvider({ children }: { children: ReactNode }) {
  const { toasts, report, dismiss } = useSettingsToasts();
  return (
    <ReportContext.Provider value={report}>
      {children}
      <SettingsToasts toasts={toasts} onDismiss={dismiss} />
    </ReportContext.Provider>
  );
}

/**
 * The viewport. `fixed` and `pointer-events-none` so an empty stack never
 * covers the page, with the cards themselves taking pointer events back.
 */
export function SettingsToasts({ toasts, onDismiss }: { toasts: SettingsToast[]; onDismiss: (id: number) => void }) {
  const { t } = useTranslation();

  return (
    <div
      data-slot="settings-toasts"
      aria-label={t("settings.toasts.aria")}
      aria-live="polite"
      className="pointer-events-none fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col justify-end gap-0 p-4 sm:p-6"
    >
      {/* Newest last, so the stack grows towards the corner it is anchored to. */}
      <AnimatedList className="items-end">
        {toasts.map((toast) => (
          <SettingsToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </AnimatedList>
    </div>
  );
}

function SettingsToastCard({ toast, onDismiss }: { toast: SettingsToast; onDismiss: (id: number) => void }) {
  const { t } = useTranslation();
  const failed = toast.tone === "error";
  const Icon = failed ? TriangleAlert : KIND_ICON[toast.kind];

  return (
    <figure
      data-slot="settings-toast"
      data-kind={toast.kind}
      data-tone={toast.tone}
      className={cn(
        "pointer-events-auto flex w-full items-center gap-3 rounded-2xl border bg-card p-3 shadow-[var(--shadow-lg)]",
        failed ? "border-[var(--status-outage-border)]" : "border-[var(--status-operational-border)]",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl",
          failed
            ? "bg-[var(--status-outage-tint)] text-destructive"
            : "bg-[var(--status-operational-tint)] text-[var(--status-operational)]",
        )}
      >
        <Icon className="size-4.5" />
      </span>

      <figcaption className={cn("min-w-0 flex-1 text-xs leading-relaxed", failed && "text-destructive")}>
        {toast.text}
      </figcaption>

      <button
        type="button"
        aria-label={t("settings.toasts.dismiss")}
        onClick={() => onDismiss(toast.id)}
        className="-m-1 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </figure>
  );
}
