import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog.tsx";
import { useServiceImpact, useServiceMutations } from "@/hooks/queries.ts";
import { useBusyControls } from "@/hooks/useBusy.tsx";
import type { ServiceDefinition, ServiceImpact } from "@/lib/types.ts";

/**
 * The order an operator reads them in: the span of history first, because it is
 * the loss they feel, then the rows behind it. Keys are literals, not built from
 * a field name, so the catalog's own orphan test can see them.
 */
const IMPACT_ROWS: { key: string; of: (impact: ServiceImpact) => number }[] = [
  { key: "providers.remove-impact.history", of: (impact) => impact.historyDays },
  { key: "providers.remove-impact.samples", of: (impact) => impact.samples },
  { key: "providers.remove-impact.component-samples", of: (impact) => impact.componentSamples },
  { key: "providers.remove-impact.incidents", of: (impact) => impact.incidents },
  { key: "providers.remove-impact.maintenances", of: (impact) => impact.maintenances },
  { key: "providers.remove-impact.rules", of: (impact) => impact.routingRules },
];

/**
 * A small yes/no dialog for removing a service, on the same `Dialog` the
 * service form uses — a port of `confirmModal` (modal.js), never the
 * browser's own `window.confirm`.
 *
 * The confirmation names what the removal takes — the counts behind the
 * cascade, read while the dialog is open (roadmap 5.12). Rows that count zero
 * are left out: a list of "0 incidents" reads as reassurance, which is the
 * opposite of the point.
 *
 * Owns its own trigger (the row's Remove button) inside the same `Dialog`,
 * same reason as `ServiceDialog`: Radix only returns focus to a real
 * `DialogTrigger` it rendered, never to an arbitrary button elsewhere that
 * merely flips an externally-lifted open flag.
 */
export function RemoveServiceDialog({ service, trigger }: { service: ServiceDefinition; trigger: ReactNode }) {
  const { t } = useTranslation();
  const { setDialogOpen } = useBusyControls();
  const [open, setOpen] = useState(false);
  const remove = useServiceMutations().remove;
  const impact = useServiceImpact(service.id, open);
  const rows =
    impact.data === undefined
      ? []
      : IMPACT_ROWS.map((row) => ({ key: row.key, count: row.of(impact.data) })).filter(
          (row) => row.count > 0,
        );

  // Same defect class as ServiceDialog's close paths: `onOpenChange` only
  // fires from Radix's own wrapped setter (Escape, outside-click), never
  // from Cancel or the mutation's own `onSuccess` calling `setOpen` directly
  // — either of which would otherwise strand `dialogOpen` at `true` and hold
  // the poll forever. One `close()`, used by every path, closes that gap.
  const close = (): void => {
    setOpen(false);
    setDialogOpen(false);
  };

  // Claim-it-release-it, same as ServiceDialog: an unmount runs no click
  // handler and fires neither `onOpenChange` nor `remove`'s `onSuccess`, so
  // navigating away via the Rail while this dialog is open would otherwise
  // strand `dialogOpen` `true` for the rest of the session.
  useEffect(() => {
    return () => {
      setDialogOpen(false);
    };
  }, [setDialogOpen]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setOpen(true);
          setDialogOpen(true);
        } else {
          close();
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("action.remove")}</DialogTitle>
          <DialogDescription>{t("providers.remove-confirm", { name: service.name })}</DialogDescription>
        </DialogHeader>
        {impact.data !== undefined && (
          <div className="space-y-2 text-sm">
            {rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("providers.remove-impact.empty")}</p>
            ) : (
              <>
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  {t("providers.remove-impact.lead")}
                </p>
                <ul className="space-y-1">
                  {rows.map((row) => (
                    <li key={row.key} className="text-sm text-foreground">
                      {t(row.key, { count: row.count })}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            {t("action.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => {
              remove.mutate(service.id, { onSuccess: close });
            }}
          >
            {t("action.remove")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
