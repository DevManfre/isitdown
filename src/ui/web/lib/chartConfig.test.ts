/// <reference types="node" />
// @vitest-environment node
//
// This suite reads tokens.css off disk, so it must opt out of the global
// happy-dom environment: under happy-dom, Vite rewrites
// `new URL(…, import.meta.url)` into a dev-server network URL and
// `readFileSync` throws "The URL must be of scheme file". See
// src/ui/web/css/tokens.test.ts for the precedent.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { chartConfigFor, severity, STATUS_CHART, statusColor, statusFill, statusLabelKey } from "./chartConfig.ts";
import en from "@/locales/en.json";

const STATUSES = ["operational", "degraded", "partial_outage", "major_outage", "unknown"] as const;
const tokens = readFileSync(new URL("../css/tokens.css", import.meta.url), "utf8");

describe("chartConfig", () => {
  it("covers every status in the severity model", () => {
    expect(Object.keys(STATUS_CHART).sort()).toEqual([...STATUSES].sort());
  });

  it("resolves every colour to a token declared in tokens.css", () => {
    for (const status of STATUSES) {
      for (const value of [statusColor(status), statusFill(status)]) {
        const name = value.match(/var\((--[\w-]+)\)/)?.[1];
        expect(name, `${status} must use a var(), got ${value}`).toBeDefined();
        expect(tokens, `${name} is not declared in tokens.css`).toContain(`${name}:`);
      }
    }
  });

  it("names a catalog key per status, present in en.json", () => {
    for (const status of STATUSES) {
      expect(en).toHaveProperty(statusLabelKey(status));
    }
  });

  it("orders severity so a worse status draws a taller bar", () => {
    expect(severity("operational", "row")).toBeLessThan(severity("degraded", "row"));
    expect(severity("degraded", "row")).toBeLessThan(severity("partial_outage", "row"));
    expect(severity("partial_outage", "row")).toBeLessThan(severity("major_outage", "row"));
  });

  it("gives unknown the shortest bar of all", () => {
    for (const status of ["operational", "degraded", "partial_outage", "major_outage"] as const) {
      expect(severity("unknown", "row")).toBeLessThan(severity(status, "row"));
    }
  });

  it("scales compact and poll rows below the full row", () => {
    expect(severity("major_outage", "compact")).toBeLessThan(severity("major_outage", "row"));
    expect(severity("major_outage", "poll")).toBeLessThan(severity("major_outage", "row"));
  });

  it("hands shadcn a config entry per status", () => {
    const config = chartConfigFor("row");
    for (const status of STATUSES) {
      expect(config[status]?.color).toBe(statusFill(status));
    }
  });

  it("declares no colour literal of its own", () => {
    const source = readFileSync(new URL("./chartConfig.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
