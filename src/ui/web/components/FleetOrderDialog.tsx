import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Reorder, useDragControls } from "motion/react";
import { ChevronDown, ChevronUp, GripVertical, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { ConfirmDialog } from "@/components/ConfirmDialog.tsx";
import { usePreferences, usePreferencesMutation, useStatus } from "@/hooks/queries.ts";
import { useStill } from "@/lib/still.ts";
import { REORDER_SPRING } from "@/components/DashboardGrid.tsx";

interface Entry {
  id: string;
  name: string;
}

/** Whether two id lists say the same order. */
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/** `ids` with the one at `from` moved to `to`. */
function moved(ids: readonly string[], from: number, to: number): string[] {
  const next = [...ids];
  const [id] = next.splice(from, 1);
  if (id !== undefined) next.splice(to, 0, id);
  return next;
}

/**
 * One draggable list: a handle to drag by, and an up/down pair beside it for
 * a keyboard or a hand that cannot drag — the same pair edit mode's widgets
 * carry (roadmap 4.1), so moving a row is never pointer-only.
 */
function OrderList({
  labelKey,
  entries,
  order,
  onChange,
  announce,
}: {
  labelKey: string;
  entries: ReadonlyMap<string, string>;
  order: string[];
  onChange: (next: string[]) => void;
  announce: (text: string) => void;
}) {
  const { t } = useTranslation();
  const label = t(labelKey);
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{label}</h3>
      <Reorder.Group axis="y" values={order} onReorder={onChange} className="flex flex-col gap-1.5" role="list">
        {order.map((id, index) => (
          <OrderRow
            key={id}
            entry={{ id, name: entries.get(id) ?? id }}
            index={index}
            total={order.length}
            onMove={(delta) => {
              const to = index + delta;
              onChange(moved(order, index, to));
              announce(t("fleet-order.moved", { name: entries.get(id) ?? id, position: to + 1, total: order.length }));
            }}
          />
        ))}
      </Reorder.Group>
    </section>
  );
}

function OrderRow({
  entry,
  index,
  total,
  onMove,
}: {
  entry: Entry;
  index: number;
  total: number;
  onMove: (delta: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  const controls = useDragControls();
  const still = useStill();
  return (
    <Reorder.Item
      value={entry.id}
      role="listitem"
      dragListener={false}
      dragControls={controls}
      // A Reorder item is always laid out; with motion stilled the move simply lands.
      layout="position"
      transition={{ layout: still ? { duration: 0 } : REORDER_SPRING }}
      whileDrag={{ scale: 1.02 }}
      data-slot="fleet-order-row"
      className="flex items-center gap-1 rounded-lg border border-border bg-card px-1.5 py-1"
    >
      {/* Pointer only, on purpose: the arrows beside it are the keyboard and
          screen-reader path, so the handle is not a control of its own. */}
      <span
        aria-hidden="true"
        className="flex size-8 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing"
        onPointerDown={(event) => controls.start(event)}
      >
        <GripVertical className="size-4" />
      </span>
      <span className="w-6 text-right font-mono text-xs text-muted-foreground tabular-nums">{index + 1}</span>
      <span className="min-w-0 flex-1 truncate pl-1 text-sm">{entry.name}</span>
      {/* `aria-disabled` rather than `disabled` at the two ends: a row moved
          to the top keeps focus on the button that moved it, where `disabled`
          would drop focus to the page and the next Tab start the dialog over. */}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("fleet-order.move-up", { name: entry.name })}
        aria-disabled={index === 0}
        className="aria-disabled:opacity-50"
        onClick={() => index > 0 && onMove(-1)}
      >
        <ChevronUp aria-hidden="true" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("fleet-order.move-down", { name: entry.name })}
        aria-disabled={index === total - 1}
        className="aria-disabled:opacity-50"
        onClick={() => index < total - 1 && onMove(1)}
      >
        <ChevronDown aria-hidden="true" />
      </Button>
    </Reorder.Item>
  );
}

/**
 * The fleet's manual order — roadmap 4.24. Providers and groups are dragged
 * into the order the Overview and the wallboard list them in; the server
 * keeps it, so the office screen agrees with the laptop that arranged it.
 * "Automatic order" forgets it, putting the fleet back the way it has always
 * been listed.
 *
 * A draft until Save, like the dashboard editor it opens from: closing a
 * moved list asks first.
 */
export function FleetOrderDialog() {
  const { t } = useTranslation();
  const { data: status } = useStatus();
  const { data: preferences } = usePreferences();
  const mutation = usePreferencesMutation();
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [initial, setInitial] = useState<{ providers: string[]; groups: string[] }>({ providers: [], groups: [] });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmAutomatic, setConfirmAutomatic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // `/status` already answers in the saved order (or the automatic one), so
  // the lists start from what the page is drawing right now.
  const fleet = (status?.providers ?? []).filter((provider) => provider.enabled);
  const groupIds = (status?.groups ?? []).map((group) => group.id);
  const names = new Map(fleet.map((provider) => [provider.id, provider.name]));
  const groupNames = new Map(groupIds.map((id) => [id, id]));
  const manual = (preferences?.fleetOrder?.length ?? 0) > 0 || (preferences?.groupOrder?.length ?? 0) > 0;

  const dirty = !same(providers, initial.providers) || !same(groups, initial.groups);

  const start = () => {
    const now = { providers: fleet.map((provider) => provider.id), groups: groupIds };
    setInitial(now);
    setProviders(now.providers);
    setGroups(now.groups);
    setError(null);
    setAnnouncement("");
    setOpen(true);
  };

  const close = (next: boolean) => {
    if (next) return;
    if (dirty && !mutation.isPending) {
      setConfirmDiscard(true);
      return;
    }
    setOpen(false);
  };

  const save = async (order: { fleetOrder: string[]; groupOrder: string[] }) => {
    setError(null);
    try {
      await mutation.mutateAsync(order);
      setOpen(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };

  if (fleet.length < 2 && groupIds.length < 2) return null;

  return (
    <>
      <Button type="button" variant="ghost" onClick={start}>
        <ListOrdered aria-hidden="true" />
        {t("fleet-order.open")}
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("fleet-order.title")}</DialogTitle>
            <DialogDescription>{t("fleet-order.description")}</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto">
            {fleet.length > 1 && (
              <OrderList
                labelKey="fleet-order.providers"
                entries={names}
                order={providers}
                onChange={setProviders}
                announce={setAnnouncement}
              />
            )}
            {groupIds.length > 1 && (
              <OrderList
                labelKey="fleet-order.groups"
                entries={groupNames}
                order={groups}
                onChange={setGroups}
                announce={setAnnouncement}
              />
            )}
            <p role="status" aria-live="polite" className="sr-only">
              {announcement}
            </p>
            {error !== null && (
              <p role="alert" className="text-sm text-[var(--status-major-outage)]">
                {t("fleet-order.save-failed", { error })}
              </p>
            )}
          </DialogBody>
          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              disabled={!manual || mutation.isPending}
              onClick={() => setConfirmAutomatic(true)}
            >
              {t("fleet-order.automatic")}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => close(false)}>
                {t("action.cancel")}
              </Button>
              <Button
                type="button"
                disabled={!dirty || mutation.isPending}
                onClick={() => void save({ fleetOrder: providers, groupOrder: groups })}
              >
                {t("action.save")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t("fleet-order.discard.title")}
        description={t("fleet-order.discard.body")}
        confirmLabel={t("fleet-order.discard.confirm")}
        onConfirm={() => setOpen(false)}
      />
      {/* Forgetting an arranged order is overwriting something the operator
          made, so it is asked first — and it says so when moves are pending. */}
      <ConfirmDialog
        open={confirmAutomatic}
        onOpenChange={setConfirmAutomatic}
        title={t("fleet-order.automatic-confirm.title")}
        description={t("fleet-order.automatic-confirm.body")}
        confirmLabel={t("fleet-order.automatic")}
        onConfirm={() => void save({ fleetOrder: [], groupOrder: [] })}
      />
    </>
  );
}
