import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog.tsx";
import { RoutingRules } from "@/components/RoutingRules.tsx";
import { useRoutingMutations } from "@/hooks/queries.ts";
import { useBusyControls } from "@/hooks/useBusy.tsx";
import type { DescribedChannel, RoutingResponse } from "@/lib/types.ts";

/**
 * The rules editor, behind a button.
 *
 * It is the one setting that does not belong in the settings column: its table
 * is `min-w-max` inside an `overflow-x-auto` box, i.e. it already admits that
 * it wants more width than a row can give it. In the section it is a row that
 * says how many rules there are; the editing happens here, with the Save
 * button `RoutingRules` already owns — a rules list mid-edit is not a state to
 * persist on keystroke.
 *
 * Poll handling is `ServiceDialog`'s, for `ServiceDialog`'s reasons: one
 * `close()` on every path (Radix's own setter fires `onOpenChange`, a
 * programmatic close does not), plus an unmount cleanup, because navigating
 * away via the Rail with this open would otherwise strand `dialogOpen` at
 * `true` for the rest of the session.
 */
export function RoutingRulesDialog({
  routing,
  channels,
  services,
}: {
  routing: RoutingResponse;
  channels: DescribedChannel[];
  services: { id: string; name: string }[];
}) {
  const { t } = useTranslation();
  const { setDialogOpen } = useBusyControls();
  const [open, setOpen] = useState(false);
  const save = useRoutingMutations().save;

  const close = (): void => {
    setOpen(false);
    setDialogOpen(false);
  };

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
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" size="sm">
          {t("action.edit-rules")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[min(56rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>{t("settings.routing")}</DialogTitle>
          {/* `RoutingRules` opens with `routing.note`, which says this at
              length; a visible description here would be the same sentence
              twice. Kept for the accessible name Radix wants. */}
          <DialogDescription className="sr-only">{t("routing.note")}</DialogDescription>
        </DialogHeader>
        <RoutingRules
          routing={routing}
          channels={channels}
          services={services}
          onSave={(rules) => save.mutateAsync(rules)}
          saving={save.isPending}
        />
      </DialogContent>
    </Dialog>
  );
}
