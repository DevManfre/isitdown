import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { ChangesDialog } from "@/components/settings/ChangesDialog.tsx";
import { useSnapshotMutations, useSnapshots } from "@/hooks/queries.ts";
import { formatRelative } from "@/lib/format.ts";
import type { ConfigSnapshot } from "@/lib/types.ts";

type Notice = { text: string; tone: "ok" | "error" };

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Named configuration snapshots (roadmap 5.8): save the fleet as it stands,
 * put it back later. Restoring goes through the same "what would change"
 * review as an import, and the server saves the configuration it replaces
 * first — so the confirmation says what will move and the result says where
 * the way back is.
 */
export function SnapshotsDialog() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  const [target, setTarget] = useState<ConfigSnapshot | undefined>(undefined);
  const { data, isPending } = useSnapshots(open);
  const { save, remove, preview, restore } = useSnapshotMutations();

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const clean = name.trim();
    if (clean === "") return;
    setNotice(undefined);
    save.mutate(clean, {
      onSuccess: (snapshot) => {
        setName("");
        setNotice({ text: t("config.snapshots.saved", { name: snapshot.name }), tone: "ok" });
      },
      onError: (error) => setNotice({ text: messageOf(error), tone: "error" }),
    });
  };

  const review = (snapshot: ConfigSnapshot): void => {
    setNotice(undefined);
    preview.reset();
    setTarget(snapshot);
    preview.mutate(snapshot.id);
  };

  const snapshots = data?.snapshots ?? [];

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setNotice(undefined);
        }}
      >
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            {t("config.snapshots.open")}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-[min(40rem,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>{t("config.snapshots.title")}</DialogTitle>
            <DialogDescription>{t("config.snapshots.description")}</DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="flex items-center gap-2">
            <Input
              value={name}
              maxLength={80}
              aria-label={t("config.snapshots.name")}
              placeholder={t("config.snapshots.name")}
              onChange={(event) => setName(event.target.value)}
              className="h-8"
            />
            <Button type="submit" size="sm" disabled={save.isPending || name.trim() === ""}>
              {t("config.snapshots.save")}
            </Button>
          </form>

          {notice !== undefined && (
            <p
              role={notice.tone === "error" ? "alert" : "status"}
              className={notice.tone === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
            >
              {notice.text}
            </p>
          )}

          {isPending ? (
            <p className="text-sm text-muted-foreground" role="status">{t("config.snapshots.loading")}</p>
          ) : snapshots.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("config.snapshots.empty")}</p>
          ) : (
            <ul className="flex max-h-72 flex-col divide-y divide-border overflow-y-auto">
              {snapshots.map((snapshot) => (
                <li key={snapshot.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{snapshot.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("config.snapshots.meta", {
                        count: snapshot.services,
                        time: formatRelative(i18n.language, snapshot.createdAt),
                      })}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button type="button" variant="secondary" size="sm" onClick={() => review(snapshot)}>
                      {t("action.restore")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t("config.snapshots.delete-label", { name: snapshot.name })}
                      disabled={remove.isPending}
                      onClick={() =>
                        remove.mutate(snapshot.id, {
                          onSuccess: () => setNotice({ text: t("config.snapshots.deleted"), tone: "ok" }),
                          onError: (error) => setNotice({ text: messageOf(error), tone: "error" }),
                        })
                      }
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Inside the content so Radix stacks it as a nested layer. */}
          <ChangesDialog
            open={target !== undefined}
            onOpenChange={(next) => {
              if (!next) setTarget(undefined);
            }}
            title={t("config.snapshots.restore.title", { name: target?.name ?? "" })}
            description={t("config.snapshots.description")}
            diff={preview.data}
            error={preview.isError ? messageOf(preview.error) : undefined}
            confirmLabel={t("config.snapshots.restore.confirm")}
            busy={restore.isPending}
            onConfirm={() => {
              if (target === undefined) return;
              restore.mutate(target.id, {
                onSuccess: ({ safety }) => {
                  setNotice({
                    text: t("config.snapshots.restored", { name: target.name, safety: safety.name }),
                    tone: "ok",
                  });
                  setTarget(undefined);
                },
                onError: (error) => {
                  setNotice({ text: messageOf(error), tone: "error" });
                  setTarget(undefined);
                },
              });
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
