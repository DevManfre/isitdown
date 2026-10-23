import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { filterLabel } from "@/components/DashboardGrid.tsx";
import { useStatus } from "@/hooks/queries.ts";
import type { DashboardResponse } from "@/lib/types.ts";
import { WIDGETS } from "@/widgets/registry.tsx";
import { widthLabelKey } from "@/widgets/widths.ts";
import type { DashboardLayout, WidgetConfig } from "../../../dashboardLayout.ts";
import { applyDraft, isDirty, startDraft, type Announcement, type DraftAction, type DraftResult, type Focus } from "../layoutDraft.ts";
import { CONCEAL_MS } from "./Reveal.tsx";
import { useStill } from "@/lib/still.ts";

/** How long a reverted arrangement glides back before the chrome folds away. */
const REVERT_MS = 340;
/**
 * Both reverts are confirmed in a dialog; the glide waits for it to finish
 * leaving (`modal-out` in motion.css), or half of it plays under the overlay.
 */
const DIALOG_OUT_MS = 220;
/** How long the new widget's ring says "here". */
const ARRIVAL_MS = 700;

export interface LayoutEditor {
  /** The draft, the copy it started from, and the version a save is checked against. */
  draft: ReturnType<typeof startDraft>;
  saved: DashboardLayout;
  base: string;
  isDefault: boolean;
  dirty: boolean;
  dispatch: (action: DraftAction) => DraftResult;
  /** "Load theirs" after a conflict: their copy becomes both the draft and the saved one. */
  adopt: (dashboard: DashboardResponse) => void;
  setBase: (base: string) => void;
  announce: { text: string; seq: number };
  filterOpen: string | null;
  toggleFilter: (id: string) => void;
  catalogOpen: boolean;
  setCatalogOpen: (open: boolean) => void;
  /** A widget was just added from the catalogue: it enters, and gets focus once the sheet is gone. */
  markAdded: (id: string) => void;
  /** Whether a just-added widget is waiting for the sheet to close. */
  hasAdded: () => boolean;
  /** Hand focus to the grip of a widget just added, once the catalogue has closed. */
  landAdded: () => void;
  entering: string | null;
  arrived: string | null;
  closing: boolean;
  /** Set as an exit starts, so the leave guard lets the deliberate one through. */
  leaving: RefObject<boolean>;
  exit: (notice?: string, revertTo?: DashboardLayout) => void;
}

/**
 * Edit mode's state, held by the Overview itself — roadmap 4.1.
 *
 * `dashboard` must be the server's answer, not the placeholder a pending query
 * shows: a draft started from the placeholder would edit the default layout and
 * save against no version at all.
 *
 * It lives above the grid rather than inside the editor so that one grid
 * draws both modes: entering edit mode adds chrome around widgets that stay
 * mounted, instead of swapping in a second grid whose every ring, bar and
 * counter would play its entry animation again.
 */
export function useLayoutEditor(
  dashboard: DashboardResponse | undefined,
  editing: boolean,
  grid: RefObject<HTMLElement | null>,
  onExit: (notice?: string) => void,
  /** Set by the control that opens edit mode, which unmounts as it does. */
  openedFrom: RefObject<boolean>,
): LayoutEditor | null {
  const { t } = useTranslation();
  const { data: status } = useStatus();
  const reduce = useStill();

  const [session, setSession] = useState<{
    draft: ReturnType<typeof startDraft>;
    saved: DashboardLayout;
    base: string;
    isDefault: boolean;
  } | null>(null);
  const draftRef = useRef(session?.draft ?? null);
  draftRef.current = session?.draft ?? null;
  const [announce, setAnnounce] = useState({ text: "", seq: 0 });
  const [focus, setFocus] = useState<Focus | null>(null);
  const [filterOpen, setFilterOpen] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [entering, setEntering] = useState<string | null>(null);
  const [arrived, setArrived] = useState<string | null>(null);
  const leaving = useRef(false);
  const addedGrip = useRef<string | null>(null);

  // A session starts from whatever the dashboard is when edit mode opens, and
  // ends with it: the next "Customise" starts clean.
  useEffect(() => {
    if (editing && dashboard !== undefined && session === null) {
      leaving.current = false;
      // The control that opened edit mode is gone: focus goes to the first
      // thing there is to edit. A page that loads straight into edit mode had
      // no such control, and does not take focus from wherever it is.
      if (openedFrom.current) {
        const first = dashboard.layout.widgets[0];
        setFocus(first === undefined ? { add: true } : { grip: first.id });
        openedFrom.current = false;
      }
      setSession({
        draft: startDraft(dashboard.layout),
        saved: dashboard.layout,
        base: dashboard.updatedAt,
        isDefault: dashboard.isDefault,
      });
    }
    if (!editing && session !== null) {
      setSession(null);
      setClosing(false);
      setFilterOpen(null);
      setCatalogOpen(false);
      setAnnounce({ text: "", seq: 0 });
    }
  }, [editing, dashboard, session]);

  const say = useCallback(
    (announcement: Announcement, before: readonly WidgetConfig[], after: readonly WidgetConfig[]) => {
      const widget = [...after, ...before].find((w) => w.id === announcement.widget);
      const values: Record<string, string | number> = { ...announcement.values };
      if (widget !== undefined) {
        values["widget"] = t(WIDGETS[widget.type].titleKey);
        if (announcement.key === "dashboard.announce.width") values["width"] = t(widthLabelKey(widget.width));
        if (announcement.key === "dashboard.announce.filter" && "filter" in widget.props) {
          values["filter"] = filterLabel(widget.props.filter, status, t);
        }
        if (announcement.key === "dashboard.announce.provider" && "provider" in widget.props) {
          const chosen = widget.props.provider;
          values["provider"] =
            chosen === null ? t("dashboard.provider.worst") : (status?.providers.find((p) => p.id === chosen)?.name ?? chosen);
        }
      }
      setAnnounce((previous) => ({ text: t(announcement.key, values), seq: previous.seq + 1 }));
    },
    [status, t],
  );

  const dispatch = useCallback(
    (action: DraftAction): DraftResult => {
      const before = draftRef.current ?? startDraft({ version: 1, widgets: [] });
      const result = applyDraft(before, action);
      draftRef.current = result.state;
      setSession((current) => (current === null ? current : { ...current, draft: result.state }));
      if (result.announcement !== null) say(result.announcement, before.layout.widgets, result.state.layout.widgets);
      if (result.focus !== null) setFocus(result.focus);
      if (action.type === "remove") setFilterOpen((open) => (open === action.id ? null : open));
      return result;
    },
    [say],
  );

  // A moved widget's DOM node is moved too, and a node taken out of the
  // document loses focus: put it back on the grip the edit was about.
  useLayoutEffect(() => {
    if (focus === null || catalogOpen) return;
    const target =
      "grip" in focus
        ? grid.current?.querySelector<HTMLElement>(`[data-grip="${CSS.escape(focus.grip)}"]`)
        : grid.current?.querySelector<HTMLElement>("[data-add-widget]");
    target?.focus();
    setFocus(null);
  }, [focus, catalogOpen, session, grid]);

  useEffect(() => {
    if (arrived === null) return;
    const timer = setTimeout(() => {
      setArrived(null);
      setEntering(null);
    }, ARRIVAL_MS);
    return () => clearTimeout(timer);
  }, [arrived]);

  if (!editing || session === null) return null;

  return {
    ...session,
    dirty: isDirty(session.saved, session.draft.layout),
    dispatch,
    adopt: (theirs) => {
      dispatch({ type: "replace", layout: theirs.layout });
      setSession((current) =>
        current === null ? current : { ...current, saved: theirs.layout, base: theirs.updatedAt, isDefault: theirs.isDefault },
      );
    },
    setBase: (base) => setSession((current) => (current === null ? current : { ...current, base })),
    announce,
    filterOpen,
    toggleFilter: (id) => setFilterOpen((open) => (open === id ? null : id)),
    catalogOpen,
    setCatalogOpen: (open) => {
      setCatalogOpen(open);
      if (open) setEntering(null);
    },
    landAdded: () => {
      const id = addedGrip.current;
      if (id === null) return;
      const grip = grid.current?.querySelector<HTMLElement>(`[data-grip="${CSS.escape(id)}"]`);
      grip?.focus({ preventScroll: true });
      grip?.closest("[data-slot=widget-cell]")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
      setArrived(id);
      addedGrip.current = null;
    },
    markAdded: (id) => {
      addedGrip.current = id;
      setEntering(id);
    },
    hasAdded: () => addedGrip.current !== null,
    entering,
    arrived,
    closing,
    leaving,
    /**
     * Leaving is two beats when the arrangement changes back (Cancel on a
     * dirty draft, Reset): the widgets glide back to where they will be first,
     * so the operator sees what was undone, and only then does the chrome fold
     * away. The cells are the same ones view mode draws, so the hand-over
     * itself moves nothing.
     */
    exit: (notice, revertTo) => {
      leaving.current = true;
      const fold = () => {
        setClosing(true);
        setTimeout(() => onExit(notice), reduce ? 0 : CONCEAL_MS);
      };
      const current = draftRef.current;
      if (revertTo !== undefined && current !== null && isDirty(revertTo, current.layout)) {
        setTimeout(
          () => {
            dispatch({ type: "replace", layout: revertTo });
            setTimeout(fold, reduce ? 0 : REVERT_MS);
          },
          reduce ? 0 : DIALOG_OUT_MS,
        );
      } else {
        fold();
      }
    },
  };
}
