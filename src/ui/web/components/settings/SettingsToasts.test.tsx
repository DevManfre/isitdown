import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { renderWithProviders } from "@/test/harness.tsx";
import {
  SettingsToasts,
  UNDO_MS,
  useSettingsToasts,
  type SettingsToastStatus,
  type SettingsToastKind,
} from "./SettingsToasts.tsx";

afterEach(() => vi.useRealTimers());

/** A page that reports whatever the test asks it to, the way Settings does. */
function Harness({
  reports,
}: {
  reports: {
    kind: SettingsToastKind;
    status: SettingsToastStatus | undefined;
  }[];
}) {
  const { toasts, report, dismiss } = useSettingsToasts();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          for (const entry of reports) report(entry.kind, entry.status);
        }}
      >
        report
      </button>
      <SettingsToasts toasts={toasts} onDismiss={dismiss} />
    </>
  );
}

describe("SettingsToasts", () => {
  // The section is carried by the icon, not by a title: the heading above the
  // card already names it, and repeating it read as chrome.
  it("shows what was said, and marks which section said it", async () => {
    renderWithProviders(<Harness reports={[{ kind: "engine", status: { text: "Saved", tone: "ok" } }]} />);

    await userEvent.click(screen.getByRole("button", { name: "report" }));

    const receipt = await screen.findByText("Saved");
    expect(receipt.closest("[data-slot='settings-toast']")).toHaveAttribute("data-kind", "engine");
    expect(screen.queryByText(i18n.t("settings.section.engine"))).not.toBeInTheDocument();
  });

  // The footer line this replaced was one line per section: a second save
  // overwrote the first, so two rows saved in a row left one receipt.
  it("stacks a receipt per report instead of overwriting the last one", async () => {
    renderWithProviders(
      <Harness
        reports={[
          { kind: "engine", status: { text: "Saved", tone: "ok" } },
          { kind: "data", status: { text: "Kept", tone: "ok" } },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "report" }));

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Kept")).toBeInTheDocument();
  });

  // Call sites clear their status before firing the request. That clear must
  // not paint an empty card.
  it("says nothing when the report carries no status", async () => {
    renderWithProviders(<Harness reports={[{ kind: "delivery", status: undefined }]} />);

    await userEvent.click(screen.getByRole("button", { name: "report" }));

    expect(document.querySelector("[data-slot='settings-toast']")).toBeNull();
  });

  it("takes a receipt back after four seconds, and keeps an error twice as long", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWithProviders(
      <Harness
        reports={[
          { kind: "engine", status: { text: "Saved", tone: "ok" } },
          { kind: "engine", status: { text: "Out of range", tone: "error" } },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "report" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(4_500);
    });
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(screen.getByText("Out of range")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    expect(screen.queryByText("Out of range")).not.toBeInTheDocument();
  });

  it("closes a card the operator dismisses before its timer runs out", async () => {
    renderWithProviders(<Harness reports={[{ kind: "data", status: { text: "Kept", tone: "ok" } }]} />);

    await userEvent.click(screen.getByRole("button", { name: "report" }));
    expect(await screen.findByText("Kept")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: i18n.t("settings.toasts.dismiss") }));
    expect(screen.queryByText("Kept")).not.toBeInTheDocument();
  });

  // Roadmap 4.8: the write waits behind the toast, so Undo is a cancel rather
  // than a second write that has to put things back.
  describe("deferred writes", () => {
    function Deferring({ commit, onUndo }: { commit: () => void; onUndo: () => void }) {
      const { toasts, defer, dismiss } = useSettingsToasts();
      return (
        <>
          <button type="button" onClick={() => defer("data", { text: "Cleared", commit, onUndo })}>
            defer
          </button>
          <SettingsToasts toasts={toasts} onDismiss={dismiss} />
        </>
      );
    }

    it("holds the write until the window closes, then sends it once", () => {
      vi.useFakeTimers();
      const commit = vi.fn();
      renderWithProviders(<Deferring commit={commit} onUndo={vi.fn()} />);
      act(() => screen.getByRole("button", { name: "defer" }).click());

      expect(screen.getByText("Cleared")).toBeInTheDocument();
      act(() => void vi.advanceTimersByTime(UNDO_MS - 1));
      expect(commit).not.toHaveBeenCalled();
      act(() => void vi.advanceTimersByTime(1));
      expect(commit).toHaveBeenCalledTimes(1);
    });

    it("never sends the write when Undo is pressed", () => {
      vi.useFakeTimers();
      const commit = vi.fn();
      const onUndo = vi.fn();
      renderWithProviders(<Deferring commit={commit} onUndo={onUndo} />);
      act(() => screen.getByRole("button", { name: "defer" }).click());
      act(() => screen.getByRole("button", { name: i18n.t("action.undo") }).click());
      act(() => void vi.advanceTimersByTime(UNDO_MS * 2));

      expect(onUndo).toHaveBeenCalledTimes(1);
      expect(commit).not.toHaveBeenCalled();
    });

    it("sends the write when the card is dismissed or the page is left", () => {
      vi.useFakeTimers();
      const commit = vi.fn();
      const view = renderWithProviders(<Deferring commit={commit} onUndo={vi.fn()} />);
      act(() => screen.getByRole("button", { name: "defer" }).click());
      act(() => screen.getByRole("button", { name: i18n.t("settings.toasts.dismiss") }).click());
      expect(commit).toHaveBeenCalledTimes(1);

      act(() => screen.getByRole("button", { name: "defer" }).click());
      view.unmount();
      expect(commit).toHaveBeenCalledTimes(2);
    });
  });
});
