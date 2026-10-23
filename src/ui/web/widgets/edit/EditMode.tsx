import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker } from "react-router";
import { motion } from "motion/react";
import { RotateCcw } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { useDashboardMutations } from "@/hooks/queries.ts";
import { formatTime } from "@/lib/format.ts";
import type { DashboardResponse } from "@/lib/types.ts";
import { DEFAULT_LAYOUT } from "../../../dashboardLayout.ts";
import { isDirty } from "../layoutDraft.ts";
import { CONCEAL_MS, EASE_ENTRY, EASE_EXIT } from "./Reveal.tsx";
import type { LayoutEditor } from "./useLayoutEditor.ts";
import { WidgetCatalog } from "./WidgetCatalog.tsx";
import { useStill } from "@/lib/still.ts";

type Confirm = "discard" | "reset" | null;

/**
 * The parts of edit mode that are not on a widget — roadmap 4.1: the sticky
 * bar (state, announcements, Reset, Cancel, Save), the catalogue, the
 * conflict banner and every confirmation.
 *
 * Nothing reaches the server until Save. A save is checked against the version
 * the draft started from, so a second tab's save is a choice offered here, not
 * something silently overwritten.
 */
export default function EditMode({ editor, dashboard }: { editor: LayoutEditor; dashboard: DashboardResponse }) {
  const { t, i18n } = useTranslation();
  const reduce = useStill();
  const mutations = useDashboardMutations(dashboard.id);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [conflict, setConflict] = useState<DashboardResponse | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { dirty, closing } = editor;
  // A live region that mounts with its text already in it is not reliably
  // read, so the one that says edit mode has opened fills in after mount.
  const [opened, setOpened] = useState(false);
  useEffect(() => setOpened(true), []);
  const count = editor.draft.layout.widgets.length;

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      !editor.leaving.current &&
      (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
  );

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = async (against = editor.base) => {
    setSaveError(null);
    try {
      const result = await mutations.save.mutateAsync({ layout: editor.draft.layout, updatedAt: against });
      if (result.kind === "conflict") {
        setConflict(result.current);
        return;
      }
      editor.exit("dashboard.saved");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };

  const reset = async () => {
    setSaveError(null);
    try {
      await mutations.reset.mutateAsync();
      editor.exit("dashboard.reset-done", DEFAULT_LAYOUT);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    }
  };

  const pending = mutations.save.isPending || mutations.reset.isPending;

  return (
    <>
      <motion.div
        data-slot="edit-bar"
        role="region"
        aria-label={t("dashboard.bar.label")}
        initial={reduce ? false : { opacity: 0, y: "100%" }}
        animate={closing ? { opacity: 0, y: "100%" } : { opacity: 1, y: 0 }}
        transition={closing ? { duration: CONCEAL_MS / 1000, ease: EASE_EXIT } : { duration: 0.26, ease: EASE_ENTRY }}
        className="sticky bottom-0 z-10 -mx-4 mt-6 flex flex-col gap-3 border-t border-border bg-background/90 px-4 py-3 backdrop-blur md:-mx-8 md:px-8"
      >
        {conflict !== null && (
          <div
            role="alert"
            className="anim-fade flex flex-wrap items-center gap-3 rounded-lg border border-[var(--status-degraded-border)] bg-[var(--status-degraded-tint)] px-4 py-3"
          >
            <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-0.5">
              <span className="text-sm font-medium">
                {t("dashboard.conflict.title", { time: formatTime(i18n.language, conflict.updatedAt) })}
              </span>
              <span className="text-xs text-muted-foreground">{t("dashboard.conflict.body")}</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                editor.adopt(conflict);
                setConflict(null);
              }}
            >
              {t("dashboard.conflict.theirs")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                const against = conflict.updatedAt;
                editor.setBase(against);
                setConflict(null);
                void save(against);
              }}
            >
              {t("dashboard.conflict.mine")}
            </Button>
          </div>
        )}
        {saveError !== null && (
          <p role="alert" className="anim-fade text-sm text-[var(--status-major-outage)]">
            {t("dashboard.save-failed", { error: saveError })}
          </p>
        )}
        {dashboard.layoutInvalid === true && <p className="text-sm">{t("dashboard.invalid")}</p>}
        <p className="text-xs text-muted-foreground md:hidden">{t("dashboard.width.mobile-note")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-[1_1_16rem] flex-col gap-0.5">
            <span className="text-sm font-medium">{t(dirty ? "dashboard.bar.dirty" : "dashboard.bar.clean")}</span>
            <span role="status" aria-live="polite" className="min-h-4 font-mono text-xs text-muted-foreground">
              <span key={editor.announce.seq} className="anim-fade">
                {editor.announce.seq > 0 ? editor.announce.text : opened ? t("dashboard.edit.entered", { count }) : ""}
              </span>
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            disabled={pending || (editor.isDefault && !isDirty(DEFAULT_LAYOUT, editor.draft.layout))}
            onClick={() => setConfirm("reset")}
          >
            <RotateCcw aria-hidden="true" />
            {t("dashboard.reset")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => (dirty ? setConfirm("discard") : editor.exit())}
          >
            {t("action.cancel")}
          </Button>
          <Button type="button" disabled={!dirty || pending} onClick={() => void save()}>
            {t("action.save")}
          </Button>
        </div>
      </motion.div>

      <WidgetCatalog
        open={editor.catalogOpen}
        onOpenChange={editor.setCatalogOpen}
        widgets={editor.draft.layout.widgets}
        onAdd={(type) => {
          const { focus } = editor.dispatch({ type: "add", widgetType: type });
          if (focus !== null && "grip" in focus) editor.markAdded(focus.grip);
          editor.setCatalogOpen(false);
        }}
        onCloseAutoFocus={(event) => {
          // The new widget's grip, not the Add button, is where the operator
          // goes next — and the sheet would otherwise hand focus back to Add.
          if (!editor.hasAdded()) return;
          event.preventDefault();
          editor.landAdded();
        }}
      />

      <ConfirmDialog
        open={confirm === "discard"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t("dashboard.discard.title")}
        description={t("dashboard.discard.body")}
        confirmLabel={t("dashboard.discard.confirm")}
        cancelLabel={t("dashboard.discard.keep")}
        onConfirm={() => editor.exit(undefined, editor.saved)}
      />
      <ConfirmDialog
        open={confirm === "reset"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={t("dashboard.reset.title")}
        description={t("dashboard.reset.body")}
        confirmLabel={t("dashboard.reset.confirm")}
        onConfirm={() => void reset()}
      />
      <ConfirmDialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => !open && blocker.state === "blocked" && blocker.reset()}
        title={t("dashboard.leave.title")}
        description={t("dashboard.leave.body")}
        confirmLabel={t("dashboard.leave.confirm")}
        cancelLabel={t("dashboard.leave.stay")}
        onConfirm={() => blocker.state === "blocked" && blocker.proceed()}
      />
    </>
  );
}
