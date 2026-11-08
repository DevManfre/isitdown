import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FavoriteStar } from "@/components/FavoriteStar.tsx";
import { renderWithProviders } from "@/test/harness.tsx";

afterEach(() => vi.unstubAllGlobals());

/** Every body the page PATCHed to the provider's own endpoint, parsed. */
const patches = (): unknown[] =>
  (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    .filter(([path, init]) => path === "/config/services/github" && init?.method === "PATCH")
    .map(([, init]) => JSON.parse(init.body as string));

describe("the star on a provider (roadmap 5.14)", () => {
  it("stars an unstarred provider, and says it is a toggle rather than renaming itself", async () => {
    renderWithProviders(<FavoriteStar providerId="github" name="GitHub" favorite={false} />, {});

    const button = await screen.findByRole("button", { name: "Favorite: GitHub" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(button);

    await waitFor(() => expect(patches()).toEqual([{ favorite: true }]));
  });

  it("un-stars a starred provider", async () => {
    renderWithProviders(<FavoriteStar providerId="github" name="GitHub" favorite />, {});

    const button = await screen.findByRole("button", { name: "Favorite: GitHub" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(button);

    await waitFor(() => expect(patches()).toEqual([{ favorite: false }]));
  });
});
