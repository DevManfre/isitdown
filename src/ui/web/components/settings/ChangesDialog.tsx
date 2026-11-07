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
import { ConfigDiffView } from "@/components/settings/ConfigDiffView.tsx";
import type { ConfigDiff } from "@/lib/types.ts";

/**
 * "Here is what this would change — go ahead?" for an import (roadmap 5.9) or a
 * snapshot restore (5.8). Controlled, like `ConfirmDialog`: the question comes
 * in the middle of another flow, with no trigger of its own. The confirm button
 * stays enabled for an empty diff — applying a file that changes nothing is
 * harmless, and a disabled button with no reason is worse than one that works.
 */
export function ChangesDialog({
  open,
  onOpenChange,
  title,
  description,
  diff,
  error,
  confirmLabel,
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** Undefined while the diff is being worked out. */
  diff: ConfigDiff | undefined;
  /** Why there is no diff: the server refused the file. */
  error?: string | undefined;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(40rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error !== undefined ? (
          <p role="alert" className="font-mono text-xs break-words text-destructive">{error}</p>
        ) : diff === undefined ? (
          <p className="text-sm text-muted-foreground" role="status">{t("config.changes.review")}…</p>
        ) : (
          <ConfigDiffView diff={diff} />
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t("action.cancel")}
          </Button>
          <Button type="button" disabled={diff === undefined || error !== undefined || busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
