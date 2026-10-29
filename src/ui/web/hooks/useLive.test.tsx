import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "@/lib/queryClient.ts";
import { LOST_AFTER_MS, LiveProvider, useLive, useStreamLost } from "./useLive.tsx";

/**
 * happy-dom ships no `EventSource`, which is also the production fallback path
 * — no stream, keep polling — so the stub is both the test double and the
 * proof that the guard is exercised.
 */
class FakeEventSource {
  static last: FakeEventSource | undefined;
  readonly listeners = new Map<string, ((event: Event) => void)[]>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data?: unknown): void {
    const event = data === undefined ? new Event(type) : new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function Probe() {
  const live = useLive();
  const lost = useStreamLost();
  return (
    <span>
      {live ? "live" : "polling"}
      {lost ? " lost" : ""}
    </span>
  );
}

function renderProvider() {
  const client = createQueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <LiveProvider>
        <Probe />
      </LiveProvider>
    </QueryClientProvider>,
  );
  return { invalidate };
}

/** The query keys a spy on `invalidateQueries` was actually called with. */
const keysFrom = (invalidate: { mock: { calls: unknown[][] } }): string[] =>
  invalidate.mock.calls.map((call) => JSON.stringify((call[0] as { queryKey?: unknown } | undefined)?.queryKey));

describe("LiveProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    FakeEventSource.last = undefined;
  });

  it("opens one stream and reports the dashboard as pushed to", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    renderProvider();

    expect(FakeEventSource.last?.url).toBe("/events");
    expect(screen.getByText("polling")).toBeInTheDocument();

    FakeEventSource.last!.emit("hello", { nextPollAt: null, serverNow: "2026-09-07T10:00:00Z" });

    expect(await screen.findByText("live")).toBeInTheDocument();
  });

  it("re-reads the cheap keys on a cycle, and the expensive ones only when something moved", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { invalidate } = renderProvider();

    FakeEventSource.last!.emit("cycle", { finishedAt: "2026-09-07T10:00:00Z", changedProviders: [] });

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    const quiet = keysFrom(invalidate);
    expect(quiet).toContain(JSON.stringify(["status"]));
    expect(quiet).toContain(JSON.stringify(["notifications"]));
    // 90 days of uptime rows are not worth re-reading for a cycle where
    // nothing changed, which is the common case.
    expect(quiet).not.toContain(JSON.stringify(["history"]));

    invalidate.mockClear();
    FakeEventSource.last!.emit("cycle", { finishedAt: "2026-09-07T10:03:00Z", changedProviders: ["github"] });

    await waitFor(() => expect(keysFrom(invalidate)).toContain(JSON.stringify(["history"])));
  });

  it("a cycle frame it cannot parse still counts as a cycle", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const { invalidate } = renderProvider();

    for (const listener of FakeEventSource.last!.listeners.get("cycle") ?? []) {
      listener(new MessageEvent("cycle", { data: "not json" }));
    }

    await waitFor(() => expect(keysFrom(invalidate)).toContain(JSON.stringify(["status"])));
  });

  it("a dropped stream puts the dashboard back on its timer", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    renderProvider();
    FakeEventSource.last!.emit("open");
    expect(await screen.findByText("live")).toBeInTheDocument();

    FakeEventSource.last!.emit("error");

    // EventSource reconnects by itself; until it does, polling is the floor.
    expect(await screen.findByText("polling")).toBeInTheDocument();
  });

  it("without EventSource the tree still renders, polling as before", () => {
    vi.stubGlobal("EventSource", undefined);
    renderProvider();

    expect(screen.getByText("polling")).toBeInTheDocument();
  });

  // Roadmap 4.9: a stream down for a few seconds is a blip; one down for long
  // enough means the tab is holding old state and has to say so, then re-read
  // everything (not only the cycle keys) the moment frames resume.
  it("calls the stream lost after a long outage and re-reads every query but config on return", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("EventSource", FakeEventSource);
      const { invalidate } = renderProvider();
      const source = FakeEventSource.last!;

      act(() => source.emit("hello", {}));
      act(() => source.emit("error"));
      act(() => void vi.advanceTimersByTime(LOST_AFTER_MS - 1));
      expect(screen.queryByText(/lost/)).not.toBeInTheDocument();

      act(() => void vi.advanceTimersByTime(1));
      expect(screen.getByText(/lost/)).toBeInTheDocument();

      invalidate.mockClear();
      act(() => source.emit("open"));
      expect(screen.queryByText(/lost/)).not.toBeInTheDocument();
      const options = invalidate.mock.calls[0]?.[0] as unknown as { predicate?: (query: { queryKey: unknown[] }) => boolean };
      expect(options.predicate?.({ queryKey: ["status"] })).toBe(true);
      expect(options.predicate?.({ queryKey: ["config", "services"] })).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not call a short blip lost, nor refetch everything when it recovers", () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("EventSource", FakeEventSource);
      const { invalidate } = renderProvider();
      const source = FakeEventSource.last!;

      act(() => source.emit("error"));
      act(() => void vi.advanceTimersByTime(LOST_AFTER_MS - 1));
      invalidate.mockClear();
      act(() => source.emit("open"));
      act(() => void vi.advanceTimersByTime(LOST_AFTER_MS * 2));

      expect(screen.queryByText(/lost/)).not.toBeInTheDocument();
      expect(invalidate).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
