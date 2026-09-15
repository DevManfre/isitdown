import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { usePollNow, useStatusChrome } from "@/hooks/queries.ts";
import { useLive } from "@/hooks/useLive.tsx";
import { msUntilNextPoll } from "@/lib/statusRefetch.ts";
import { cn } from "@/lib/utils.ts";

export function PollIndicator() {
  const { t } = useTranslation();
  const { data: status, dataUpdatedAt } = useStatusChrome();
  const poll = usePollNow();
  const live = useLive();
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

  return (
    <div className="header-poll flex items-center gap-3 rounded-full border border-border bg-card/60 py-1 pl-3 pr-1">
      <div className="poll-next flex flex-col leading-tight">
        <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
          {t("meta.next-poll-label")}
          {/* Says where the freshness comes from: with the stream connected the
              dashboard is told about a cycle, it no longer asks on a timer. */}
          {live && (
            <span className="poll-live rounded-full bg-primary/15 px-1.5 text-[10px] uppercase tracking-widest text-primary">
              {t("meta.live")}
            </span>
          )}
        </span>
        <span className="flex min-h-5 items-center gap-1.5">
          <span
            className={cn("poll-next-dot size-1.5 rounded-full bg-primary", polling && "dot-pulse")}
          />
          <span className="poll-next-time font-mono text-xs">{label}</span>
        </span>
      </div>
      {/* The countdown says how long; this says the poller is alive. A number
          that has not moved for a second and a number that will never move
          again read identically, and the beam is the difference. It runs only
          while there is a cycle to wait for — with nothing scheduled the track
          stays dark rather than animating over a dead poller. */}
      <span
        aria-hidden="true"
        className="poll-meter h-1.5 w-9 overflow-hidden rounded-full bg-muted"
      >
        {secondsLeft !== null && (
          <span className="poll-meter-beam block h-full w-1/3 rounded-full bg-linear-to-r from-transparent via-primary to-transparent" />
        )}
      </span>
      <Button
        type="button"
        size="sm"
        className="rounded-full"
        disabled={polling}
        aria-busy={polling}
        onClick={() => poll.mutate()}
      >
        {polling && <LoaderCircle className="animate-spin" aria-hidden="true" />}
        {t("action.poll-now")}
      </Button>
    </div>
  );
}
