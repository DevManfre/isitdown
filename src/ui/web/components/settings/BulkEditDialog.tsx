import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { ConfirmDialog } from "@/components/ConfirmDialog.tsx";
import { parseTags } from "@/components/ServiceDialog.tsx";
import { useSettingsToastReport } from "@/components/settings/SettingsToasts.tsx";
import { useServiceMutations } from "@/hooks/queries.ts";
import { useBusyControls, useFieldProps } from "@/hooks/useBusy.tsx";
import { slugify } from "@/lib/slugify.ts";

type Polling = "keep" | "on" | "off";
type Cadence = "keep" | "global" | "set";
type Grouping = "keep" | "set" | "clear";
type Muting = "keep" | "lift" | "30" | "120" | "480" | "1440";

/**
 * Several providers changed at once — roadmap 5.5. Every field starts on
 * "leave as it is", so the dialog only ever writes what the operator touched:
 * a bulk edit that set ten providers' groups should not also have reset their
 * cadence because the cadence box happened to be empty.
 *
 * Tags are added and removed rather than replaced, because the selection rarely
 * shares a tag list — "also critical" is the common question, and a replace
 * would wipe whatever else each one carried.
 */
export function BulkEditDialog({
  ids,
  trigger,
  onDone,
}: {
  ids: string[];
  trigger: ReactNode;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const { setDialogOpen } = useBusyControls();
  const fieldProps = useFieldProps();
  const { bulk } = useServiceMutations();
  const toast = useSettingsToastReport();

  const [open, setOpen] = useState(false);
  const [polling, setPolling] = useState<Polling>("keep");
  const [cadence, setCadence] = useState<Cadence>("keep");
  const [interval, setMinutesText] = useState("");
  const [grouping, setGrouping] = useState<Grouping>("keep");
  const [group, setGroup] = useState("");
  const [addTags, setAddTags] = useState("");
  const [removeTags, setRemoveTags] = useState("");
  const [muting, setMuting] = useState<Muting>("keep");
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    return () => setDialogOpen(false);
  }, [setDialogOpen]);

  const minutes = Number(interval);
  const intervalOk = cadence !== "set" || (Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440);
  const groupOk = grouping !== "set" || slugify(group) !== "";
  const body = {
    ids,
    patch: {
      ...(polling === "keep" ? {} : { enabled: polling === "on" }),
      ...(cadence === "keep" ? {} : { intervalMinutes: cadence === "global" ? null : minutes }),
      ...(grouping === "keep" ? {} : { group: grouping === "clear" ? null : slugify(group) }),
      ...(muting === "keep"
        ? {}
        : { mutedUntil: muting === "lift" ? null : new Date(Date.now() + Number(muting) * 60_000).toISOString() }),
    },
    addTags: parseTags(addTags),
    removeTags: parseTags(removeTags),
  };
  const changes = Object.keys(body.patch).length + body.addTags.length + body.removeTags.length;
  const dirty = changes > 0 || interval !== "" || group !== "";

  const reset = (): void => {
    setPolling("keep");
    setCadence("keep");
    setMinutesText("");
    setGrouping("keep");
    setGroup("");
    setAddTags("");
    setRemoveTags("");
    setMuting("keep");
    setError(undefined);
  };

  const close = (): void => {
    setOpen(false);
    setDialogOpen(false);
  };

  const requestClose = (): void => {
    if (dirty && !bulk.isPending) setConfirmDiscard(true);
    else close();
  };

  const apply = (): void => {
    setError(undefined);
    bulk.mutate(body, {
      onSuccess: () => {
        close();
        onDone();
        toast("services", { text: t("toast.service.bulk", { count: ids.length }), tone: "ok" });
      },
      onError: (failure) => setError(failure instanceof Error ? failure.message : String(failure)),
    });
  };

  const keep = <SelectItem value="keep">{t("bulk.keep")}</SelectItem>;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          reset();
          setOpen(true);
          setDialogOpen(true);
        } else requestClose();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("bulk.title", { count: ids.length })}</DialogTitle>
          <DialogDescription>{t("bulk.subtitle")}</DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-polling">{t("bulk.polling")}</Label>
            <Select value={polling} onValueChange={(next) => setPolling(next as Polling)}>
              <SelectTrigger id="bulk-polling">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {keep}
                <SelectItem value="on">{t("bulk.polling-on")}</SelectItem>
                <SelectItem value="off">{t("bulk.polling-off")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-cadence">{t("field.provider-interval")}</Label>
            <div className="flex gap-2">
              <Select value={cadence} onValueChange={(next) => setCadence(next as Cadence)}>
                <SelectTrigger id="bulk-cadence" className="w-48 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {keep}
                  <SelectItem value="global">{t("bulk.cadence-global")}</SelectItem>
                  <SelectItem value="set">{t("bulk.cadence-set")}</SelectItem>
                </SelectContent>
              </Select>
              {cadence === "set" && (
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  aria-label={t("bulk.cadence-minutes")}
                  aria-invalid={!intervalOk}
                  placeholder={t("bulk.cadence-minutes")}
                  value={interval}
                  onChange={(event) => setMinutesText(event.target.value)}
                  {...fieldProps}
                />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-group">{t("field.group")}</Label>
            <div className="flex gap-2">
              <Select value={grouping} onValueChange={(next) => setGrouping(next as Grouping)}>
                <SelectTrigger id="bulk-group" className="w-48 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {keep}
                  <SelectItem value="set">{t("bulk.group-set")}</SelectItem>
                  <SelectItem value="clear">{t("bulk.group-clear")}</SelectItem>
                </SelectContent>
              </Select>
              {grouping === "set" && (
                <Input
                  aria-label={t("field.group")}
                  aria-invalid={!groupOk}
                  placeholder={t("field.group-placeholder")}
                  value={group}
                  onChange={(event) => setGroup(event.target.value)}
                  {...fieldProps}
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bulk-add-tags">{t("bulk.add-tags")}</Label>
              <Input
                id="bulk-add-tags"
                placeholder={t("field.tags-placeholder")}
                value={addTags}
                onChange={(event) => setAddTags(event.target.value)}
                {...fieldProps}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bulk-remove-tags">{t("bulk.remove-tags")}</Label>
              <Input
                id="bulk-remove-tags"
                value={removeTags}
                onChange={(event) => setRemoveTags(event.target.value)}
                {...fieldProps}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bulk-mute">{t("action.mute")}</Label>
            <Select value={muting} onValueChange={(next) => setMuting(next as Muting)}>
              <SelectTrigger id="bulk-mute">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {keep}
                <SelectItem value="30">{t("mute.for-30")}</SelectItem>
                <SelectItem value="120">{t("mute.for-120")}</SelectItem>
                <SelectItem value="480">{t("mute.for-480")}</SelectItem>
                <SelectItem value="1440">{t("mute.for-1440")}</SelectItem>
                <SelectItem value="lift">{t("action.unmute")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </DialogBody>

        {error !== undefined && (
          <p role="alert" className="px-1 text-sm text-destructive">
            {t("toast.failed", { error })}
          </p>
        )}

        <ConfirmDialog
          open={confirmDiscard}
          onOpenChange={setConfirmDiscard}
          title={t("dialog.discard.title")}
          description={t("dialog.discard.body")}
          confirmLabel={t("action.discard")}
          cancelLabel={t("action.keep-editing")}
          onConfirm={close}
        />

        <DialogFooter className="sm:justify-between">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {changes === 0 ? t("bulk.nothing") : t("bulk.changes", { count: changes })}
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={requestClose}>
              {t("action.cancel")}
            </Button>
            <Button type="button" disabled={changes === 0 || !intervalOk || !groupOk || bulk.isPending} onClick={apply}>
              {t("bulk.apply", { count: ids.length })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
