import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.tsx";
import { shortValue } from "@/components/settings/ConfigDiffView.tsx";
import { useConfigHistory, useRevertHistoryEntry } from "@/hooks/queries.ts";
import { formatDateTime } from "@/lib/format.ts";
import type { HistoryEntry } from "@/lib/types.ts";

type Notice = { text: string; tone: "ok" | "error" };

/** What moved, in a line a person can read: a whole provider, a credential, or `before → after`. */
function Movement({ entry }: { entry: HistoryEntry }) {
  const { t } = useTranslation();
  if (entry.kind === "service" && entry.field === "*") {
    return <span>{t(entry.before === null ? "config.history.service-added" : "config.history.service-removed")}</span>;
  }
  if (entry.kind === "credential") {
    return <span>{t(entry.after === "cleared" ? "config.history.credential-cleared" : "config.history.credential-set")}</span>;
  }
  return (
    <span className="font-mono break-words">
      {shortValue(entry.before)} → {shortValue(entry.after)}
    </span>
  );
}

/**
 * The configuration history (roadmap 5.7): every write, newest first, with the
 * actor and the value it replaced, and a button that writes that value back.
 * A restore is itself a write, so it shows up here as the next entry.
 */
export function HistoryDialog() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  const { data, isPending } = useConfigHistory(open);
  const revert = useRevertHistoryEntry();
  const entries = data?.entries ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setNotice(undefined);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {t("config.history.open")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[min(44rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>{t("config.history.title")}</DialogTitle>
          <DialogDescription>{t("config.history.description")}</DialogDescription>
        </DialogHeader>

        {notice !== undefined && (
          <p
            role={notice.tone === "error" ? "alert" : "status"}
            className={notice.tone === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
          >
            {notice.text}
          </p>
        )}

        {isPending ? (
          <p className="text-sm text-muted-foreground" role="status">{t("config.history.loading")}</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("config.history.empty")}</p>
        ) : (
          <ul className="flex max-h-[min(28rem,55vh)] flex-col divide-y divide-border overflow-y-auto">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 py-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm">
                    <span className="font-mono">{entry.target}</span>
                    {entry.field !== "*" && entry.kind !== "credential" && (
                      <span className="text-muted-foreground"> · {entry.field}</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <Movement entry={entry} />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(i18n.language, entry.at)} · {t("config.history.actor", { actor: entry.actor })}
                  </span>
                </div>
                {entry.revertible && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={revert.isPending}
                    aria-label={t("config.history.restore-label", {
                      target: entry.target,
                      field: entry.field === "*" ? "" : entry.field,
                    })}
                    onClick={() => {
                      setNotice(undefined);
                      revert.mutate(entry.id, {
                        onSuccess: () => setNotice({ text: t("config.history.restored"), tone: "ok" }),
                        onError: (error) =>
                          setNotice({ text: error instanceof Error ? error.message : String(error), tone: "error" }),
                      });
                    }}
                  >
                    {t("config.history.restore")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
