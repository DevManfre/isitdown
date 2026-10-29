import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * What a cycle event carries. Deliberately small: it says *that* something
 * happened and what to re-read, never the provider payloads themselves —
 * rendering from pushed state would leave two copies of the fleet to keep in
 * step and a reconnect to reconcile them.
 */
interface CycleEvent {
  changedProviders?: string[];
}

/**
 * The query keys a finished cycle can have moved. `["config"]` is absent on
 * purpose: a cycle never changes the configuration, and invalidating it would
 * refetch under an operator's open form — which is exactly what `useBusy`
 * exists to prevent.
 */
const CYCLE_KEYS = [["status"], ["incidents"], ["incident"], ["notifications"], ["delivery-log"], ["maintenances"]];

/** Re-read only when something actually moved: uptime bars are 90 days of rows. */
const CHANGE_KEYS = [["history"], ["map"]];

/** How long the stream stays down before the page admits its data may be old. */
export const LOST_AFTER_MS = 15_000;

const LiveContext = createContext<boolean>(false);
const LostContext = createContext<boolean>(false);

/**
 * Server-sent events instead of a 30-second question (roadmap 4.2).
 *
 * The scheduler knows the instant a cycle ends; before this, the dashboard
 * found out up to 30 seconds later, which is why a manual poll felt late and
 * why the countdown sat at "0s" between a deadline passing and the next read.
 * Now the server says so and the client re-reads what the event names.
 *
 * `live` says whether the stream is connected, and it is what makes every
 * query drop to a slow fallback interval instead of the idle rhythm. When the
 * stream drops, `EventSource` reconnects on its own and the flag flips back —
 * the dashboard degrades to polling in the meantime rather than going quiet.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [live, setLive] = useState(false);
  const [lost, setLost] = useState(false);
  const wasLost = useRef(false);

  useEffect(() => {
    // No EventSource means a test environment or a browser old enough that
    // polling is the only option; either way the fallback already works.
    if (typeof EventSource === "undefined") return;

    const source = new EventSource("/events");

    let lostTimer: ReturnType<typeof setTimeout> | undefined;
    // Any frame from the server proves the stream is back. If it had been down
    // long enough to be called lost, EventSource resuming is not enough: cycles
    // ran in the gap and their events are gone, so re-read everything rather
    // than trust what the tab has been holding. Config stays out, for the same
    // reason as CYCLE_KEYS.
    const alive = (): void => {
      clearTimeout(lostTimer);
      lostTimer = undefined;
      setLive(true);
      if (!wasLost.current) return;
      wasLost.current = false;
      setLost(false);
      void client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "config" });
    };
    const invalidate = (keys: string[][]): void => {
      for (const key of keys) void client.invalidateQueries({ queryKey: key });
    };

    source.addEventListener("open", alive);
    // The greeting proves the stream is delivering, not merely open, and it
    // carries the deadline a tab that connected between cycles needs.
    source.addEventListener("hello", alive);

    source.addEventListener("cycle", (event) => {
      alive();
      let payload: CycleEvent = {};
      try {
        payload = JSON.parse((event as MessageEvent<string>).data) as CycleEvent;
      } catch {
        // A frame we cannot read is still evidence the cycle ran; re-read the
        // cheap keys rather than ignore it.
      }
      invalidate(CYCLE_KEYS);
      if ((payload.changedProviders ?? []).length > 0) invalidate(CHANGE_KEYS);
    });

    source.addEventListener("error", () => {
      // EventSource reconnects by itself; the flag going false is what puts
      // the queries back on the faster idle rhythm until it does.
      setLive(false);
      lostTimer ??= setTimeout(() => {
        wasLost.current = true;
        setLost(true);
      }, LOST_AFTER_MS);
    });

    return () => {
      clearTimeout(lostTimer);
      source.close();
      setLive(false);
    };
  }, [client]);

  return (
    <LiveContext.Provider value={live}>
      <LostContext.Provider value={lost}>{children}</LostContext.Provider>
    </LiveContext.Provider>
  );
}

/** Whether the dashboard is being pushed to. False in any tree without a provider. */
export const useLive = () => useContext(LiveContext);

/** Whether the stream has been down long enough that what is on screen may be stale (roadmap 4.9). */
export const useStreamLost = () => useContext(LostContext);
