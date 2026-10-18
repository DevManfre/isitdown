import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";

/**
 * A controlled "are you sure" for an action that loses or overwrites
 * something the operator made — discarding a half-filled form, restoring a
 * backup over the live config.
 *
 * Controlled rather than trigger-owned (unlike `RemoveServiceDialog`): the
 * question is asked *in the middle* of another flow — an Escape on a dirty
 * dialog, a file the operator just picked — so there is no button of its own
 * to hang a `DialogTrigger` on. It replaces `window.confirm`, which cannot be
 * themed, translated with the rest of the page, or tested by role.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  focusAfter,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  /**
   * Where focus goes once it closes, when the control that opened it is gone
   * (a confirmed delete unmounts its own trash button). Left out, Radix returns
   * focus to whatever had it before.
   */
  focusAfter?: () => HTMLElement | null;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          const target = focusAfter?.();
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {cancelLabel ?? t("action.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
