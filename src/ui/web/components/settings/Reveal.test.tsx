import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Reveal } from "./Reveal.tsx";

/** A switch and the rows it reveals, which is the only way `Reveal` is used. */
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen((was) => !was)}>
        toggle
      </button>
      <Reveal open={open}>
        <span>revealed</span>
      </Reveal>
    </>
  );
}

describe("Reveal", () => {
  it("renders nothing at all while closed", () => {
    render(<Reveal open={false}>content</Reveal>);
    expect(screen.queryByText("content")).toBeNull();
  });

  it("unfolds what it reveals rather than appearing at full height", () => {
    const { container } = render(<Reveal open>content</Reveal>);
    expect(container.querySelector('[data-slot="setting-reveal"]')?.className).toContain("anim-unfold");
    expect(screen.getByText("content")).toBeTruthy();
  });

  it("stays mounted while it folds away, instead of being cut in one frame", async () => {
    // The defect this exists for: the rows used to vanish the instant the
    // switch flipped, and every row underneath jumped up their full height.
    const { container } = render(<Harness />);
    screen.getByRole("button").click();
    await waitFor(() => expect(screen.getByText("revealed")).toBeTruthy());

    screen.getByRole("button").click();

    // Still there, now playing the exit.
    await waitFor(() =>
      expect(container.querySelector('[data-slot="setting-reveal"]')?.className).toContain("anim-fold"),
    );
    expect(screen.getByText("revealed")).toBeTruthy();

    // And gone once the fold has had time to run.
    await waitFor(() => expect(screen.queryByText("revealed")).toBeNull(), { timeout: 1000 });
  });

  it("keeps the rows it wraps divided, the way the card would have", () => {
    // `.anim-unfold > *` is the element that clips, so the rows sit one level
    // deeper than the Card's own `divide-y` can reach.
    const { container } = render(
      <Reveal open>
        <span>one</span>
        <span>two</span>
      </Reveal>,
    );
    const inner = container.querySelector('[data-slot="setting-reveal"] > div');
    expect(inner?.className).toContain("divide-y");
  });
});
