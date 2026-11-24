import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import type { BackupSchedule } from "@/lib/types.ts";
import { BackupScheduleRow } from "./BackupScheduleRow.tsx";

afterEach(() => vi.unstubAllGlobals());

const schedule = (over: Partial<BackupSchedule> = {}): BackupSchedule => ({
  cron: "",
  keep: 7,
  dir: "/app/data/backups",
  source: { cron: "default", keep: "default" },
  uploads: [],
  nextAt: null,
  lastAttemptAt: null,
  lastOkAt: null,
  lastFile: null,
  lastError: null,
  ...over,
});

const writes = (): string[] =>
  (vi.mocked(fetch).mock.calls as unknown as [string, RequestInit | undefined][])
    .filter(([, init]) => init?.method !== undefined && init.method !== "GET")
    .map(([path, init]) => `${init?.method} ${path} ${typeof init?.body === "string" ? init.body : ""}`.trim());

describe("scheduled backups in Settings (roadmap 10.1)", () => {
  it("shows a skeleton while loading, never 'never run'", async () => {
    renderWithProviders(<BackupScheduleRow />, { backupSchedule: schedule() });
    // Synchronously after mount: the request has not answered yet.
    expect(screen.getByTestId("backup-status-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("backup-status")).not.toBeInTheDocument();
    expect(await screen.findByTestId("backup-status")).toBeInTheDocument();
  });

  it("says it is off and has never run on a fresh instance, and names the folder", async () => {
    renderWithProviders(<BackupScheduleRow />, { backupSchedule: schedule() });
    const status = await screen.findByTestId("backup-status");
    expect(status).toHaveTextContent(i18n.t("settings.backup-schedule.never"));
    expect(status).toHaveTextContent(i18n.t("settings.backup-schedule.off"));
    expect(screen.getByText(i18n.t("settings.backup-schedule.hint", { dir: "/app/data/backups" }))).toBeInTheDocument();
  });

  it("announces the last failure with its reason", async () => {
    renderWithProviders(<BackupScheduleRow />, {
      backupSchedule: schedule({ cron: "0 3 * * *", lastAttemptAt: new Date().toISOString(), lastError: "ENOSPC: no space left" }),
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ENOSPC: no space left");
  });

  it("shows the last good backup beside the next one", async () => {
    const lastOkAt = new Date(Date.now() - 3_600_000).toISOString();
    const nextAt = new Date(Date.now() + 3_600_000).toISOString();
    renderWithProviders(<BackupScheduleRow />, { backupSchedule: schedule({ cron: "0 3 * * *", lastOkAt, nextAt }) });
    const status = await screen.findByTestId("backup-status");
    expect(status).not.toHaveTextContent(i18n.t("settings.backup-schedule.never"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("saves a schedule on Enter, and runs one now on the button", async () => {
    renderWithProviders(<BackupScheduleRow />, { backupSchedule: schedule() });
    const input = await screen.findByRole("textbox", { name: i18n.t("settings.backup-schedule.cron") });
    await waitFor(() => expect(input).toBeEnabled());
    await userEvent.type(input, "0 3 * * *{Enter}");
    await waitFor(() => expect(writes()).toContain('PUT /config/backup/schedule {"cron":"0 3 * * *"}'));
    await userEvent.click(screen.getByRole("button", { name: i18n.t("settings.backup-schedule.run") }));
    await waitFor(() => expect(writes()).toContain("POST /config/backup/run"));
  });

  it("locks a field the environment sets, and says which variable", async () => {
    renderWithProviders(<BackupScheduleRow />, {
      backupSchedule: schedule({ cron: "0 4 * * *", source: { cron: "env", keep: "default" } }),
    });
    const input = await screen.findByRole("textbox", { name: i18n.t("settings.backup-schedule.cron") });
    await waitFor(() => expect(input).toHaveValue("0 4 * * *"));
    expect(input).toBeDisabled();
    expect(screen.getByText(i18n.t("settings.backup-schedule.from-env", { name: "BACKUP_CRON" }))).toBeInTheDocument();
  });
});
