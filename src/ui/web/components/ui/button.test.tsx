import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("exposes the data-slot hook motion.css selects on", () => {
    render(<Button>go</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("data-slot", "button");
  });

  it("exposes its variant as a data attribute so motion.css can target it", () => {
    render(<Button variant="destructive">drop</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("data-variant", "destructive");
  });

  it("defaults the variant attribute rather than leaving it absent", () => {
    render(<Button>go</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("data-variant", "default");
  });
});
