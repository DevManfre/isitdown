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

/**
 * A write held back for a few seconds behind a toast, so the operator can take
 * it back (roadmap 4.8). `commit` is the real write; it runs when the window
 * closes, when the toast is dismissed, or when the page is left — never twice,
 * and never after `onUndo`.
 */
export interface DeferredWrite {
  text: string;
  commit: () => void | Promise<unknown>;
  /** Called once the write is settled one way or the other, to drop any "pending" look. */
  onUndo?: () => void;
}

interface SettingsToast extends SettingsToastStatus {
  id: number;
  kind: SettingsToastKind;
  /** Present on a deferred write: the toast shows an Undo button for it. */
  undo?: () => void;
}

/** Long enough to read a sentence; an error stays twice as long as a receipt. */
const DISMISS_MS = { ok: 4000, error: 8000 } as const;

/** How long a deferred write waits for an Undo before it goes out. */
export const UNDO_MS = 6000;

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

export type SettingsDeferredWrite = (kind: SettingsToastKind, write: DeferredWrite) => void;

/** Outside a provider there is no toast to undo from, so the write just goes out. */
const DeferContext = createContext<SettingsDeferredWrite>((_kind, write) => {
  void write.commit();
});

export function useDeferredWrite(): SettingsDeferredWrite {
  return use(DeferContext);
}

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
  defer: SettingsDeferredWrite;
  dismiss: (id: number) => void;
} {
  const [toasts, setToasts] = useState<SettingsToast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  // Writes still waiting on their window, by toast id. Taking one out of here is
  // what makes it run exactly once: whoever deletes it first owns it.
  const held = useRef(new Map<number, DeferredWrite>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
    // Closing the card is accepting the write, not cancelling it.
    const write = held.current.get(id);
    if (write !== undefined) {
      held.current.delete(id);
      void write.commit();
    }
  }, []);

  const undo = useCallback((id: number) => {
    const write = held.current.get(id);
    if (write === undefined) return;
    held.current.delete(id);
    write.onUndo?.();
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const defer = useCallback<SettingsDeferredWrite>(
    (kind, write) => {
      const id = nextId.current++;
      held.current.set(id, write);
      setToasts((current) => [...current, { id, kind, text: write.text, tone: "ok" as const, undo: () => undo(id) }].slice(-MAX_VISIBLE));
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), UNDO_MS),
      );
    },
    [dismiss, undo],
  );

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
    const writes = held.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      // Leaving the page is not an Undo: the operator asked for these.
      for (const write of writes.values()) void write.commit();
      writes.clear();
    };
  }, []);

  return { toasts, report, defer, dismiss };
}

/**
 * The stack, its viewport, and the context every row reports through — one
 * component so a page adds all three by wrapping itself in it once.
 */
export function SettingsToastsProvider({ children }: { children: ReactNode }) {
  const { toasts, report, defer, dismiss } = useSettingsToasts();
  return (
    <ReportContext.Provider value={report}>
      <DeferContext.Provider value={defer}>
        {children}
        <SettingsToasts toasts={toasts} onDismiss={dismiss} />
      </DeferContext.Provider>
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
      // A role, because a name on a bare <div> is ignored (axe:
      // aria-prohibited-attr) — the region is what the label is for. Polite and
      // additions-only, and not atomic: a new card is read on its own, rather
      // than the whole stack again each time one arrives.
      role="region"
      aria-label={t("settings.toasts.aria")}
      aria-live="polite"
      aria-atomic="false"
      aria-relevant="additions"
      // The bottom padding clears the mobile tab bar, which is fixed over the
      // same corner: without it a toast reports a save from behind five tabs.
      className="pointer-events-none fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col justify-end gap-0 p-4 pb-24 sm:p-6 md:pb-6"
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
      // A refused write interrupts: the card says what did not happen, and the
      // operator is mid-edit on the very field it is about. A receipt waits its
      // turn in the polite region around it.
      {...(failed ? { role: "alert" } : {})}
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

      {toast.undo !== undefined && (
        <button
          type="button"
          onClick={toast.undo}
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-accent"
        >
          {t("action.undo")}
        </button>
      )}

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
