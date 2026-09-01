import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { QueryClientProvider } from "@tanstack/react-query";
import { createHashRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import i18n from "@/lib/i18n.ts";
import { providerFixture, renderWithProviders, stubApi, type Fixtures } from "@/test/harness.tsx";
import { createQueryClient } from "@/lib/queryClient.ts";
import { BusyProvider, useBusy } from "@/hooks/useBusy.tsx";
import { ThemeProvider } from "@/hooks/useTheme.tsx";
import { RemoveServiceDialog, Settings } from "./Settings.tsx";

/**
 * Review Finding 2's third required write-path case: a channel's Switch
 * issues its patch. Same shape as ServiceDialog.test.tsx's interceptWrites —
 * captures the harness's already-installed fixture-driven `fetch` as a
 * fallback, then records/answers just the write endpoint under test.
 */
type RecordedCall = { path: string; method: string; body?: unknown };

function interceptWrites(responses: Record<string, unknown>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  const base = globalThis.fetch as typeof fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
      calls.push({ path, method, body });
      const key = `${method} ${path}`;
      if (Object.hasOwn(responses, key)) {
        return { ok: true, status: 200, text: async () => JSON.stringify(responses[key]) };
      }
      return base(input, init);
    }),
  );
  return calls;
}

const config = {
  polling: { intervalMinutes: 5, requestTimeoutSeconds: 10, maxRetries: 3, failureThreshold: 3 },
  locale: "en",
  services: [
    {
      id: "github",
      name: "GitHub",
      adapter: "statuspage",
      baseUrl: "https://www.githubstatus.com",
      enabled: true,
      components: [],
      scopeToComponents: false,
    },
  ],
  // DescribedChannel, per Task 5's types: no resolved secret ever leaves the server,
  // so a channel exposes env-var NAMES and whether each currently resolves.
  channels: [
    {
      id: "telegram",
      enabled: true,
      fields: [{ name: "botToken", envVar: "TELEGRAM_BOT_TOKEN", isSet: true }],
    },
  ],
};

/**
 * A `webpush` channel, per Task 6/7's shape: seeded disabled, with env fields
 * `publicKey`/`privateKey`. Scoped to its own fixture set (below) rather than
 * folded into the shared `config` above: every other test in this file
 * asserts on exactly the calls the telegram-only card makes (down to "no
 * calls at all" for an untouched save), and a second card's
 * `usePushDevices()` firing its own `GET /config/push/subscriptions` on
 * mount would land in those recordings and fail them for a reason that has
 * nothing to do with what they're testing.
 */
const webpushChannel = {
  id: "webpush",
  enabled: false,
  fields: [
    { name: "publicKey", envVar: "VAPID_PUBLIC_KEY", isSet: true },
    { name: "privateKey", envVar: "VAPID_PRIVATE_KEY", isSet: true },
  ],
};

const fixtures = {
  config,
  status: { providers: [providerFixture()], pollIntervalMinutes: 5, lastPollAt: null, nextPollAt: null },
};

afterEach(() => vi.unstubAllGlobals());

describe("Settings", () => {
  it("shows the polling fields with their current values", async () => {
    renderWithProviders(<Settings />, fixtures);
    expect(await screen.findByLabelText(i18n.t("field.interval"))).toHaveValue(5);
    expect(await screen.findByLabelText(i18n.t("field.timeout"))).toHaveValue(10);
    expect(await screen.findByLabelText(i18n.t("field.retries"))).toHaveValue(3);
  });

  it("lists the configured services with edit and remove here, not in the table", async () => {
    renderWithProviders(<Settings />, fixtures);
    expect(await screen.findByRole("button", { name: i18n.t("action.edit") })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: i18n.t("action.remove") })).toBeInTheDocument();
  });

  it("shows a channel's env var NAME as the field's placeholder, never a secret value", async () => {
    renderWithProviders(<Settings />, fixtures);
    // The stored name is a hint, not something the operator typed: the field
    // starts empty and only carries what is being changed right now.
    const input = await screen.findByPlaceholderText("TELEGRAM_BOT_TOKEN");
    expect(input).toHaveValue("");
    expect(await screen.findByText(i18n.t("settings.secret-note"))).toBeInTheDocument();
    expect(screen.queryByLabelText(/token value/i)).toBeNull();
  });

  it("holds the poll while any dialog is open, and releases it on every close path", async () => {
    // Asserting only that a dialog opens/closes would pass identically if
    // `setDialogOpen`/`setEditing` were never wired to BusyContext at all —
    // this test's own former defect, per the review. A probe mounted
    // alongside Settings, inside the same BusyProvider renderWithProviders
    // sets up, reads the actual context value so the assertion is on
    // busy-ness itself, not on the dialog's visibility.
    //
    // Radix's own `onOpenChange` fires only from its wrapped setter (Escape,
    // outside-click, DialogTrigger/DialogClose) — never merely because the
    // `open` prop changed on a re-render. Cancel, a successful save, and a
    // successful remove all used to call `setOpen` directly, bypassing that
    // setter and stranding `dialogOpen`/`editing` at `true` forever. Each of
    // the four paths below exercises one of the four ways a dialog in this
    // view can close, so a regression on any one of them is caught here.
    function BusyProbe() {
      const busy = useBusy();
      return <span data-testid="busy-probe">{String(busy)}</span>;
    }

    interceptWrites({
      "PATCH /config/services/github": {},
      "DELETE /config/services/github": {},
    });

    renderWithProviders(
      <>
        <Settings />
        <BusyProbe />
      </>,
      fixtures,
    );
    const probe = await screen.findByTestId("busy-probe");
    expect(probe).toHaveTextContent("false");

    // Path 1: Escape — Radix's own onOpenChange setter.
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("action.add-service") }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(probe).toHaveTextContent("true");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(probe).toHaveTextContent("false");

    // Path 2: the add-service dialog's own Cancel button.
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("action.add-service") }));
    const addDialog = await screen.findByRole("dialog");
    expect(probe).toHaveTextContent("true");
    await userEvent.click(within(addDialog).getByRole("button", { name: i18n.t("action.cancel") }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(probe).toHaveTextContent("false");

    // Path 3: a successful edit-service save (`patch.mutateAsync` resolving).
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("action.edit") }));
    const editDialog = await screen.findByRole("dialog");
    expect(probe).toHaveTextContent("true");
    await userEvent.click(within(editDialog).getByRole("button", { name: i18n.t("action.save") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(probe).toHaveTextContent("false");

    // Path 4: a successful remove (the mutation's own onSuccess callback).
    await userEvent.click(await screen.findByRole("button", { name: i18n.t("action.remove") }));
    const removeDialog = await screen.findByRole("dialog");
    expect(probe).toHaveTextContent("true");
    await userEvent.click(within(removeDialog).getByRole("button", { name: i18n.t("action.remove") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(probe).toHaveTextContent("false");
  });

  // Review round 3: neither dialog had any unmount cleanup of its own — an
  // operator who opens one, then clicks a Rail link away instead of closing
  // it, unmounts it directly. Nothing runs `onOpenChange`, Cancel, or a
  // mutation callback in that case.
  //
  // `BusyProvider` sits above `RouterProvider` in main.tsx, so it survives
  // every route change; the dialog, being a leaf of whichever route is
  // currently matched, does not. Reproducing that needs the same provider
  // order and an actual second route to navigate to — `renderWithProviders`
  // puts its own probe inside the one route it mounts, so the probe would
  // vanish along with the dialog and prove nothing. A bare
  // `render(...).unmount()` has the same problem: it tears down
  // `BusyProvider` right along with the dialog. This harness instead mounts
  // the probe as a sibling of `RouterProvider`, inside `BusyProvider`, and
  // gives the router a second route to navigate to, so only the matched
  // route's content unmounts — same as a real Rail click.
  //
  // Takes the route's element rather than hardcoding `<Settings />`: the
  // remove-dialog test below needs `RemoveServiceDialog` mounted alone, with
  // no sibling `ServiceDialog` instances that would mask a sabotaged cleanup
  // (see the comment on that test).
  function renderRouted(element: ReactNode, routeFixtures: Fixtures) {
    stubApi(routeFixtures);
    window.location.hash = "/settings";
    const client = createQueryClient({ retry: false });
    const router = createHashRouter([
      { path: "/settings", element },
      { path: "/elsewhere", element: null },
    ]);
    function BusyProbe() {
      const busy = useBusy();
      return <span data-testid="busy-probe">{String(busy)}</span>;
    }
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <ThemeProvider>
            <BusyProvider>
              <RouterProvider router={router} />
              <BusyProbe />
            </BusyProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </I18nextProvider>,
    );
    return router;
  }

  it("releases the busy state if the add-service dialog's route unmounts without closing", async () => {
    const router = renderRouted(<Settings />, fixtures);
    const probe = await screen.findByTestId("busy-probe");
    expect(probe).toHaveTextContent("false");

    await userEvent.click(await screen.findByRole("button", { name: i18n.t("action.add-service") }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(probe).toHaveTextContent("true");

    // The operator clicks a Rail link instead of closing the dialog.
    await act(async () => router.navigate("/elsewhere"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(probe).toHaveTextContent("false");
  });

  it("releases the busy state if the remove-service dialog's route unmounts without closing", async () => {
    // Settings always renders an add ServiceDialog plus one edit ServiceDialog
    // and one RemoveServiceDialog per configured service — all three unmount
    // together on any route change. If this test rendered <Settings /> like
    // the one above, sabotaging RemoveServiceDialog's own cleanup would still
    // pass: the still-intact ServiceDialog cleanups unconditionally call the
    // same setDialogOpen(false) on the same shared boolean, masking the
    // missing one. Rendering RemoveServiceDialog alone, with no ServiceDialog
    // mounted alongside it, is what makes this test able to fail for the
    // reason it claims to.
    const router = renderRouted(
      <RemoveServiceDialog
        service={config.services[0]!}
        trigger={<button type="button">{i18n.t("action.remove")}</button>}
      />,
      fixtures,
    );
    const probe = await screen.findByTestId("busy-probe");

    await userEvent.click(await screen.findByRole("button", { name: i18n.t("action.remove") }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(probe).toHaveTextContent("true");

    await act(async () => router.navigate("/elsewhere"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(probe).toHaveTextContent("false");
  });

  // A provider can be taken out of the rotation without being deleted: the
  // poller has always skipped a disabled service (poller.ts:164) and the PATCH
  // route has always accepted `enabled`, but nothing in the browser could set
  // it — the add dialog hard-codes `enabled: true` and edit never sends it.
  it("a service toggle issues its patch", async () => {
    renderWithProviders(<Settings />, fixtures);
    const toggle = await screen.findByRole("switch", { name: "GitHub — enabled" });
    const calls = interceptWrites({ "PATCH /config/services/github": {} });

    await userEvent.click(toggle);

    await waitFor(() => {
      const patchCall = calls.find(
        (call) => call.method === "PATCH" && call.path === "/config/services/github",
      );
      expect(patchCall?.body).toEqual({ enabled: false });
    });
  });

  it("reads a disabled service as off, so the row states it rather than only tinting a dot", async () => {
    const services = [{ ...config.services[0], enabled: false }];
    renderWithProviders(<Settings />, { ...fixtures, config: { ...config, services } });
    expect(await screen.findByRole("switch", { name: "GitHub — disabled" })).not.toBeChecked();
  });

  it("a channel toggle issues its patch", async () => {
    renderWithProviders(<Settings />, fixtures);
    const toggle = await screen.findByRole("switch", { name: "telegram — enabled" });
    const calls = interceptWrites({ "PATCH /config/channels/telegram": {} });

    await userEvent.click(toggle);

    await waitFor(() => {
      const patchCall = calls.find(
        (call) => call.method === "PATCH" && call.path === "/config/channels/telegram",
      );
      expect(patchCall?.body).toEqual({ enabled: false });
    });
  });

  it("says that configuration changes need no restart", async () => {
    renderWithProviders(<Settings />, fixtures);
    expect(await screen.findByText(i18n.t("settings.hot-note"))).toBeInTheDocument();
  });

  // Review item 2: `ChannelCard`'s `save` and `send-test` had no coverage —
  // only the enable/disable Switch (above) was exercised.
  describe("a channel card's own write path", () => {
    it("a channel's env-var name edit calls the save mutation with the expected body", async () => {
      renderWithProviders(<Settings />, fixtures);
      const calls = interceptWrites({ "PATCH /config/channels/telegram": {} });

      const input = await screen.findByPlaceholderText("TELEGRAM_BOT_TOKEN");
      const card = input.closest('[data-slot="card"]') as HTMLElement;
      await userEvent.type(input, "TELEGRAM_BOT_TOKEN_V2");
      await userEvent.click(within(card).getByRole("button", { name: i18n.t("action.save") }));

      await waitFor(() => {
        const saveCall = calls.find(
          (call) => call.method === "PATCH" && call.path === "/config/channels/telegram",
        );
        expect(saveCall?.body).toEqual({ fields: { botTokenEnv: "TELEGRAM_BOT_TOKEN_V2" } });
      });
    });

    it("saving a channel whose fields were left untouched writes nothing", async () => {
      renderWithProviders(<Settings />, fixtures);
      const calls = interceptWrites({ "PATCH /config/channels/telegram": {} });

      const input = await screen.findByPlaceholderText("TELEGRAM_BOT_TOKEN");
      const card = input.closest('[data-slot="card"]') as HTMLElement;
      await userEvent.click(within(card).getByRole("button", { name: i18n.t("action.save") }));

      await waitFor(() => {
        expect(calls).toEqual([]);
      });
    });

    it("send-test reports success and shows channel.test-ok", async () => {
      renderWithProviders(<Settings />, fixtures);
      const calls = interceptWrites({ "POST /config/channels/telegram/test": { ok: true } });
      const input = await screen.findByPlaceholderText("TELEGRAM_BOT_TOKEN");
      const card = input.closest('[data-slot="card"]') as HTMLElement;

      await userEvent.click(within(card).getByRole("button", { name: i18n.t("action.send-test") }));

      expect(await within(card).findByText(i18n.t("channel.test-ok"))).toBeInTheDocument();
      expect(
        calls.some((call) => call.method === "POST" && call.path === "/config/channels/telegram/test"),
      ).toBe(true);
    });

    it("send-test reports failure and shows channel.test-failed with the error", async () => {
      renderWithProviders(<Settings />, fixtures);
      interceptWrites({ "POST /config/channels/telegram/test": { ok: false, error: "timeout" } });
      const input = await screen.findByPlaceholderText("TELEGRAM_BOT_TOKEN");
      const card = input.closest('[data-slot="card"]') as HTMLElement;

      await userEvent.click(within(card).getByRole("button", { name: i18n.t("action.send-test") }));

      expect(
        await within(card).findByText(i18n.t("channel.test-failed", { error: "timeout" })),
      ).toBeInTheDocument();
    });
  });

  // Task 7: desktop push (Web Push) notifications, offered from the webpush
  // channel card. `navigator` is mutated in place with `Object.defineProperty`
  // rather than replaced with `vi.stubGlobal("navigator", { ...navigator, ... })`:
  // happy-dom defines every Navigator property (userAgent, serviceWorker, …) as
  // a non-enumerable getter on `Navigator.prototype`, so `{ ...navigator }`
  // captures none of them — `Object.keys({ ...navigator })` is `[]`. A stub
  // built that way would still happen to pass this particular test (it only
  // reads the two overridden keys), but it silently hands the rest of the
  // render a `navigator` with nothing else on it. Defining the two properties
  // directly on the real object leaves everything else untouched.
  describe("desktop push notifications", () => {
    afterEach(() => {
      delete (navigator as { serviceWorker?: unknown }).serviceWorker;
      delete (navigator as { userAgent?: unknown }).userAgent;
    });

    // Merge webpushChannel in locally rather than into the shared `config`
    // above: these two tests need a webpush ChannelCard to render `PushDevices`
    // at all, but every other test in this file must keep asserting on exactly
    // the telegram-only card's calls.
    const pushFixtures = { ...fixtures, config: { ...config, channels: [...config.channels, webpushChannel] } };

    it("offers to enable desktop notifications on this browser and lists the device", async () => {
      // Two different, known byte sequences per key: `getKey` differentiates
      // by name (as the real PushSubscription does), so the assertion below
      // can check `p256dh` and `auth` landed in the right fields rather than
      // just "some string arrived in each". `usePushDevices()`'s own mount-time
      // `GET /config/push/subscriptions` returns `devices: []` regardless of
      // when it lands, so it cannot produce a POST and cannot satisfy the
      // method+path+body assertion below the way a bare path check could.
      const subscribe = vi.fn().mockResolvedValue({
        endpoint: "https://push.example/abc",
        getKey: (name: string) => (name === "p256dh" ? new Uint8Array([1, 2, 3]).buffer : new Uint8Array([4, 5]).buffer),
      });
      vi.stubGlobal("Notification", { requestPermission: vi.fn().mockResolvedValue("granted") });
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        value: "Mozilla/5.0 (Windows NT 10.0) Chrome/141.0 Safari/537.36",
      });
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: { register: vi.fn().mockResolvedValue({ pushManager: { subscribe } }) },
      });
      vi.stubGlobal("PushManager", class {});

      renderWithProviders(<Settings />, pushFixtures);
      // `stubApi`'s fixture router has no dedicated bucket for `/config/push`
      // (it falls under the same prefix as `/config`, the whole-config
      // fixture), so the key this card actually needs — `publicKey` — is
      // supplied here rather than left to fall through to that bucket, which
      // carries no such field.
      const calls = interceptWrites({
        "GET /config/push": { publicKey: "dGVzdC12YXBpZC1wdWJsaWMta2V5LTEyMzQ1Njc4OTA" },
        "POST /config/push/subscriptions": { devices: [] },
      });

      await userEvent.click(await screen.findByRole("button", { name: i18n.t("push.enable") }));

      // Method AND path, not path alone: `usePushDevices()`'s mount-time GET
      // to this same `/config/push/subscriptions` path already satisfies a
      // path-only check before the click ever happens. Asserting the body too
      // proves it is the click's POST, carrying what `subscribeThisBrowser`
      // actually produced — the stubbed endpoint, both base64url-encoded
      // keys, and a label derived from the stubbed `userAgent`.
      await waitFor(() => {
        expect(calls).toContainEqual({
          method: "POST",
          path: "/config/push/subscriptions",
          body: {
            endpoint: "https://push.example/abc",
            keys: { p256dh: "AQID", auth: "BAU" },
            label: "Chrome · Windows",
          },
        });
      });

      // Review finding 3: `webpushChannel` above is seeded disabled, which is
      // also the likeliest first run (set the two env vars, click this
      // button, never touch the switch). Reporting `push.enabled` regardless
      // of the channel's own state would promise delivery that never
      // happens; the card must say the channel is still off instead.
      expect(await screen.findByText(i18n.t("push.registered-channel-off"))).toBeInTheDocument();
      expect(screen.queryByText(i18n.t("push.enabled"))).toBeNull();
    });

    it("promises delivery only once the channel is actually enabled", async () => {
      const subscribe = vi.fn().mockResolvedValue({
        endpoint: "https://push.example/xyz",
        getKey: () => new Uint8Array([9]).buffer,
      });
      vi.stubGlobal("Notification", { requestPermission: vi.fn().mockResolvedValue("granted") });
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        value: "Mozilla/5.0 (Windows NT 10.0) Chrome/141.0 Safari/537.36",
      });
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        value: { register: vi.fn().mockResolvedValue({ pushManager: { subscribe } }) },
      });
      vi.stubGlobal("PushManager", class {});

      const enabledFixtures = {
        ...fixtures,
        config: { ...config, channels: [...config.channels, { ...webpushChannel, enabled: true }] },
      };
      renderWithProviders(<Settings />, enabledFixtures);
      interceptWrites({
        "GET /config/push": { publicKey: "dGVzdC12YXBpZC1wdWJsaWMta2V5LTEyMzQ1Njc4OTA" },
        "POST /config/push/subscriptions": { devices: [] },
      });

      await userEvent.click(await screen.findByRole("button", { name: i18n.t("push.enable") }));

      expect(await screen.findByText(i18n.t("push.enabled"))).toBeInTheDocument();
    });

    it("explains itself instead of offering a button the browser cannot honour", async () => {
      Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
      renderWithProviders(<Settings />, pushFixtures);
      expect(await screen.findByText(i18n.t("push.unsupported"))).toBeInTheDocument();
    });
  });

  // Task 15: the only way to choose the Overview's geographic view without
  // curl-ing /api/preferences directly. `off` is the default (design spec
  // §7.4), so the control must both read that default and fire a patch that
  // carries exactly the value picked — not on mount, not some other key.
  it("offers the three geographic view options and saves the choice", async () => {
    renderWithProviders(<Settings />, fixtures);
    await screen.findByLabelText(/geographic view/i);
    const calls = interceptWrites({ "PATCH /api/preferences": { mapView: "map" } });

    await userEvent.click(screen.getByLabelText(/geographic view/i));
    await userEvent.click(await screen.findByRole("option", { name: /dotted map/i }));

    await waitFor(() => {
      const patchCall = calls.find(
        (call) => call.method === "PATCH" && call.path === "/api/preferences",
      );
      expect(patchCall?.body).toEqual({ mapView: "map" });
    });
  });

  // Review gap 3: the harness had no `/api/preferences` fixture bucket, so a
  // GET there fell through to the `status` fixture — the initial-`off`
  // assertion above passed only by coincidence (the status fixture happens
  // to lack a `mapView` field). This exercises the actual readback path: an
  // operator who set `globe` last time must see `globe` again, not silently
  // fall back to `off`. Asserted on the rendered label a person reads, not
  // on the internal value passed to `Select`.
  it("reads a stored preference back into the control instead of always showing the default", async () => {
    renderWithProviders(<Settings />, { ...fixtures, preferences: { mapView: "globe" } });

    const trigger = await screen.findByLabelText(/geographic view/i);
    expect(within(trigger).getByText(i18n.t("settings.map-view.globe"))).toBeInTheDocument();
    expect(within(trigger).queryByText(i18n.t("settings.map-view.off"))).toBeNull();
  });
});
