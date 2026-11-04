import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import type { ProviderStatus } from "@/lib/types.ts";
import { MobileProblems } from "./MobileProblems.tsx";

const patch = vi.fn();
const pollNow = vi.fn(() => Promise.resolve());

vi.mock("@/hooks/queries.ts", () => ({
  usePollNow: () => ({ mutateAsync: pollNow }),
  useServiceMutations: () => ({ patch: { mutate: patch } }),
}));

function provider(id: string, name: string, overallStatus: string, extra: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    id,
    name,
    enabled: true,
    overallStatus,
    activeIncidents: [],
    components: [],
    ...extra,
  } as unknown as ProviderStatus;
}

const fleet = [
  provider("stripe", "Stripe", "operational"),
  provider("github", "GitHub", "major_outage"),
  provider("cf", "Cloudflare", "degraded"),
];

function mount(providers: ProviderStatus[] = fleet) {
  return render(
    <MemoryRouter>
      <MobileProblems providers={providers} />
    </MemoryRouter>,
  );
}

function touch(type: string, y: number, x = 100): void {
  const touches = type === "touchend" ? [] : [{ clientX: x, clientY: y }];
  fireEvent(document, Object.assign(new Event(type, { bubbles: true }), { touches }));
}

beforeEach(() => {
  patch.mockClear();
  pollNow.mockClear();
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
});
afterEach(() => vi.useRealTimers());

describe("MobileProblems", () => {
  it("lists what needs attention and folds the healthy providers away", async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("Cloudflare")).toBeInTheDocument();
    // The status is said in words, not by colour alone.
    expect(screen.getByText(new RegExp(i18n.t("status.major-outage")))).toBeInTheDocument();
    expect(screen.queryByText("Stripe")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: i18n.t("mobile.show-all") }));
    expect(screen.getByText("Stripe")).toBeInTheDocument();
  });

  it("says so when nothing needs attention", () => {
    mount([provider("stripe", "Stripe", "operational")]);
    expect(screen.getByText(i18n.t("mobile.all-clear"))).toBeInTheDocument();
  });

  it("mutes from the row's menu, and Undo lifts it", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: i18n.t("mobile.row-options", { name: "GitHub" }) }));
    await user.click(await screen.findByRole("menuitem", { name: i18n.t("mute.for-120") }));
    expect(patch).toHaveBeenCalledWith({ id: "github", patch: { mutedUntil: expect.any(String) } });

    await user.click(screen.getByRole("button", { name: i18n.t("action.undo") }));
    expect(patch).toHaveBeenLastCalledWith({ id: "github", patch: { mutedUntil: null } });
  });

  it("polls when the page is pulled past the threshold and released", async () => {
    mount();
    touch("touchstart", 0);
    touch("touchmove", 200);
    expect(await screen.findByText(i18n.t("mobile.pull.release"))).toBeInTheDocument();
    await act(async () => touch("touchend", 200));
    expect(pollNow).toHaveBeenCalledTimes(1);
  });

  it("does not poll on a short pull", async () => {
    mount();
    touch("touchstart", 0);
    touch("touchmove", 40);
    await act(async () => touch("touchend", 40));
    expect(pollNow).not.toHaveBeenCalled();
  });

  it("leaves a sideways drag to the row, not the pull", async () => {
    mount();
    touch("touchstart", 0, 200);
    touch("touchmove", 30, 20);
    await act(async () => touch("touchend", 30));
    expect(pollNow).not.toHaveBeenCalled();
  });
});
