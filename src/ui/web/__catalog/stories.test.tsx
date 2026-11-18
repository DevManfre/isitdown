import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n.ts";
import { stubApi } from "@/test/harness.tsx";
import { StoryFrame } from "./StoryFrame.tsx";
import { stories } from "./stories.tsx";

/*
 * Roadmap 13.9. Every story of the component catalog renders, and is in the
 * state it says it is in — a "loading" story that has quietly started showing
 * data (or an error story whose request now succeeds) would leave the catalog,
 * and the visual baselines drawn from it, showing the wrong thing under the
 * right name.
 */

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const busy = () => document.querySelector('[aria-busy="true"], [data-slot="skeleton"]');

describe("component catalog", () => {
  it("names every story once, as <component>--<variant>", () => {
    const ids = stories().map((story) => story.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z-]+--[a-z-]+$/);
  });

  it("covers the components the roadmap asks for", () => {
    const components = new Set(stories().map((story) => story.id.split("--")[0]));
    for (const name of ["provider-tile", "uptime-bar", "incident-timeline", "incident-card", "settings-engine"]) {
      expect(components).toContain(name);
    }
  });

  for (const story of stories()) {
    it(`${story.id} renders in its ${story.state} state`, async () => {
      stubApi(story.fixtures ?? {});
      for (const [key, value] of Object.entries(story.storage ?? {})) localStorage.setItem(key, value);
      render(<StoryFrame story={story} />);

      if (story.state === "error") {
        expect(await screen.findByRole("button", { name: i18n.t("action.retry") })).toBeInTheDocument();
        return;
      }
      await waitFor(() => expect(document.querySelector(`[data-story="${story.id}"]`)).not.toBeNull());
      if (story.state === "loading") {
        await waitFor(() => expect(busy()).not.toBeNull());
      } else {
        await waitFor(() => expect(busy()).toBeNull());
        expect(document.querySelector(`[data-story="${story.id}"]`)?.firstElementChild).not.toBeNull();
      }
    });
  }
});
