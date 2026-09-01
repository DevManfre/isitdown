import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { createHashRouter, RouterProvider } from "react-router";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { createQueryClient } from "@/lib/queryClient.ts";
import { useStatus } from "@/hooks/queries.ts";
import { BusyProvider } from "@/hooks/useBusy.tsx";
import { ViewError } from "./ViewError.tsx";

function Probe() {
  const { data } = useStatus();
  return <p>{`providers: ${String(data?.providers.length ?? 0)}`}</p>;
}

/**
 * Fails the first `failures` fetches, then answers with a real status body —
 * so the retry has something different to find than the first load did.
 */
function stubFailingThenOk(failures: number): { calls: () => number } {
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      calls += 1;
      if (calls <= failures) return { ok: false, status: 500, text: async () => "" };
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            providers: [
              { id: "github", name: "GitHub", overallStatus: "operational", activeIncidents: [], uptime90: 99.9 },
            ],
            pollIntervalMinutes: 5,
            lastPollAt: null,
            nextPollAt: null,
          }),
      };
    }),
  );
  return { calls: () => calls };
}

function mount() {
  const client = createQueryClient({ retry: false });
  window.location.hash = "/";
  const router = createHashRouter([{ path: "/", element: <Probe />, errorElement: <ViewError /> }]);
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <BusyProvider>
          <RouterProvider router={router} />
        </BusyProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ViewError", () => {
  it("names the failure that took the view down", async () => {
    stubFailingThenOk(Number.POSITIVE_INFINITY);
    mount();
    expect(await screen.findByText(/Could not load this view/)).toBeInTheDocument();
  });

  // The whole point of the affordance: the error state is a way back, not a
  // dead end. Before this, ViewError rendered one paragraph and nothing else,
  // and an operator whose first load lost a race with the server had to reload
  // the browser — the view's query had already thrown and unmounted, so no
  // poll was left running to recover it.
  it("reloads the view when the operator retries after a failed first load", async () => {
    const probe = stubFailingThenOk(1);
    mount();

    expect(await screen.findByText(/Could not load this view/)).toBeInTheDocument();
    expect(screen.queryByText("providers: 1")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: i18n.t("action.retry") }));

    expect(await screen.findByText("providers: 1")).toBeInTheDocument();
    expect(screen.queryByText(/Could not load this view/)).toBeNull();
    expect(probe.calls()).toBeGreaterThan(1);
  });
});
