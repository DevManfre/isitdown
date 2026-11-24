import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { SettingRow } from "@/components/SettingRow.tsx";
import { NumberSetting } from "@/components/settings/NumberSetting.tsx";
import { useSettingsToastReport } from "@/components/settings/SettingsToasts.tsx";
import { useBackupSchedule } from "@/hooks/queries.ts";
import { formatRelative } from "@/lib/format.ts";
import type { BackupSchedule } from "@/lib/types.ts";

const KEEP_BOUNDS = { min: 1, max: 365 };

/**
 * Scheduled backups — roadmap 10.1. The download two rows up is the backup an
 * operator remembers to take; this is the one taken anyway, on a cron
 * expression, into a folder on the server.
 *
 * Four states, on the status line under the controls: loading (a skeleton,
 * never "never run"), never run, the last one failed (with why, announced),
 * and the last one that worked beside the next. A field the environment sets
 * is shown but not editable, with the variable named — saving it here would be
 * a value nothing reads.
 */
export function BackupScheduleRow() {
  const { t, i18n } = useTranslation();
  const toast = useSettingsToastReport();
  const { query, save, run } = useBackupSchedule();
  const schedule = query.data;
  const [cron_, setCron] = useState<string | undefined>(undefined);
  const [keep_, setKeep] = useState<number | undefined>(undefined);
  const cron = cron_ ?? schedule?.cron ?? "";
  const keep = keep_ ?? schedule?.keep ?? 7;
  const [cronError, setCronError] = useState<string | undefined>(undefined);

  const commit = (patch: { cron?: string; keep?: number }): void => {
    toast("data", undefined);
    save.mutate(patch, {
      onSuccess: () => {
        setCronError(undefined);
        setCron(undefined);
        setKeep(undefined);
        toast("data", { text: t("settings.saved"), tone: "ok" });
      },
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (patch.cron !== undefined) setCronError(message);
        else toast("data", { text: message, tone: "error" });
      },
    });
  };

  const commitCron = (): void => {
    if (schedule === undefined || cron.trim() === schedule.cron) return;
    commit({ cron: cron.trim() });
  };

  const commitKeep = (value: number): void => {
    if (!Number.isInteger(value) || value < KEEP_BOUNDS.min || value > KEEP_BOUNDS.max) {
      toast("data", {
        text: t("settings.out-of-range", { field: t("settings.backup-schedule.keep"), ...KEEP_BOUNDS }),
        tone: "error",
      });
      return;
    }
    if (value !== schedule?.keep) commit({ keep: value });
  };

  const runNow = (): void => {
    toast("data", undefined);
    run.mutate(undefined, {
      onSuccess: () => toast("data", { text: t("settings.backup-schedule.done"), tone: "ok" }),
      onError: (error) =>
        toast("data", { text: error instanceof Error ? error.message : String(error), tone: "error" }),
    });
  };

  const cronFromEnv = schedule?.source.cron === "env";
  const keepFromEnv = schedule?.source.keep === "env";

  return (
    <SettingRow
      label={t("settings.backup-schedule.label")}
      description={
        schedule === undefined
          ? t("settings.backup-schedule.hint-loading")
          : t("settings.backup-schedule.hint", { dir: schedule.dir })
      }
      status={<BackupStatus schedule={schedule} pending={query.isPending} error={query.error} onRetry={() => void query.refetch()} locale={i18n.language} />}
      align="top"
    >
      <div className="flex flex-col gap-1.5">
        <Input
          id="backup-cron"
          aria-label={t("settings.backup-schedule.cron")}
          aria-invalid={cronError !== undefined}
          aria-describedby={cronError !== undefined ? "backup-cron-error" : undefined}
          placeholder={t("settings.backup-schedule.cron-placeholder")}
          className="h-8 w-40 font-mono text-sm"
          value={cron}
          disabled={schedule === undefined || cronFromEnv || save.isPending}
          onChange={(event) => setCron(event.target.value)}
          onBlur={commitCron}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitCron();
          }}
        />
        {cronError !== undefined && (
          <span id="backup-cron-error" role="alert" className="max-w-56 text-xs text-destructive">
            {cronError}
          </span>
        )}
        {cronFromEnv && (
          <span className="text-xs text-muted-foreground">{t("settings.backup-schedule.from-env", { name: "BACKUP_CRON" })}</span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <NumberSetting
          id="backup-keep"
          label={t("settings.backup-schedule.keep")}
          unit={t("settings.backup-schedule.keep-unit")}
          min={KEEP_BOUNDS.min}
          max={KEEP_BOUNDS.max}
          value={keep}
          disabled={schedule === undefined || keepFromEnv}
          onChange={setKeep}
          onCommit={commitKeep}
        />
        {keepFromEnv && (
          <span className="text-xs text-muted-foreground">{t("settings.backup-schedule.from-env", { name: "BACKUP_KEEP" })}</span>
        )}
      </div>
      <Button type="button" variant="outline" size="sm" disabled={schedule === undefined || run.isPending} onClick={runNow}>
        {run.isPending ? t("settings.backup-schedule.running") : t("settings.backup-schedule.run")}
      </Button>
    </SettingRow>
  );
}

function BackupStatus({
  schedule,
  pending,
  error,
  onRetry,
  locale,
}: {
  schedule: BackupSchedule | undefined;
  pending: boolean;
  error: Error | null;
  onRetry: () => void;
  locale: string;
}) {
  const { t } = useTranslation();
  if (pending) return <Skeleton data-testid="backup-status-loading" className="h-4 w-48" />;
  if (schedule === undefined) {
    return (
      <span role="alert" className="inline-flex items-center gap-2 text-destructive">
        {t("settings.backup-schedule.load-failed", { detail: error?.message ?? "" })}
        <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onRetry}>
          {t("action.retry")}
        </Button>
      </span>
    );
  }

  const next =
    schedule.nextAt === null
      ? schedule.cron === ""
        ? t("settings.backup-schedule.off")
        : t("settings.backup-schedule.never-fires")
      : t("settings.backup-schedule.next", { time: formatRelative(locale, schedule.nextAt) });
  const uploads =
    schedule.uploads.length === 0
      ? ""
      : ` · ${t("settings.backup-schedule.uploads", { targets: schedule.uploads.map((target) => target.label).join(", ") })}`;

  if (schedule.lastError !== null) {
    return (
      <span data-testid="backup-status" role="alert" className="block text-destructive">
        {t("settings.backup-schedule.failed", {
          time: schedule.lastAttemptAt === null ? "" : formatRelative(locale, schedule.lastAttemptAt),
          detail: schedule.lastError,
        })}
        <span className="block text-muted-foreground">{next}{uploads}</span>
      </span>
    );
  }
  return (
    <span data-testid="backup-status" className="block text-muted-foreground">
      {schedule.lastOkAt === null
        ? t("settings.backup-schedule.never")
        : t("settings.backup-schedule.last", { time: formatRelative(locale, schedule.lastOkAt) })}
      {" · "}
      {next}
      {uploads}
    </span>
  );
}
