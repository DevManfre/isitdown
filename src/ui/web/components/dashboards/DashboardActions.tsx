import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { useDashboardAdmin, useDashboards, useStatusChrome } from "@/hooks/queries.ts";
import { useBusyControls } from "@/hooks/useBusy.tsx";
import * as api from "@/lib/api.ts";
import { formatList } from "@/lib/format.ts";
import type { DashboardSummary, RemovedDashboard } from "@/lib/types.ts";
import type { DashboardLayout } from "../../../dashboardLayout.ts";
import { ROUTE_PATHS } from "../../../routePaths.ts";

/** Mirrors the server's ceilings (dashboardStore.ts); the server still enforces both. */
export const MAX_DASHBOARDS = 20;
const MAX_NAME_LENGTH = 60;
/** How long the notice — and with it Undo — stays. */
const NOTICE_MS = 8000;
const COMMAND_EVENT = "isitdown:dashboard-command";

/**
 * What the rail, the header's menu and ⌘K can ask for — roadmap 4.2. Commands
 * travel as an event to the one host mounted in the shell, for the reason the
 * palette's own open request does: the three askers are siblings, and the
 * dialogs and the Undo notice must outlive whichever view asked.
 */
export type DashboardCommand =
  | { kind: "create"; from?: string | undefined }
  | { kind: "import" }
  | { kind: "rename"; id: string }
  | { kind: "delete"; id: string }
  | { kind: "duplicate"; id: string }
  | { kind: "home"; id: string };

export function dashboardCommand(command: DashboardCommand): void {
  window.dispatchEvent(new CustomEvent<DashboardCommand>(COMMAND_EVENT, { detail: command }));
}

export const dashboardPath = (id: string): string => ROUTE_PATHS.overviewDashboard.replace(":dashboardId", id);

/** `base`, or `base (2)`, `base (3)`… — the first no dashboard is called, ignoring case. */
export function freeName(base: string, taken: readonly DashboardSummary[]): string {
  const used = new Set(taken.map((d) => d.name.toLowerCase()));
  let name = base.slice(0, MAX_NAME_LENGTH);
  for (let n = 2; used.has(name.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    name = `${base.slice(0, MAX_NAME_LENGTH - suffix.length)}${suffix}`;
  }
  return name;
}

type Start = "empty" | "copy" | "default";
const EMPTY_LAYOUT: DashboardLayout = { version: 1, widgets: [] };

interface Notice {
  text: string;
  undo?: RemovedDashboard;
}

/** A picked file, read and checked enough to preview; the server checks it in full. */
type ImportFile =
  | { ok: true; fileName: string; body: { name: string; layout: DashboardLayout } }
  | { ok: false; fileName: string; reason: "unreadable" | "not-export" };

function readExport(fileName: string, text: string): ImportFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, fileName, reason: "unreadable" };
  }
  const body = parsed as { format?: unknown; name?: unknown; layout?: { widgets?: unknown } } | null;
  if (
    body === null ||
    typeof body !== "object" ||
    body.format !== "isitdown.dashboard" ||
    typeof body.name !== "string" ||
    !Array.isArray(body.layout?.widgets)
  ) {
    return { ok: false, fileName, reason: "not-export" };
  }
  return { ok: true, fileName, body: parsed as { name: string; layout: DashboardLayout } };
}

/** Provider ids a layout names, in widget order, once each. */
function providersNamed(layout: DashboardLayout): string[] {
  const ids = layout.widgets.flatMap((w) =>
    "filter" in w.props ? w.props.filter.providers : "provider" in w.props && w.props.provider !== null ? [w.props.provider] : [],
  );
  return [...new Set(ids)];
}

/**
 * The named dashboards' dialogs and their notice — roadmap 4.2. Mounted once,
 * in the shell, beside the command palette.
 */
export function DashboardActions() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { setDialogOpen } = useBusyControls();
  const { data: dashboards = [] } = useDashboards();
  const { data: status } = useStatusChrome();
  const admin = useDashboardAdmin();

  const [dialog, setDialog] = useState<DashboardCommand | null>(null);
  const [name, setName] = useState("");
  const [start, setStart] = useState<Start>("empty");
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<ImportFile | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const home = dashboards.find((d) => d.home);
  const byId = (id: string | undefined) => dashboards.find((d) => d.id === id);
  const failed = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));
  /** A name clash the list already shows is said before the server is asked. */
  const clash = (candidate: string, except?: string): boolean =>
    dashboards.some((d) => d.id !== except && d.name.toLowerCase() === candidate.trim().toLowerCase());

  const close = (): void => {
    setDialog(null);
    setDialogOpen(false);
  };
  const done = (text: string, undo?: RemovedDashboard): void => setNotice(undo === undefined ? { text } : { text, undo });

  /** The layout to copy: whatever that dashboard draws, read through its own cache. */
  const layoutOf = (id: string): Promise<DashboardLayout> =>
    client.fetchQuery({ queryKey: ["dashboard", id], queryFn: () => api.getDashboard(id) }).then((d) => d.layout);

  useEffect(() => {
    const onCommand = (event: Event): void => {
      const command = (event as CustomEvent<DashboardCommand>).detail;
      if (command.kind === "duplicate") {
        const source = byId(command.id);
        if (source === undefined) return;
        void layoutOf(source.id)
          .then((layout) =>
            admin.create.mutateAsync({ name: freeName(t("dashboards.copy-name", { name: source.name }), dashboards), layout }),
          )
          .then((created) => {
            done(t("dashboards.done.duplicated", { name: created.name }));
            void navigate(dashboardPath(created.id));
          })
          .catch((cause: unknown) => done(t("dashboards.failed", { error: failed(cause) })));
        return;
      }
      if (command.kind === "home") {
        admin.makeHome.mutate(command.id, {
          onSuccess: (dashboard) => done(t("dashboards.done.home", { name: dashboard.name })),
          onError: (cause) => done(t("dashboards.failed", { error: failed(cause) })),
        });
        return;
      }
      setError(null);
      setFile(null);
      setStart("empty");
      setName(command.kind === "rename" ? (byId(command.id)?.name ?? "") : "");
      setDialog(command);
      setDialogOpen(true);
    };
    window.addEventListener(COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(COMMAND_EVENT, onCommand);
  });

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // Claim-it-release-it, as every other dialog here: an unmount fires no close.
  useEffect(() => () => setDialogOpen(false), [setDialogOpen]);

  const submitCreate = async (): Promise<void> => {
    const chosen = name.trim();
    if (clash(chosen)) {
      setError(t("dashboards.name-taken", { name: chosen }));
      return;
    }
    const from = (dialog?.kind === "create" ? dialog.from : undefined) ?? home?.id;
    try {
      const layout =
        start === "empty" ? EMPTY_LAYOUT : start === "copy" && from !== undefined ? await layoutOf(from) : undefined;
      const created = await admin.create.mutateAsync({ name: chosen, layout });
      close();
      done(t("dashboards.done.created", { name: created.name }));
      void navigate(dashboardPath(created.id));
    } catch (cause) {
      setError(failed(cause));
    }
  };

  const submitRename = (id: string): void => {
    const chosen = name.trim();
    if (clash(chosen, id)) {
      setError(t("dashboards.name-taken", { name: chosen }));
      return;
    }
    admin.rename.mutate(
      { id, name: chosen },
      {
        onSuccess: (dashboard) => {
          close();
          done(t("dashboards.done.renamed", { name: dashboard.name }));
        },
        onError: (cause) => setError(failed(cause)),
      },
    );
  };

  const submitDelete = (id: string): void => {
    admin.remove.mutate(id, {
      onSuccess: (removed) => {
        close();
        done(t("dashboards.done.deleted", { name: removed.name }), removed);
        // Off the page that no longer exists, onto home — wherever it moved to.
        void navigate(ROUTE_PATHS.overview);
      },
      onError: (cause) => setError(failed(cause)),
    });
  };

  const submitImport = (): void => {
    if (file === null || !file.ok) return;
    admin.import.mutate(file.body, {
      onSuccess: (dashboard) => {
        close();
        done(t("dashboards.done.imported", { name: dashboard.name }));
        void navigate(dashboardPath(dashboard.id));
      },
      onError: (cause) => setError(failed(cause)),
    });
  };

  const undo = (removed: RemovedDashboard): void => {
    setNotice(null);
    admin.restore.mutate(removed, {
      onSuccess: (dashboard) => {
        done(t("dashboards.done.restored", { name: dashboard.name }));
        void navigate(dashboardPath(dashboard.id));
      },
      onError: (cause) => done(t("dashboards.failed", { error: failed(cause) })),
    });
  };

  const target = dialog !== null && "id" in dialog ? byId(dialog.id) : undefined;
  const nextHome = dashboards.find((d) => d.id !== target?.id);
  const createFrom = byId((dialog?.kind === "create" ? dialog.from : undefined) ?? home?.id);
  const full = dashboards.length >= MAX_DASHBOARDS;
  const known = new Set((status?.providers ?? []).map((p) => p.id));
  const missing = file?.ok === true ? providersNamed(file.body.layout).filter((id) => !known.has(id)) : [];
  const pending =
    admin.create.isPending || admin.rename.isPending || admin.remove.isPending || admin.import.isPending;

  const nameField = (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="dashboard-name">{t("dashboards.name")}</Label>
      <Input
        ref={nameRef}
        id="dashboard-name"
        value={name}
        maxLength={MAX_NAME_LENGTH}
        placeholder={t("dashboards.name.placeholder")}
        aria-invalid={error !== null}
        aria-describedby={error !== null ? "dashboard-name-error" : undefined}
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
      />
      {error !== null && (
        <p id="dashboard-name-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );

  return (
    <>
      <Dialog open={dialog !== null} onOpenChange={(next) => !next && close()}>
        <DialogContent>
          {dialog?.kind === "create" && (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submitCreate();
              }}
            >
              <DialogHeader>
                <DialogTitle>{t("dashboards.create.title")}</DialogTitle>
                <DialogDescription>{t("dashboards.create.description")}</DialogDescription>
              </DialogHeader>
              {nameField}
              <fieldset className="flex flex-col gap-2">
                <legend className="pb-1.5 text-sm text-muted-foreground">{t("dashboards.start.legend")}</legend>
                <ToggleGroup
                  type="single"
                  value={start}
                  onValueChange={(value) => value !== "" && setStart(value as Start)}
                  className="flex w-full flex-col items-stretch gap-2"
                >
                  {(["empty", "copy", "default"] as const).map((option) => (
                    <ToggleGroupItem
                      key={option}
                      value={option}
                      disabled={option === "copy" && createFrom === undefined}
                      className="h-auto flex-col items-start gap-1 rounded-md border border-border px-3.5 py-3 text-left data-[state=on]:border-primary"
                    >
                      <span className="text-sm">
                        {option === "copy"
                          ? t("dashboards.start.copy", { name: createFrom?.name ?? "" })
                          : t(option === "empty" ? "dashboards.start.empty" : "dashboards.start.default")}
                      </span>
                      <span className="text-xs font-normal whitespace-normal text-muted-foreground">
                        {t(
                          option === "empty"
                            ? "dashboards.start.empty.hint"
                            : option === "copy"
                              ? "dashboards.start.copy.hint"
                              : "dashboards.start.default.hint",
                        )}
                      </span>
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </fieldset>
              <DialogFooter className="sm:justify-between">
                <Button type="button" variant="link" className="px-0" onClick={() => dashboardCommand({ kind: "import" })}>
                  {t("dashboards.action.import")}
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" onClick={close}>
                    {t("action.cancel")}
                  </Button>
                  <Button type="submit" disabled={pending || name.trim() === ""}>
                    {t("dashboards.create.confirm")}
                  </Button>
                </div>
              </DialogFooter>
            </form>
          )}

          {dialog?.kind === "rename" && target !== undefined && (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                submitRename(target.id);
              }}
            >
              <DialogHeader>
                <DialogTitle>{t("dashboards.rename.title")}</DialogTitle>
                <DialogDescription>{t("dashboards.rename.hint", { id: target.id })}</DialogDescription>
              </DialogHeader>
              {nameField}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={close}>
                  {t("action.cancel")}
                </Button>
                <Button type="submit" disabled={pending || name.trim() === ""}>
                  {t("action.save")}
                </Button>
              </DialogFooter>
            </form>
          )}

          {dialog?.kind === "delete" && target !== undefined && (
            <>
              <DialogHeader>
                <DialogTitle>{t("dashboards.delete.title", { name: target.name })}</DialogTitle>
                <DialogDescription>
                  {t("dashboards.delete.body")}
                  {target.home && nextHome !== undefined && ` ${t("dashboards.delete.home", { next: nextHome.name })}`}
                </DialogDescription>
              </DialogHeader>
              {error !== null && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={close}>
                  {t("action.cancel")}
                </Button>
                <Button type="button" variant="destructive" disabled={pending} onClick={() => submitDelete(target.id)}>
                  {t("dashboards.delete.confirm")}
                </Button>
              </DialogFooter>
            </>
          )}

          {dialog?.kind === "import" && (
            <>
              <DialogHeader>
                <DialogTitle>{t("dashboards.import.title")}</DialogTitle>
                <DialogDescription>{t("dashboards.import.hint")}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dashboard-import">{t("dashboards.import.file")}</Label>
                <Input
                  id="dashboard-import"
                  type="file"
                  accept="application/json,.json"
                  className="cursor-pointer"
                  onChange={(event) => {
                    const picked = event.target.files?.[0];
                    event.target.value = "";
                    if (picked === undefined) return;
                    setError(null);
                    void picked.text().then((text) => setFile(readExport(picked.name, text)));
                  }}
                />
              </div>
              {file?.ok === false && (
                <p role="alert" className="rounded-md border border-destructive px-3.5 py-3 text-sm">
                  {t(file.reason === "unreadable" ? "dashboards.import.unreadable" : "dashboards.import.not-export", {
                    file: file.fileName,
                  })}
                </p>
              )}
              {file?.ok === true && (
                <div className="flex flex-col gap-1 rounded-md border border-border px-3.5 py-3 text-sm">
                  <span>{file.fileName}</span>
                  <span className="text-xs text-muted-foreground">
                    {t("dashboards.import.preview", { name: file.body.name, count: file.body.layout.widgets.length })}
                  </span>
                  {clash(file.body.name) && (
                    <span className="text-xs text-muted-foreground">
                      {t("dashboards.import.renamed", { name: freeName(file.body.name, dashboards) })}
                    </span>
                  )}
                  {missing.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {t("dashboards.import.missing", {
                        count: missing.length,
                        providers: formatList(i18n.language, missing),
                      })}
                    </span>
                  )}
                </div>
              )}
              {error !== null && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              {full && <p className="text-sm text-muted-foreground">{t("dashboards.full", { max: MAX_DASHBOARDS })}</p>}
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={close}>
                  {t("action.cancel")}
                </Button>
                <Button type="button" disabled={pending || full || file?.ok !== true} onClick={submitImport}>
                  {t("dashboards.import.confirm")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <div
        role="status"
        className="pointer-events-none fixed right-4 bottom-20 z-50 flex justify-end md:right-8 md:bottom-8"
      >
        {notice !== null && (
          <div className="anim-fade pointer-events-auto flex items-center gap-3 rounded-xl border border-border bg-popover px-4 py-3 text-sm shadow-lg">
            <Check aria-hidden="true" className="size-4 text-[var(--status-operational)]" />
            <span>{notice.text}</span>
            {notice.undo !== undefined && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-primary"
                disabled={admin.restore.isPending}
                onClick={() => undo(notice.undo as RemovedDashboard)}
              >
                {t("dashboards.undo")}
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
