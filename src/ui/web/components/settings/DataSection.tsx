import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { ConfirmDialog } from "@/components/ConfirmDialog.tsx";
import { SettingRow } from "@/components/SettingRow.tsx";
import { SettingsSection } from "@/components/SettingsSection.tsx";
import { CatalogUpdatesRow } from "@/components/settings/CatalogUpdatesRow.tsx";
import { NumberSetting } from "@/components/settings/NumberSetting.tsx";
import { SECTION_REELS } from "@/components/settings/reels.ts";
import { SECTION_CASCADE } from "@/components/settings/sectionCascade.ts";
import { useSettingsToastReport } from "@/components/settings/SettingsToasts.tsx";
import {
  useConfigImport,
  useRestoreBackup,
  useSettingsMutation,
  useStorageMaintenance,
} from "@/hooks/queries.ts";
import { useFieldProps } from "@/hooks/useBusy.tsx";
import { formatBytes, formatRelative } from "@/lib/format.ts";
import { stagger } from "@/lib/stagger.ts";
import type { RuntimeConfigResponse, StorageReport } from "@/lib/types.ts";

/** Same reason as `POLLING_BOUNDS`: instant-apply must not fire a half-typed number at the server. */
const RETENTION_BOUNDS = { min: 7, max: 3650 };

/**
 * `storage` is read by the view, not here: its query starts with the page
 * rather than when this section mounts, so the cost figure is not a dash for
 * the first moments of every visit.
 */
export function DataSection({
  config,
  storage,
}: {
  config: RuntimeConfigResponse;
  storage: StorageReport | undefined;
}) {
  const { t, i18n } = useTranslation();
  const settingsMutation = useSettingsMutation();
  const storageMaintenance = useStorageMaintenance();
  const restoreBackup = useRestoreBackup();
  // The file picked for a restore, while the operator is asked to confirm it.
  const [pendingRestore, setPendingRestore] = useState<File | undefined>(undefined);
  // Apart from the file, so the dialog keeps its text while it animates out.
  const [restoreOpen, setRestoreOpen] = useState(false);
  const configImport = useConfigImport();
  const fieldProps = useFieldProps();
  const toast = useSettingsToastReport();
  const [retentionDays_, setRetentionDays] = useState<number | undefined>(
    undefined,
  );
  const retentionDays = retentionDays_ ?? config.retention.days;
  // Roadmap 15.11a. Optional, like `removed` above: a server from before this
  // existed answers without it, which reads as off with nothing to show.
  const updateCheck = config.updateCheck;
  const updateCheckEnabled = updateCheck?.enabled ?? false;

  /**
   * Reads the picked file and hands it to the server as it stands (roadmap
   * 4.3): the validation that matters is the file schema's, and it lives on the
   * server where the Light edition's loader already is.
   */
  const runImport = async (file: File): Promise<void> => {
    toast("data", undefined);
    try {
      const report = await configImport.mutateAsync(await file.text());
      toast("data", {
        text: t("settings.backup.imported", {
          added: report.added.length,
          updated: report.updated.length,
          removed: report.removed.length,
        }),
        tone: "ok",
      });
    } catch (error) {
      toast("data", {
        text: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    }
  };

  /**
   * Roadmap 4.4. The one destructive control on this page: it replaces every row
   * this edition stores. Asked first in a `ConfirmDialog` (`pendingRestore`):
   * `window.confirm` could not be themed, and read as a different product.
   */
  const runRestore = async (file: File): Promise<void> => {
    toast("data", undefined);
    try {
      const report = await restoreBackup.mutateAsync(file);
      const rows = Object.values(report.tables).reduce(
        (total, count) => total + count,
        0,
      );
      toast("data", {
        text: t("settings.restore.done", {
          providers: report.tables["services"] ?? 0,
          rows,
        }),
        tone: "ok",
      });
    } catch (error) {
      toast("data", {
        text: error instanceof Error ? error.message : String(error),
        tone: "error",
      });
    }
  };

  /**
   * Roadmap 6.13. The report is rendered rather than the query re-read for the
   * figure: `reclaimed` is a number only the run knows — the storage report
   * before and after it are two sizes, and subtracting them here would be a
   * second definition of what a vacuum returned.
   */
  const runMaintenance = (): void => {
    toast("data", undefined);
    storageMaintenance.mutate(undefined, {
      onSuccess: (report) => {
        if (!report.ok) {
          toast("data", {
            text: t("settings.maintenance.failed", {
              integrity: report.integrity,
            }),
            tone: "error",
          });
          return;
        }
        const current = formatBytes(i18n.language, report.bytesAfter);
        toast("data", {
          text:
            report.reclaimed === 0
              ? t("settings.maintenance.nothing", { current })
              : t("settings.maintenance.reclaimed", {
                  reclaimed: formatBytes(i18n.language, report.reclaimed),
                  current,
                }),
          tone: "ok",
        });
      },
      onError: (error) =>
        toast("data", {
          text: error instanceof Error ? error.message : String(error),
          tone: "error",
        }),
    });
  };

  /** Roadmap 2.2: the same shape as the update check below it. */
  const commitCatalogFeed = (enabled: boolean): void => {
    toast("data", undefined);
    settingsMutation.mutate(
      { catalogFeedEnabled: enabled },
      {
        onSuccess: () => toast("data", { text: t("settings.saved"), tone: "ok" }),
        onError: (error) =>
          toast("data", {
            text: error instanceof Error ? error.message : String(error),
            tone: "error",
          }),
      },
    );
  };

  /** Roadmap 15.11a: the switch is the whole form, so it applies on click. */
  const commitUpdateCheck = (enabled: boolean): void => {
    toast("data", undefined);
    settingsMutation.mutate(
      { updateCheckEnabled: enabled },
      {
        onSuccess: () =>
          toast("data", { text: t("settings.saved"), tone: "ok" }),
        onError: (error) =>
          toast("data", {
            text: error instanceof Error ? error.message : String(error),
            tone: "error",
          }),
      },
    );
  };

  const commitRetention = (days: number): void => {
    if (
      !Number.isInteger(days) ||
      days < RETENTION_BOUNDS.min ||
      days > RETENTION_BOUNDS.max
    ) {
      toast("data", {
        text: t("settings.out-of-range", {
          field: t("field.retention"),
          min: RETENTION_BOUNDS.min,
          max: RETENTION_BOUNDS.max,
        }),
        tone: "error",
      });
      return;
    }
    toast("data", undefined);
    settingsMutation.mutate(
      { retentionDays: days },
      {
        onSuccess: () =>
          toast("data", { text: t("settings.saved"), tone: "ok" }),
        onError: (error) =>
          toast("data", {
            text: error instanceof Error ? error.message : String(error),
            tone: "error",
          }),
      },
    );
  };

  return (
    <SettingsSection
      id="data"
      reel={SECTION_REELS.data}
      className="lg:col-span-3"
      title={t("settings.section.data")}
      delay={stagger(4, SECTION_CASCADE)}
    >
      <SettingRow
        label={t("field.retention")}
        description={t("field.retention.hint")}
        // The number that makes the choice a decision rather than a guess:
        // what this window costs, beside what the database already weighs.
        // A `status` rather than part of the hint, so compact density folds
        // the sentence away and leaves the figure.
        status={
          <span
            data-testid="retention-cost"
            className="block font-mono text-muted-foreground"
          >
            {storage === undefined
              ? "—"
              : t(
                  storage.measured
                    ? "settings.retention.cost"
                    : "settings.retention.cost-estimated",
                  {
                    projected: formatBytes(
                      i18n.language,
                      storage.bytesPerSample *
                        storage.samplesPerDay *
                        retentionDays,
                    ),
                    current: formatBytes(i18n.language, storage.dbBytes),
                  },
                )}
          </span>
        }
        align="top"
      >
        <NumberSetting
          id="retention-days"
          label={t("field.retention")}
          unit={t("unit.days")}
          min={RETENTION_BOUNDS.min}
          max={RETENTION_BOUNDS.max}
          value={retentionDays}
          onChange={setRetentionDays}
          onCommit={commitRetention}
          onFocus={fieldProps.onFocus}
          onBlur={fieldProps.onBlur}
        />
      </SettingRow>

      {/* Roadmap 6.13. The row above says what the database weighs and the
      daily prune deletes rows out of it — but sqlite keeps their pages,
      so that figure never moved after a large prune. This is the button
      that returns them, with the integrity check that has to pass first. */}
      <SettingRow
        label={t("settings.maintenance.label")}
        description={t("settings.maintenance.hint")}
        align="top"
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={storageMaintenance.isPending}
          onClick={runMaintenance}
        >
          {storageMaintenance.isPending
            ? t("settings.maintenance.running")
            : t("settings.maintenance.run")}
        </Button>
      </SettingRow>

      {/* Roadmap 4.3. Everything above is configurable here and nowhere else,
      which until now meant it lived only inside one SQLite file. The
      export is a Light edition config.yml — a backup and a migration
      path in the same file — and the import is that file read back. */}
      <SettingRow
        label={t("settings.backup.label")}
        description={t("settings.backup.hint")}
        align="top"
      >
        <Button asChild variant="outline" size="sm">
          <a href="/config/export">{t("settings.backup.export")}</a>
        </Button>
        {/* Roadmap 17.4. A second neighbour's format in the same card — not a
        new surface, the same download this row already offers in a shape
        Gatus reads. Probes translate; status-page providers are counted in
        the file's own header rather than silently dropped. */}
        <Button asChild variant="outline" size="sm">
          <a href="/export/gatus.yaml">{t("settings.backup.exportGatus")}</a>
        </Button>
        {/* A real, focusable file input rather than a hidden one behind a
        button: a hidden input is out of the tab order, which is exactly
        the kind of control 5.13 exists to stop adding. */}
        <Input
          id="config-import"
          type="file"
          accept=".yml,.yaml,text/yaml"
          aria-label={t("settings.backup.import")}
          className="h-8 w-56 cursor-pointer py-1 text-xs"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void runImport(file);
            // Cleared so picking the same file twice fires twice: a retry
            // after fixing the file is the common second pick.
            event.target.value = "";
          }}
        />
      </SettingRow>

      {/* Roadmap 4.4. The row above carries the configuration; this one
      carries everything — history, incidents, the delivery log — because
      it is the database itself. What it does not carry is the credentials
      file beside it, which the hint says outright rather than leaving to
      be discovered on the day it matters. */}
      <SettingRow
        label={t("settings.restore.label")}
        description={t("settings.restore.hint")}
        align="top"
      >
        <Button asChild variant="outline" size="sm">
          <a href="/config/backup">{t("settings.restore.download")}</a>
        </Button>
        <Input
          id="db-restore"
          type="file"
          accept=".db,application/octet-stream"
          aria-label={t("settings.restore.upload")}
          disabled={restoreBackup.isPending}
          className="h-8 w-56 cursor-pointer py-1 text-xs"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) {
              setPendingRestore(file);
              setRestoreOpen(true);
            }
            event.target.value = "";
          }}
        />
        <ConfirmDialog
          open={restoreOpen}
          onOpenChange={setRestoreOpen}
          title={t("settings.restore.upload")}
          description={t("settings.restore.confirm", { file: pendingRestore?.name ?? "" })}
          confirmLabel={t("action.restore")}
          onConfirm={() => {
            if (pendingRestore !== undefined) void runRestore(pendingRestore);
          }}
        />
      </SettingRow>

      {/* Roadmap 15.11a. Off by default: the switch is the whole form. The
      disclosure below is always visible, even with the switch off — what
      turning it on does must be understood before it is turned on. */}
      <SettingRow
        label={
          <span className="inline-flex items-center gap-2">
            {t("field.update-check")}
            {updateCheckEnabled &&
              updateCheck?.status === "available" &&
              updateCheck.latestVersion !== null && (
                <Badge variant="muted">
                  {t("settings.update-check.badge", {
                    version: updateCheck.latestVersion,
                  })}
                </Badge>
              )}
          </span>
        }
        description={t("field.update-check.hint")}
        status={
          updateCheckEnabled &&
          updateCheck !== undefined &&
          updateCheck.status !== "unknown" &&
          updateCheck.status !== "available" ? (
            <span className="text-muted-foreground">
              {updateCheck.status === "failed"
                ? t("settings.update-check.status.failed")
                : t("settings.update-check.status.current", {
                    version: updateCheck.currentVersion,
                    time:
                      updateCheck.checkedAt === null
                        ? ""
                        : formatRelative(i18n.language, updateCheck.checkedAt),
                  })}
            </span>
          ) : undefined
        }
        align="top"
      >
        <Switch
          id="update-check"
          aria-label={t("field.update-check")}
          checked={updateCheckEnabled}
          onCheckedChange={commitUpdateCheck}
        />
      </SettingRow>

      <CatalogUpdatesRow status={config.catalogFeed} onToggle={commitCatalogFeed} />
    </SettingsSection>
  );
}
