import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowDown, BellOff, BellRing, CircleCheck, CircleX, LoaderCircle, MoreHorizontal, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { usePollNow, useServiceMutations } from "@/hooks/queries.ts";
import { usePullToRefresh } from "@/hooks/usePullToRefresh.ts";
import { statusFill, statusLabelKey } from "@/lib/chartConfig.ts";
import { formatRelative } from "@/lib/format.ts";
import { isMuted } from "@/lib/mute.ts";
import { shownStatus } from "@/lib/suspicion.ts";
import type { ProviderStatus } from "@/lib/types.ts";
import { cn } from "@/lib/utils.ts";
import { ROUTE_PATHS } from "../../routePaths.ts";

/**
 * The phone's Overview — roadmap 4.29.
 *
 * Below 768px the desktop grid is a shrunken desktop. This is the same fleet
 * drawn for one thumb: what needs attention first, as rows tall enough to hit,
 * and everything healthy folded away under it. The rows, the menu and the pull
 * are all in the lower two thirds of the screen's reach, and nothing here is a
 * second source of truth — mute is the same write the Settings menu makes, and
 * the pull is the header's "poll now".
 *
 * Gated by CSS (`md:hidden`), not by `useIsMobile()`: that hook reports false on
 * its first render, so a JS gate would flash the desktop page on a phone.
 */

/** Width of the two buttons a swipe uncovers. */
const REVEAL_PX = 176;
/** A swipe past this on release stays open; short of it, it springs back. */
const OPEN_AT_PX = REVEAL_PX / 2;
/** How long the Undo bar waits before the mute stands unchallenged. */
const UNDO_MS = 6000;

const MENU_DURATIONS: { minutes: number; labelKey: string }[] = [
  { minutes: 30, labelKey: "mute.for-30" },
  { minutes: 120, labelKey: "mute.for-120" },
  { minutes: 480, labelKey: "mute.for-480" },
  { minutes: 1440, labelKey: "mute.for-1440" },
];

/** A shape per status, so the word is never the only thing that differs from colour. */
function StatusGlyph({ status }: { status: string }) {
  const style = { color: statusFill(status) };
  const props = { className: "size-6 shrink-0", style, "aria-hidden": true as const };
  if (status === "operational") return <CircleCheck {...props} />;
  if (status === "major_outage" || status === "partial_outage") return <CircleX {...props} />;
  return <TriangleAlert {...props} />;
}

function ProblemRow({
  provider,
  onMute,
}: {
  provider: ProviderStatus;
  onMute: (provider: ProviderStatus, minutes: number | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const shown = shownStatus(provider);
  const muted = isMuted(provider.mutedUntil);
  const [offset, setOffset] = useState(0);
  const drag = useRef<{ x: number; y: number; from: number; locked: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  const since = provider.activeIncidents[0]?.updatedAt;
  const names = provider.components.filter((c) => c.status !== "operational").map((c) => c.name);
  const detail = [t(statusLabelKey(shown.status)), names.slice(0, 2).join(", "), since ? formatRelative(i18n.language, since) : ""]
    .filter((part) => part !== "")
    .join(" · ");

  const settle = (minutes: number | null): void => {
    setOffset(0);
    onMute(provider, minutes);
  };

  return (
    <li className="relative overflow-hidden rounded-2xl bg-primary/20">
      {/* Behind the row, uncovered by the swipe. Not reachable while shut. */}
      <div
        className="absolute inset-y-0 right-0 grid grid-cols-2 text-sm font-semibold text-foreground"
        style={{ width: REVEAL_PX }}
        inert={offset === 0 ? true : undefined}
      >
        {muted ? (
          <Button type="button" variant="ghost" className="col-span-2 h-full rounded-none" onClick={() => settle(null)}>
            <BellRing aria-hidden="true" />
            {t("action.unmute")}
          </Button>
        ) : (
          <>
            <Button type="button" variant="ghost" className="h-full flex-col rounded-none" onClick={() => settle(60)}>
              <BellOff aria-hidden="true" />
              {t("mobile.mute-1h")}
            </Button>
            <Button type="button" variant="ghost" className="h-full flex-col rounded-none" onClick={() => settle(1440)}>
              <BellOff aria-hidden="true" />
              {t("mobile.mute-24h")}
            </Button>
          </>
        )}
      </div>

      <div
        data-status={shown.status}
        className={cn(
          "relative flex min-h-16 touch-pan-y items-center gap-3 rounded-2xl border border-border bg-card py-2 pl-3.5 pr-1",
          !dragging && "transition-transform duration-200 ease-out motion-reduce:transition-none",
        )}
        style={{
          transform: `translateX(${-offset}px)`,
          backgroundImage: `linear-gradient(color-mix(in srgb, ${statusFill(shown.status)} 12%, transparent), color-mix(in srgb, ${statusFill(shown.status)} 12%, transparent))`,
        }}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse") return;
          drag.current = { x: event.clientX, y: event.clientY, from: offset, locked: false };
        }}
        onPointerMove={(event) => {
          const d = drag.current;
          if (d === null) return;
          const dx = d.x - event.clientX;
          if (!d.locked) {
            // Vertical intent belongs to the page's scroll, not to this row.
            if (Math.abs(event.clientY - d.y) > Math.abs(dx) && Math.abs(event.clientY - d.y) > 8) {
              drag.current = null;
              return;
            }
            if (Math.abs(dx) < 8) return;
            d.locked = true;
            setDragging(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          setOffset(Math.max(0, Math.min(REVEAL_PX, d.from + dx)));
        }}
        onPointerUp={() => {
          if (drag.current?.locked) setOffset((current) => (current >= OPEN_AT_PX ? REVEAL_PX : 0));
          drag.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
          setOffset(0);
        }}
      >
        <StatusGlyph status={shown.status} />
        <Link to={ROUTE_PATHS.providerDetail.replace(":providerId", provider.id)} className="flex min-w-0 flex-1 flex-col py-1">
          <span className="truncate text-base font-semibold">{provider.name}</span>
          <span className="truncate text-sm text-muted-foreground">
            {muted ? `${t("mobile.muted")} · ` : ""}
            {detail}
          </span>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("mobile.row-options", { name: provider.name })}>
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {muted ? (
              <DropdownMenuItem onSelect={() => onMute(provider, null)}>{t("action.unmute")}</DropdownMenuItem>
            ) : (
              MENU_DURATIONS.map(({ minutes, labelKey }) => (
                <DropdownMenuItem key={minutes} onSelect={() => onMute(provider, minutes)}>
                  {t(labelKey)}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

export function MobileProblems({ providers }: { providers: ProviderStatus[] }) {
  const { t } = useTranslation();
  const poll = usePollNow();
  const { patch } = useServiceMutations();
  const pull = usePullToRefresh(() => poll.mutateAsync());
  const [showAll, setShowAll] = useState(false);
  const [undo, setUndo] = useState<{ id: string; name: string; minutes: number } | null>(null);

  const attention = providers.filter((p) => shownStatus(p).status !== "operational");
  const healthy = providers.filter((p) => shownStatus(p).status === "operational");

  useEffect(() => {
    if (undo === null) return;
    const timer = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  const mute = (provider: ProviderStatus, minutes: number | null): void => {
    patch.mutate({
      id: provider.id,
      patch: { mutedUntil: minutes === null ? null : new Date(Date.now() + minutes * 60_000).toISOString() },
    });
    setUndo(minutes === null ? null : { id: provider.id, name: provider.name, minutes });
  };

  const pullLabel =
    pull.state === "ready"
      ? t("mobile.pull.release")
      : pull.state === "polling"
        ? t("mobile.pull.polling")
        : pull.state === "done"
          ? t("mobile.pull.done")
          : pull.state === "failed"
            ? t("mobile.pull.failed")
            : t("mobile.pull.hint");

  return (
    <section className="mb-6 flex flex-col gap-3 md:hidden" aria-label={t("mobile.title")} data-mobile-overview>
      {/* The pull's own room: it opens the page down rather than overlaying it. */}
      <div
        className="flex flex-col items-center justify-end gap-1 overflow-hidden text-sm font-semibold text-primary"
        style={{ height: pull.distance }}
        role="status"
        aria-live="polite"
      >
        {pull.distance > 0 &&
          (pull.state === "polling" ? (
            <LoaderCircle className="size-6 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <ArrowDown className={cn("size-6 transition-transform", pull.state === "ready" && "rotate-180")} aria-hidden="true" />
          ))}
        {pull.distance > 0 && <span>{pullLabel}</span>}
      </div>

      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{t("mobile.attention")}</h3>
      {attention.length === 0 ? (
        <p className="flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-card px-4 text-base">
          <CircleCheck className="size-6 shrink-0" style={{ color: statusFill("operational") }} aria-hidden="true" />
          {t("mobile.all-clear")}
        </p>
      ) : (
        <>
          <ul className="flex flex-col gap-2.5">
            {attention.map((provider) => (
              <ProblemRow key={provider.id} provider={provider} onMute={mute} />
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">{t("mobile.swipe-hint")}</p>
        </>
      )}

      {healthy.length > 0 && (
        <>
          <div className="mt-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {t("mobile.operational", { count: healthy.length })}
            </h3>
            <Button type="button" variant="ghost" className="min-h-11 text-primary" aria-expanded={showAll} onClick={() => setShowAll((open) => !open)}>
              {showAll ? t("mobile.hide") : t("mobile.show-all")}
            </Button>
          </div>
          {showAll && (
            <ul className="overflow-hidden rounded-2xl border border-border bg-card">
              {healthy.map((provider) => (
                <li key={provider.id} className="border-b border-border last:border-b-0">
                  <Link to={ROUTE_PATHS.providerDetail.replace(":providerId", provider.id)} className="flex min-h-13 items-center gap-3 px-3.5">
                    <CircleCheck className="size-5 shrink-0" style={{ color: statusFill("operational") }} aria-hidden="true" />
                    <span className="flex-1 truncate">{provider.name}</span>
                    <span className="text-sm text-muted-foreground">{t("status.operational")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {undo !== null && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 flex min-h-13 items-center gap-2 rounded-2xl bg-foreground py-0 pl-4 pr-2 text-background shadow-lg"
        >
          <span className="flex-1 text-sm font-semibold">
            {t(undo.minutes >= 1440 ? "mobile.muted-24h" : "mobile.muted-1h", { name: undo.name })}
          </span>
          <Button
            type="button"
            variant="ghost"
            className="min-h-11 min-w-16 text-background hover:text-background"
            onClick={() => {
              patch.mutate({ id: undo.id, patch: { mutedUntil: null } });
              setUndo(null);
            }}
          >
            {t("action.undo")}
          </Button>
        </div>
      )}
    </section>
  );
}
