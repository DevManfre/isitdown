import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { ConfirmDialog } from "@/components/ConfirmDialog.tsx";
import { useSettingsToastReport } from "@/components/settings/SettingsToasts.tsx";
import { useServiceMutations } from "@/hooks/queries.ts";
import { useBusyControls, useFieldProps } from "@/hooks/useBusy.tsx";
import { formatDateTime } from "@/lib/format.ts";
import type { MuteSchedule, OperatorMaintenanceWindow, ServiceDefinition, Weekday } from "@/lib/types.ts";

const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** A weekday's short name in the dashboard's language. 2024-01-01 was a Monday. */
const weekdayLabel = (locale: string, day: Weekday): string =>
  new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, 0, 1 + WEEKDAYS.indexOf(day))),
  );

/** A `datetime-local` value, read in the browser's own zone, as an instant — or null. */
const instantOf = (local: string): string | null => {
  if (local === "") return null;
  const at = new Date(local);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
};

const browserZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Planned mutes and declared maintenance for one provider — roadmap 5.2 and 5.3.
 *
 * One dialog for both because they answer the same question ("when should this
 * provider be quiet?") and differ only in how loudly: a mute is silence, a
 * declared window is silence that is announced and drawn on the timeline. Kept
 * out of `ServiceDialog`, which is the provider's identity and wiring; this is
 * its calendar.
 *
 * Edits stay local until Save, so a half-built list can be thrown away — and a
 * close with anything changed asks first, like every dialog that holds a form.
 */
export function ScheduleDialog({ service, trigger }: { service: ServiceDefinition; trigger: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { setDialogOpen } = useBusyControls();
  const fieldProps = useFieldProps();
  const { patch } = useServiceMutations();
  const toast = useSettingsToastReport();

  const [open, setOpen] = useState(false);
  const [mutes, setMutes] = useState<MuteSchedule[]>([]);
  const [windows, setWindows] = useState<OperatorMaintenanceWindow[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // The mute being composed.
  const [muteKind, setMuteKind] = useState<"weekly" | "once">("weekly");
  const [days, setDays] = useState<Weekday[]>([]);
  const [start, setStart] = useState("02:00");
  const [end, setEnd] = useState("04:00");
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [muteProblem, setMuteProblem] = useState<string | undefined>(undefined);

  // The window being composed.
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [windowProblem, setWindowProblem] = useState<string | undefined>(undefined);

  const stored = JSON.stringify([service.muteSchedules ?? [], service.maintenanceWindows ?? []]);
  const dirty = JSON.stringify([mutes, windows]) !== stored;

  useEffect(() => {
    return () => setDialogOpen(false);
  }, [setDialogOpen]);

  const openDialog = (): void => {
    setMutes(service.muteSchedules ?? []);
    setWindows(service.maintenanceWindows ?? []);
    setDays([]);
    setFrom("");
    setUntil("");
    setTitle("");
    setStartsAt("");
    setEndsAt("");
    setMuteProblem(undefined);
    setWindowProblem(undefined);
    setError(undefined);
    setOpen(true);
    setDialogOpen(true);
  };

  const close = (): void => {
    setOpen(false);
    setDialogOpen(false);
  };

  const requestClose = (): void => {
    if (dirty && !patch.isPending) setConfirmDiscard(true);
    else close();
  };

  const addMute = (): void => {
    if (muteKind === "weekly") {
      if (days.length === 0) return setMuteProblem(t("schedule.mute.need-days"));
      if (start === "" || end === "" || start === end) return setMuteProblem(t("schedule.mute.need-times"));
      setMutes((list) => [...list, { days: WEEKDAYS.filter((day) => days.includes(day)), start, end, timeZone: browserZone() }]);
      setDays([]);
    } else {
      const fromAt = instantOf(from);
      const untilAt = instantOf(until);
      if (fromAt === null || untilAt === null || fromAt >= untilAt) return setMuteProblem(t("schedule.need-order"));
      setMutes((list) => [...list, { from: fromAt, until: untilAt }]);
      setFrom("");
      setUntil("");
    }
    setMuteProblem(undefined);
  };

  const addWindow = (): void => {
    const startAt = instantOf(startsAt);
    const endAt = instantOf(endsAt);
    if (startAt === null || endAt === null || startAt >= endAt) return setWindowProblem(t("schedule.need-order"));
    setWindows((list) => [...list, { title: title.trim(), startsAt: startAt, endsAt: endAt }]);
    setTitle("");
    setStartsAt("");
    setEndsAt("");
    setWindowProblem(undefined);
  };

  const save = (): void => {
    setError(undefined);
    patch.mutate(
      {
        id: service.id,
        // Null, not an empty list: an emptied calendar is "no schedule", which
        // the server stores as the field being absent.
        patch: {
          muteSchedules: mutes.length === 0 ? null : mutes,
          maintenanceWindows: windows.length === 0 ? null : windows,
        },
      },
      {
        onSuccess: () => {
          close();
          toast("services", { text: t("toast.service.saved", { name: service.name }), tone: "ok" });
        },
        onError: (failure) => setError(failure instanceof Error ? failure.message : String(failure)),
      },
    );
  };

  const describeMute = (mute: MuteSchedule): string =>
    "from" in mute
      ? t("schedule.mute.once-row", {
          from: formatDateTime(i18n.language, mute.from),
          until: formatDateTime(i18n.language, mute.until),
        })
      : t("schedule.mute.weekly-row", {
          days: mute.days.map((day) => weekdayLabel(i18n.language, day)).join(", "),
          start: mute.start,
          end: mute.end,
          zone: mute.timeZone,
        });

  const now = Date.now();

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? openDialog() : requestClose())}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("schedule.title", { name: service.name })}</DialogTitle>
          <DialogDescription>{t("schedule.subtitle")}</DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-md border border-border p-3.5" aria-labelledby="schedule-mutes">
            <h3 id="schedule-mutes" className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              {t("schedule.mute.heading")}
            </h3>
            <span className="text-xs text-muted-foreground">{t("schedule.mute.hint")}</span>
            {mutes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("schedule.mute.empty")}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {mutes.map((mute, index) => (
                  <li key={JSON.stringify(mute)} className="flex items-center justify-between gap-2 text-sm">
                    <span>{describeMute(mute)}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("schedule.remove", { what: describeMute(mute) })}
                      onClick={() => setMutes((list) => list.filter((_, at) => at !== index))}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <ToggleGroup
              type="single"
              aria-label={t("schedule.mute.kind")}
              value={muteKind}
              onValueChange={(next) => {
                if (next === "weekly" || next === "once") setMuteKind(next);
              }}
            >
              <ToggleGroupItem value="weekly">{t("schedule.mute.weekly")}</ToggleGroupItem>
              <ToggleGroupItem value="once">{t("schedule.mute.once")}</ToggleGroupItem>
            </ToggleGroup>

            {muteKind === "weekly" ? (
              <div className="flex flex-col gap-2">
                <ToggleGroup
                  type="multiple"
                  className="max-w-full flex-wrap"
                  aria-label={t("schedule.mute.days")}
                  value={days}
                  onValueChange={(next) => setDays(next as Weekday[])}
                >
                  {WEEKDAYS.map((day) => (
                    <ToggleGroupItem key={day} value={day}>
                      {weekdayLabel(i18n.language, day)}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="schedule-start">{t("schedule.mute.start")}</Label>
                    <Input id="schedule-start" type="time" value={start} onChange={(event) => setStart(event.target.value)} {...fieldProps} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="schedule-end">{t("schedule.mute.end")}</Label>
                    <Input id="schedule-end" type="time" value={end} onChange={(event) => setEnd(event.target.value)} {...fieldProps} />
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">{t("schedule.mute.zone", { zone: browserZone() })}</span>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="schedule-from">{t("schedule.from")}</Label>
                  <Input id="schedule-from" type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} {...fieldProps} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="schedule-until">{t("schedule.until")}</Label>
                  <Input
                    id="schedule-until"
                    type="datetime-local"
                    value={until}
                    aria-invalid={muteProblem !== undefined}
                    aria-describedby={muteProblem === undefined ? undefined : "schedule-mute-problem"}
                    onChange={(event) => setUntil(event.target.value)}
                    {...fieldProps}
                  />
                </div>
              </div>
            )}
            {muteProblem !== undefined && (
              <p id="schedule-mute-problem" role="alert" className="text-sm text-destructive">
                {muteProblem}
              </p>
            )}
            <div>
              <Button type="button" variant="secondary" size="sm" onClick={addMute}>
                {t("schedule.mute.add")}
              </Button>
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-md border border-border p-3.5" aria-labelledby="schedule-windows">
            <h3 id="schedule-windows" className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
              {t("schedule.window.heading")}
            </h3>
            <span className="text-xs text-muted-foreground">{t("schedule.window.hint")}</span>
            {windows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("schedule.window.empty")}</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {windows.map((window, index) => {
                  const row = t("schedule.window.row", {
                    title: window.title === "" ? t("schedule.window.untitled") : window.title,
                    from: formatDateTime(i18n.language, window.startsAt),
                    until: formatDateTime(i18n.language, window.endsAt),
                  });
                  const over = Date.parse(window.endsAt) <= now;
                  return (
                    <li key={`${window.startsAt}/${window.endsAt}`} className="flex items-center justify-between gap-2 text-sm">
                      <span className={over ? "text-muted-foreground" : undefined}>
                        {row}
                        {over && ` · ${t("schedule.window.over")}`}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("schedule.remove", { what: row })}
                        onClick={() => setWindows((list) => list.filter((_, at) => at !== index))}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="schedule-title">{t("schedule.window.title")}</Label>
              <Input
                id="schedule-title"
                maxLength={120}
                placeholder={t("schedule.window.title-placeholder")}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                {...fieldProps}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="schedule-starts">{t("schedule.from")}</Label>
                <Input id="schedule-starts" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} {...fieldProps} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="schedule-ends">{t("schedule.until")}</Label>
                <Input
                  id="schedule-ends"
                  type="datetime-local"
                  value={endsAt}
                  aria-invalid={windowProblem !== undefined}
                  aria-describedby={windowProblem === undefined ? undefined : "schedule-window-problem"}
                  onChange={(event) => setEndsAt(event.target.value)}
                  {...fieldProps}
                />
              </div>
            </div>
            {windowProblem !== undefined && (
              <p id="schedule-window-problem" role="alert" className="text-sm text-destructive">
                {windowProblem}
              </p>
            )}
            <div>
              <Button type="button" variant="secondary" size="sm" onClick={addWindow}>
                {t("schedule.window.add")}
              </Button>
            </div>
          </section>
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

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={requestClose}>
            {t("action.cancel")}
          </Button>
          <Button type="button" disabled={!dirty || patch.isPending} onClick={save}>
            {t("action.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
