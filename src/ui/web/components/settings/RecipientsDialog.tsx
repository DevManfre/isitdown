import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { ConfirmDialog } from "@/components/ConfirmDialog.tsx";
import { CHANNEL_NAME_KEYS } from "@/components/settings/ChannelRow.tsx";
import { useRecipientMutations } from "@/hooks/queries.ts";
import { useBusyControls } from "@/hooks/useBusy.tsx";
import type { DescribedChannel, Recipient } from "@/lib/types.ts";

/** A recipient as the form holds it: the id is worked out from the name on save. */
interface Draft {
  id: string;
  name: string;
  channels: string[];
}

const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * The ids a saved list carries: a recipient keeps the id it was saved with, a
 * new one takes its name's slug, made unique with a number when two names slug
 * the same. Never shown — the operator names people, not keys.
 */
function withIds(drafts: Draft[]): Recipient[] {
  const taken = new Set(drafts.map((draft) => draft.id).filter((id) => id !== ""));
  return drafts.map((draft) => {
    if (draft.id !== "") return { id: draft.id, name: draft.name.trim(), channels: draft.channels };
    const base = slugOf(draft.name) || "recipient";
    let id = base;
    for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
    taken.add(id);
    return { id, name: draft.name.trim(), channels: draft.channels };
  });
}

/** Why a draft cannot be saved, or null when it can. */
function problemOf(draft: Draft): "recipients.problem.name" | "recipients.problem.channels" | null {
  if (draft.name.trim() === "") return "recipients.problem.name";
  if (draft.channels.length < 2) return "recipients.problem.channels";
  return null;
}

/**
 * Recipients — roadmap 3.5 — behind a button, like the routing rules: a list of
 * people each with an ordered list of channels is an editor, not a row.
 *
 * Edited as a draft and saved as a whole, because that is how the server takes
 * it; a half-built recipient (a name and one channel) is not a state worth
 * persisting. Closing with unsaved changes asks first.
 */
export function RecipientsDialog({
  recipients,
  channels,
}: {
  recipients: Recipient[];
  channels: DescribedChannel[];
}) {
  const { t } = useTranslation();
  const { setDialogOpen } = useBusyControls();
  const save = useRecipientMutations().save;
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>(recipients);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [saved, setSaved] = useState(false);

  const dirty = JSON.stringify(drafts) !== JSON.stringify(recipients);
  const problems = drafts.map(problemOf);
  const blocked = problems.some((problem) => problem !== null);
  const used = new Set(drafts.flatMap((draft) => draft.channels));
  const channelName = (id: string): string => t(CHANNEL_NAME_KEYS[id] ?? id, { defaultValue: id });

  const close = (): void => {
    setOpen(false);
    setDialogOpen(false);
    setConfirmDiscard(false);
  };

  useEffect(() => {
    return () => {
      setDialogOpen(false);
    };
  }, [setDialogOpen]);

  const edit = (index: number, change: (draft: Draft) => Draft): void => {
    setSaved(false);
    setDrafts((previous) => previous.map((draft, at) => (at === index ? change(draft) : draft)));
  };

  const move = (list: string[], from: number, to: number): string[] => {
    const next = [...list];
    const [item] = next.splice(from, 1);
    if (item !== undefined) next.splice(to, 0, item);
    return next;
  };

  const onSave = (): void => {
    if (blocked) return;
    save.mutate(withIds(drafts), {
      onSuccess: (result) => {
        setDrafts(result.recipients);
        setSaved(true);
      },
    });
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) {
            setDrafts(recipients);
            setSaved(false);
            save.reset();
            setOpen(true);
            setDialogOpen(true);
          } else if (dirty) {
            setConfirmDiscard(true);
          } else {
            close();
          }
        }}
      >
        <DialogTrigger asChild>
          <Button type="button" variant="secondary" size="sm">
            {t("action.edit-recipients")}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-[min(40rem,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>{t("settings.recipients")}</DialogTitle>
            <DialogDescription>{t("recipients.note")}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-4">
              {drafts.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("recipients.empty")}</p>
              )}
              {drafts.map((draft, index) => {
                const problem = problems[index] ?? null;
                const problemId = `recipient-${index}-problem`;
                const addable = channels.filter((channel) => !used.has(channel.id));
                return (
                  <fieldset
                    key={index}
                    data-testid="recipient"
                    className="flex flex-col gap-3 rounded-md border border-border p-3"
                  >
                    <legend className="sr-only">{draft.name === "" ? t("recipients.unnamed") : draft.name}</legend>
                    <div className="flex items-center gap-2">
                      <Input
                        aria-label={t("recipients.name")}
                        placeholder={t("recipients.name-placeholder")}
                        maxLength={80}
                        value={draft.name}
                        aria-invalid={problem === "recipients.problem.name"}
                        aria-describedby={problem === null ? undefined : problemId}
                        onChange={(event) => edit(index, (current) => ({ ...current, name: event.target.value }))}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t("recipients.remove", { name: draft.name === "" ? t("recipients.unnamed") : draft.name })}
                        onClick={() => {
                          setSaved(false);
                          setDrafts((previous) => previous.filter((_, at) => at !== index));
                        }}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </div>

                    <ol className="flex flex-col gap-1">
                      {draft.channels.map((channelId, position) => (
                        <li key={channelId} className="flex items-center gap-2 text-sm">
                          <span className="w-24 shrink-0 text-xs text-muted-foreground">
                            {t(position === 0 ? "recipients.preferred" : "recipients.fallback")}
                          </span>
                          <span className="flex-1">{channelName(channelId)}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={position === 0}
                            aria-label={t("recipients.up", { channel: channelName(channelId) })}
                            onClick={() =>
                              edit(index, (current) => ({ ...current, channels: move(current.channels, position, position - 1) }))
                            }
                          >
                            <ArrowUp className="size-4" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={position === draft.channels.length - 1}
                            aria-label={t("recipients.down", { channel: channelName(channelId) })}
                            onClick={() =>
                              edit(index, (current) => ({ ...current, channels: move(current.channels, position, position + 1) }))
                            }
                          >
                            <ArrowDown className="size-4" aria-hidden="true" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t("recipients.drop", { channel: channelName(channelId) })}
                            onClick={() =>
                              edit(index, (current) => ({
                                ...current,
                                channels: current.channels.filter((id) => id !== channelId),
                              }))
                            }
                          >
                            <X className="size-4" aria-hidden="true" />
                          </Button>
                        </li>
                      ))}
                    </ol>

                    {addable.length > 0 && (
                      // Keyed on the list's length so the trigger resets to its
                      // prompt after every pick instead of showing the last one.
                      <Select
                        key={draft.channels.length}
                        onValueChange={(value) =>
                          edit(index, (current) => ({ ...current, channels: [...current.channels, value] }))
                        }
                      >
                        <SelectTrigger className="w-56" aria-label={t("recipients.add-channel")}>
                          <SelectValue placeholder={t("recipients.add-channel")} />
                        </SelectTrigger>
                        <SelectContent>
                          {addable.map((channel) => (
                            <SelectItem key={channel.id} value={channel.id}>
                              {channelName(channel.id)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    {problem !== null && (
                      <p id={problemId} className="text-xs text-muted-foreground">
                        {t(problem)}
                      </p>
                    )}
                  </fieldset>
                );
              })}

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => {
                  setSaved(false);
                  setDrafts((previous) => [...previous, { id: "", name: "", channels: [] }]);
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                {t("recipients.add")}
              </Button>

              {save.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {save.error instanceof Error ? save.error.message : String(save.error)}
                </p>
              )}
              {saved && !dirty && (
                <p role="status" className="text-sm text-muted-foreground">
                  {t("settings.saved")}
                </p>
              )}
            </div>
          </DialogBody>
          <DialogFooter showCloseButton>
            <Button type="button" onClick={onSave} disabled={!dirty || blocked || save.isPending}>
              {t("action.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t("dialog.discard.title")}
        description={t("dialog.discard.body")}
        confirmLabel={t("action.discard")}
        cancelLabel={t("action.keep-editing")}
        onConfirm={close}
      />
    </>
  );
}
