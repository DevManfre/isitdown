/// <reference types="node" />
// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Roadmap 4.20. A chart's conclusion is its `aria-label`, and an `aria-label` on
 * the bare <div> `ChartContainer` renders is ignored by assistive technology
 * (axe: aria-prohibited-attr) — it only reaches a screen reader with
 * `role="img"` beside it. Three charts shipped with one and without the other,
 * so the pairing is checked here, where the next chart will be added, rather
 * than waiting for the visual harness's axe pass to find it.
 */
const DIR = new URL("./", import.meta.url);

describe("every chart that names itself says what it is", () => {
  const files = readdirSync(DIR).filter((name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"));

  it.each(files)("%s", (name) => {
    const source = readFileSync(new URL(name, DIR), "utf8");
    if (!source.includes("<ChartContainer") || !source.includes("aria-label")) return;
    expect(source, `${name} labels a ChartContainer with no role="img"`).toContain('role="img"');
  });
});
