import { render, screen } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, describe, expect, it } from "vitest";
import { TypingAnimation } from "./typing-animation";

// The suite runs with the reduced-motion preference reported as set
// (vitest.setup.ts), which is the state where the sentence is painted whole —
// so these read the headline an operator ends up looking at, not a frame of
// the typing.
describe("TypingAnimation", () => {
  it("paints the whole sentence when motion is switched off", () => {
    render(<TypingAnimation text="One provider is off line." />);
    expect(screen.getByLabelText("One provider is off line.")).toHaveTextContent("One provider is off line.");
  });

  it("shows no caret once the sentence has arrived", () => {
    const { container } = render(<TypingAnimation text="One provider is off line." />);
    expect(container.querySelector(".typing-caret")).toBeNull();
  });

  it("carries the finished sentence as its label while the characters arrive", async () => {
    MotionGlobalConfig.skipAnimations = false;

    const { container } = render(<TypingAnimation text="One provider is off line." speed={1} />);

    // The label reads the same on the first frame as on the last: a screen
    // reader hears the headline once, not once per character.
    const region = screen.getByLabelText("One provider is off line.");
    expect(container.querySelector(".typing-caret")).not.toBeNull();

    await expect
      .poll(() => region.textContent, { timeout: 3000 })
      .toBe("One provider is off line.");
    expect(container.querySelector(".typing-caret")).toBeNull();
  });

  it("types the new sentence from the start when the text changes under it", async () => {
    MotionGlobalConfig.skipAnimations = false;

    const { rerender, container } = render(<TypingAnimation text="One provider is off line." speed={1} />);
    rerender(<TypingAnimation text="All providers are operational." speed={1} />);

    await expect
      .poll(() => container.textContent, { timeout: 3000 })
      .toBe("All providers are operational.");
  });
});

afterEach(() => {
  MotionGlobalConfig.skipAnimations = true;
});
