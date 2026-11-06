import { useEffect, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { usePollNow, useStatusChrome } from "@/hooks/queries.ts";
import { useLive, useStreamLost } from "@/hooks/useLive.tsx";
import { msUntilNextPoll } from "@/lib/statusRefetch.ts";
import { cn } from "@/lib/utils.ts";

export function PollIndicator() {
  const { t } = useTranslation();
  const { data: status, dataUpdatedAt } = useStatusChrome();
  const poll = usePollNow();
  const live = useLive();
  const lost = useStreamLost();
  // Re-renders once a second so the countdown ticks without refetching.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Corrected for any disagreement between the browser's clock and the
  // container's — see msUntilNextPoll. Comparing the server's timestamp
  // against a drifted browser clock pins the countdown at zero indefinitely.
  const msLeft = msUntilNextPoll(status, dataUpdatedAt, Date.now());
  const secondsLeft = msLeft === null ? null : Math.max(0, Math.round(msLeft / 1000));
  const due = secondsLeft !== null && secondsLeft === 0;
  // A spent deadline means the server's own cycle is due or already running,
  // which is indistinguishable from a manual one to everything downstream —
  // both are a poll in flight, and neither leaves anything to count down to.
  const polling = due || poll.isPending;

  // meta.countdown's template needs both {minutes} and {seconds} — matches
  // the vanilla renderCountdown() split, not a single rounded-up minute count.
  const minutesLeft = secondsLeft === null ? 0 : Math.floor(secondsLeft / 60);
  const remainderSeconds = secondsLeft === null ? 0 : secondsLeft % 60;

  // Undefined status is "the read has not answered", not "answered, and there
  // is no deadline". Saying "not polled yet" for it claimed something about
  // the server on every visit before /status landed, and kept claiming it when
  // the read failed. The line is reserved rather than removed so the header
  // keeps its height while there is nothing to put in it.
  const label =
    status === undefined
      ? null
      : polling
        ? t("meta.polling")
        : secondsLeft === null
          ? t("meta.never-polled")
          : minutesLeft > 0
            ? t("meta.countdown", { minutes: minutesLeft, seconds: remainderSeconds })
            : t("meta.countdown-seconds", { seconds: remainderSeconds });

  // How much of the cycle is left, for the ring. A spent or unknown deadline
  // draws it empty: there is nothing left to count down.
  // "Next poll" only heads a figure: beside "Polling now" or "not polled yet"
  // it made a sentence of two claims. While the read has not answered it still
  // holds the cluster's place.
  const counting = status === undefined || (!polling && secondsLeft !== null);
  const cycleSeconds = (status?.pollIntervalMinutes ?? 0) * 60;
  const left = secondsLeft === null || polling || cycleSeconds === 0 ? 0 : Math.min(1, secondsLeft / cycleSeconds);

  return (
    /* One control, not five (dashboard-design-direction): the ring says how
       far the cycle has run, the words say when the next one is, the button
       starts one now. The LIVE chip became the ring's colour — accent while
       the stream is connected, grey once it is lost — and its word stayed for
       screen readers; the sweeping meter beam is gone, because a countdown
       that moves every second already says the poller is alive. */
    <div
      className="header-poll flex h-9 items-center gap-2.5 rounded-lg border border-border bg-card pl-3 pr-1"
      title={live ? t("meta.live") : undefined}
    >
      <PollRing left={left} lost={lost} />
      <span className="poll-next flex items-center gap-1.5 text-sm text-muted-foreground">
        {/* The label goes first when the header is short of room: the
            countdown carries the meaning on its own. */}
        {counting && <span className="hidden lg:inline">{t("meta.next-poll-label")}</span>}
        {live && <span className="sr-only">{t("meta.live")}</span>}
        <span className={cn("poll-next-time min-h-5 text-sm text-foreground", counting && "font-mono tabular-nums")}>
          {label}
        </span>
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 rounded-md bg-primary/10 px-2.5 text-foreground hover:bg-primary/15"
        disabled={polling}
        aria-busy={polling}
        onClick={() => poll.mutate()}
      >
        {polling ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw className="sm:hidden" aria-hidden="true" />
        )}
        {/* A glyph on a phone, where the title needs the width; the words
            stay for screen readers and come back from `sm`. */}
        <span className="sr-only sm:not-sr-only">{t("action.poll-now")}</span>
      </Button>
    </div>
  );
}

/** Circumference of the ring's r=7.5 circle, which is what the dash runs on. */
const RING = 2 * Math.PI * 7.5;

/**
 * The cycle as a ring that empties toward the next poll. It ticks with the
 * countdown, once a second, rather than gliding: a clock that moves when the
 * number beside it moves reads as one thing.
 */
function PollRing({ left, lost }: { left: number; lost: boolean }) {
  return (
    <svg className="poll-ring size-4 shrink-0" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" fill="none" className="stroke-muted" strokeWidth="2.5" />
      <circle
        cx="10"
        cy="10"
        r="7.5"
        fill="none"
        className={cn(lost ? "stroke-muted-foreground" : "stroke-primary")}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={RING}
        strokeDashoffset={RING * (1 - left)}
        transform="rotate(-90 10 10)"
      />
    </svg>
  );
}
