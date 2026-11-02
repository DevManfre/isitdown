import { useEffect, useRef } from "react";
import type { StatusResponse } from "@/lib/types.ts";
import { isBetter, isWorse, statusById, statusChanges, statusRank } from "@/lib/statusChanges.ts";
import { isLoudEnough, playAlert, readSound } from "@/lib/sound.ts";
import { pulse } from "@/lib/statusPulse.ts";

/**
 * What a live status change does beyond updating the number — roadmaps 4.27
 * and 4.28: a one-off pulse on the tile that moved, and, if the operator turned
 * it on, a tone when something got worse.
 *
 * Mounted once per screen that watches the fleet (the shell, and the wallboard
 * which sits outside it), never per tile. The first read is only a baseline —
 * a page that has just opened has had nothing "happen" — which is also why
 * reloading a tab during an outage is silent rather than a fresh alarm.
 *
 * It is handed the status rather than asking for it, so the shell can give it
 * the chrome-safe read (a failed one leaves the page quiet instead of taking
 * the shell down) and the wallboard the read it already holds — one query
 * either way, never two.
 *
 * Reduced motion is the stylesheet's call, not this hook's: the pulse is still
 * set, the CSS declines to animate it. The sound has no such setting — it is
 * off unless asked for, which is the opt-in.
 */
export function useStatusFeedback(data: StatusResponse | undefined): void {
  const previous = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    if (data === undefined) return;
    const before = previous.current;
    previous.current = statusById(data.providers);
    if (before === null) return;

    const changes = statusChanges(before, data.providers);
    let loudest = 0;
    for (const change of changes) {
      if (isWorse(change)) {
        pulse(change.id, "worse");
        loudest = Math.max(loudest, statusRank(change.status));
      } else if (isBetter(change)) {
        pulse(change.id, "better");
      }
    }
    // One tone per read, for the worst thing in it: five providers failing in
    // the same cycle is one alarm, not five in a row.
    const prefs = readSound();
    if (loudest > 0 && isLoudEnough(prefs, loudest)) void playAlert(prefs, loudest);
  }, [data]);
}
