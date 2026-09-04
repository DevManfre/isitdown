import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog.tsx";
import { useServiceMutations } from "@/hooks/queries.ts";
import { useBusyControls } from "@/hooks/useBusy.tsx";
import type { ServiceDefinition } from "@/lib/types.ts";

/**
 * A small yes/no dialog for removing a service, on the same `Dialog` the
 * service form uses — a port of `confirmModal` (modal.js), never the
 * browser's own `window.confirm`.
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
