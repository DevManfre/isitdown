import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { I18nextProvider } from "react-i18next";
import i18n from "@/lib/i18n.ts";
import { Wallboard } from "./Wallboard.tsx";
import type { ProviderStatus, StatusResponse } from "@/lib/types.ts";

const status = vi.fn();

vi.mock("@/hooks/queries.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/queries.ts")>()),
  useStatus: () => status(),
}));

const provider = (id: string, over: Partial<ProviderStatus> = {}): ProviderStatus => ({
  id,
  name: id,
  adapter: "statuspage",
  baseUrl: `https://${id}.example`,
  enabled: true,
  overallStatus: "operational",
  activeIncidents: [],
  components: [],
  componentSelection: [],
  scopeToComponents: false,
  fetchedAt: "2026-08-19T12:00:00.000Z",
  failureCount: 0,
  uptime90: 99.98,
  maintenance: { active: [], upcoming: [] },
  ...over,
});

const answer = (providers: ProviderStatus[]): { data: StatusResponse } => ({
  data: {
    providers,
    pollIntervalMinutes: 3,
    lastPollAt: "2026-08-19T12:00:00.000Z",
    nextPollAt: "2026-08-19T12:03:00.000Z",
  },
});

const show = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <Wallboard />
      </MemoryRouter>
    </I18nextProvider>,
  );

/** The board only rotates when the screen has not asked for stillness. */
const motion = (reduced: boolean): void => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduced,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
};

describe("the wallboard", () => {
  beforeEach(() => {
    motion(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("says the fleet is well when it is, in the one line readable across a room", () => {
    status.mockReturnValue(answer([provider("github"), provider("cloudflare")]));
    show();
    expect(screen.getByText(i18n.t("wallboard.all-well", { count: 2 }))).toBeInTheDocument();
  });

  it("counts what is in alarm, and does not count a provider nobody has read yet", () => {
    status.mockReturnValue(
      answer([
        provider("github", { overallStatus: "major_outage" }),
        provider("cloudflare", { overallStatus: "unknown" }),
        provider("anthropic"),
      ]),
    );
    show();
    // `unknown` is not trouble — the same rule the rest of the dashboard
    // follows, and the one that stops a fresh install reading as an outage.
    expect(screen.getByText(i18n.t("wallboard.alarm", { count: 1, total: 3 }))).toBeInTheDocument();
  });

  it("leaves a disabled provider off the wall entirely", () => {
    status.mockReturnValue(answer([provider("github"), provider("retired", { enabled: false })]));
    show();
    expect(screen.queryByText("retired")).toBeNull();
  });

  it("rotates through the fleet a page at a time", () => {
    vi.useFakeTimers();
    status.mockReturnValue(answer(Array.from({ length: 10 }, (_, index) => provider(`p${index}`))));
    show();

    expect(screen.getByText("p0")).toBeInTheDocument();
    expect(screen.queryByText("p8")).toBeNull();
    expect(screen.getByText(i18n.t("wallboard.page", { current: 1, total: 2 }))).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(15_000));
    expect(screen.getByText("p8")).toBeInTheDocument();
    expect(screen.queryByText("p0")).toBeNull();

    // And round again rather than off the end.
    act(() => void vi.advanceTimersByTime(15_000));
    expect(screen.getByText("p0")).toBeInTheDocument();
  });

  it("holds still on one page for a screen that asked for no motion", () => {
    vi.useFakeTimers();
    motion(true);
    status.mockReturnValue(answer(Array.from({ length: 10 }, (_, index) => provider(`p${index}`))));
    show();

    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByText("p0")).toBeInTheDocument();
    expect(screen.queryByText("p8")).toBeNull();
  });

  it("does not rotate a fleet that fits on one page", () => {
    vi.useFakeTimers();
    status.mockReturnValue(answer([provider("github")]));
    show();
    // No page counter either: "1 / 1" is a control that does nothing.
    expect(screen.queryByText(i18n.t("wallboard.page", { current: 1, total: 1 }))).toBeNull();
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByText("github")).toBeInTheDocument();
  });

  it("offers exactly two controls, both about the screen rather than the fleet", () => {
    status.mockReturnValue(answer([provider("github")]));
    show();
    expect(screen.getByLabelText(i18n.t("wallboard.fullscreen"))).toBeInTheDocument();
    expect(screen.getByLabelText(i18n.t("wallboard.exit"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: i18n.t("action.poll-now") })).toBeNull();
  });
});
