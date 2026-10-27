import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button.tsx";
import { usePreferences, usePreferencesMutation } from "@/hooks/queries.ts";
import { findAnchor, TOUR_STEPS } from "@/lib/tourSteps.ts";

const TOUR_EVENT = "isitdown:start-tour";
const CARD_WIDTH = 320;
const GAP = 12;

/** Starts the tour from anywhere: Settings' "Review the tour", the wizard's last step. */
export function startGuidedTour(): void {
  window.dispatchEvent(new Event(TOUR_EVENT));
}

interface Placement {
  top: number;
  left: number;
  ring: { top: number; left: number; width: number; height: number };
}

function place(element: HTMLElement): Placement {
  const rect = element.getBoundingClientRect();
  // Beside the anchor when there is room on the right (the rail), below it otherwise.
  const room = window.innerWidth - rect.right;
  const left =
    room >= CARD_WIDTH + GAP * 2
      ? rect.right + GAP
      : Math.min(Math.max(GAP, rect.left), window.innerWidth - CARD_WIDTH - GAP);
  const top = room >= CARD_WIDTH + GAP * 2 ? rect.top : rect.bottom + GAP;
  return {
    top: Math.min(Math.max(GAP, top), Math.max(GAP, window.innerHeight - 220)),
    left,
    ring: { top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 },
  };
}

/**
 * Coach marks on the real interface — roadmap 4.6. Mounted in the shell beside
 * the palette: it has to outlive the view it is pointing at. It starts by
 * itself once, after the wizard has handed over (`wizardDone` and not yet
 * `tourSeen`), so an installation that predates it is never interrupted; those
 * operators reach it from Settings.
 */
export function GuidedTour() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data: preferences } = usePreferences();
  // `mutate` is stable across renders; the mutation object is not, and an
  // effect that depends on it would re-measure on every render.
  const { mutate: patchPreferences } = usePreferencesMutation();
  const [index, setIndex] = useState<number | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const autoStarted = useRef(false);

  const finish = useCallback((): void => {
    setIndex(null);
    setPlacement(null);
    patchPreferences({ tourSeen: true });
  }, [patchPreferences]);

  useEffect(() => {
    const onStart = (): void => setIndex(0);
    window.addEventListener(TOUR_EVENT, onStart);
    return () => window.removeEventListener(TOUR_EVENT, onStart);
  }, []);

  useEffect(() => {
    if (autoStarted.current) return;
    if (preferences?.wizardDone === true && preferences.tourSeen === false) {
      autoStarted.current = true;
      setIndex(0);
    }
  }, [preferences]);

  const step = index === null ? undefined : TOUR_STEPS[index];

  // A step on another view takes the operator there first.
  useEffect(() => {
    if (step?.route !== undefined && pathname !== step.route) void navigate(step.route);
  }, [step, pathname, navigate]);

  // Anchor measured after the view had a frame to paint; a missing one is
  // skipped, and running out of steps ends the tour.
  useLayoutEffect(() => {
    if (index === null || step === undefined) return;
    const measure = (): void => {
      const element = findAnchor(step.anchor);
      if (element === null) return setPlacement(null);
      setPlacement(place(element));
    };
    measure();
    const retry = window.setTimeout(() => {
      if (findAnchor(step.anchor) === null) {
        if (index + 1 >= TOUR_STEPS.length) finish();
        else setIndex(index + 1);
      } else measure();
    }, 400);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(retry);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [index, step, finish]);

  useEffect(() => {
    if (placement !== null) nextRef.current?.focus();
  }, [placement, index]);

  if (index === null || step === undefined || placement === null) return null;
  const last = index === TOUR_STEPS.length - 1;

  const { ring } = placement;
  const [w, h] = [window.innerWidth, window.innerHeight];
  // Everything but the anchor: the frame, then the anchor's rectangle wound the
  // other way, so the even-odd rule leaves it unblurred.
  const veil = `polygon(evenodd, 0px 0px, ${w}px 0px, ${w}px ${h}px, 0px ${h}px, 0px 0px, ${ring.left}px ${ring.top}px, ${ring.left}px ${ring.top + ring.height}px, ${ring.left + ring.width}px ${ring.top + ring.height}px, ${ring.left + ring.width}px ${ring.top}px, ${ring.left}px ${ring.top}px)`;

  return (
    <>
      <div aria-hidden="true" className="tour-veil pointer-events-none fixed inset-0 z-40" style={{ clipPath: veil }} />
      <div
        aria-hidden="true"
        className="tour-ring pointer-events-none fixed z-50 rounded-xl border-2 border-primary shadow-[0_0_0_6px_color-mix(in_oklab,var(--color-primary)_25%,transparent)]"
        style={ring}
      />
      <div
        role="dialog"
        aria-label={t("tour.label", { step: index + 1, total: TOUR_STEPS.length })}
        className="tour-card fixed z-50 flex flex-col gap-3 rounded-xl border border-primary bg-popover p-4 text-popover-foreground shadow-lg"
        style={{ top: placement.top, left: placement.left, width: CARD_WIDTH }}
        onKeyDown={(event) => {
          if (event.key === "Escape") finish();
        }}
      >
        {/* Keyed by step so the words fade up on each one while the card itself glides. */}
        <div key={index} className="anim-panel flex flex-col gap-3">
          <span className="text-xs text-muted-foreground">
            {t("tour.progress", { step: index + 1, total: TOUR_STEPS.length })}
          </span>
          <p className="text-sm leading-relaxed">{t(step.labelKey)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={finish}>
            {t("tour.skip")}
          </Button>
          <span className="grow" />
          {index > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={() => setIndex(index - 1)}>
              {t("action.previous-step")}
            </Button>
          )}
          <Button
            ref={nextRef}
            type="button"
            size="sm"
            onClick={() => (last ? finish() : setIndex(index + 1))}
          >
            {t(last ? "tour.done" : "action.continue")}
          </Button>
        </div>
      </div>
    </>
  );
}
