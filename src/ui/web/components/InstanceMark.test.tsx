import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/harness.tsx";
import { InstanceMark } from "./InstanceMark.tsx";

afterEach(() => vi.unstubAllGlobals());

const preferences = (logoUrl: string) => ({
  theme: "system",
  uiLocale: "en",
  notificationLocale: "en",
  mapView: "off",
  density: "comfortable",
  logoUrl,
});

describe("InstanceMark", () => {
  it("wears the product's own mark until a logo is set", async () => {
    const { container } = renderWithProviders(<InstanceMark />, { preferences: preferences("") });
    await waitFor(() => expect(container.querySelector('[data-slot="brand-mark"]')).not.toBeNull());
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows the operator's logo, as a decorative image", async () => {
    const { container } = renderWithProviders(<InstanceMark />, {
      preferences: preferences("https://example.com/logo.svg"),
    });
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    const image = container.querySelector("img") as HTMLImageElement;
    expect(image).toHaveAttribute("src", "https://example.com/logo.svg");
    // The name beside it says what it is, so a screen reader skips it.
    expect(image).toHaveAttribute("alt", "");
  });

  it("falls back to the product's mark when the logo does not load", async () => {
    const { container } = renderWithProviders(<InstanceMark />, {
      preferences: preferences("https://example.com/gone.png"),
    });
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    await waitFor(() => expect(container.querySelector('[data-slot="brand-mark"]')).not.toBeNull());
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
