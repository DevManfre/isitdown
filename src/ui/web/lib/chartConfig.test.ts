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
import { chartConfigFor, severity, STATUS_CHART, statusColor, statusFill, statusLabelKey, statusTier, tierColor, trimToLatest, worstTier } from "./chartConfig.ts";
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

  it("orders severity so a worse status draws a taller bar, in every bar scale", () => {
    for (const scale of ["row", "compact", "poll"] as const) {
      expect(severity("operational", scale)).toBeLessThan(severity("degraded", scale));
      expect(severity("degraded", scale)).toBeLessThan(severity("partial_outage", scale));
      expect(severity("partial_outage", scale)).toBeLessThan(severity("major_outage", scale));
      for (const status of ["operational", "degraded", "partial_outage", "major_outage"] as const) {
        expect(
          severity("unknown", scale),
          `unknown must sit below ${status} at scale "${scale}"`,
        ).toBeLessThan(severity(status, scale));
      }
    }
  });

  it("applies its own status-independent multiplier per scale, distinguishing compact from poll", () => {
    const ratio = (status: (typeof STATUSES)[number], scale: "row" | "compact" | "poll") =>
      severity(status, scale) / STATUS_CHART[status].bar;

    // The multiplier a scale applies must not depend on which status it is
    // applied to — otherwise "compact" or "poll" would silently reorder the
    // severity ranking rather than just shrinking it uniformly.
    for (const scale of ["row", "compact", "poll"] as const) {
      const baseline = ratio("operational", scale);
      for (const status of STATUSES) {
        expect(
          ratio(status, scale),
          `${status} at scale "${scale}" must scale by the same multiplier as every other status`,
        ).toBeCloseTo(baseline, 10);
      }
    }

    expect(ratio("major_outage", "compact")).toBeLessThan(ratio("major_outage", "poll"));
    expect(ratio("major_outage", "poll")).toBeLessThan(ratio("major_outage", "row"));
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

describe("trimToLatest", () => {
  it("keeps the newest entries of a newest-first list", () => {
    expect(trimToLatest([5, 4, 3, 2, 1], 3)).toEqual([5, 4, 3]);
  });

  it("returns the whole list when it is shorter than the window", () => {
    expect(trimToLatest([1], 3)).toEqual([1]);
  });
});

/**
 * The operator-facing reduction of the five statuses to the three colours the
 * Overview beacon draws. It lives here for the same reason the rest of this
 * module does: one place knows the severity model, so a new status cannot
 * quietly acquire a colour the guard tests never see.
 */
describe("statusTier", () => {
  it("reduces every status to the tier its colour says", () => {
    expect(statusTier("operational")).toBe("ok");
    expect(statusTier("degraded")).toBe("warn");
    expect(statusTier("partial_outage")).toBe("warn");
    expect(statusTier("major_outage")).toBe("danger");
    expect(statusTier("unknown")).toBe("unknown");
  });

  it("treats an unrecognised status as unknown, like the rest of the module", () => {
    expect(statusTier("banana")).toBe("unknown");
  });

  it("gives every tier a colour drawn from the status tokens, never a literal", () => {
    expect(tierColor("ok")).toBe(statusColor("operational"));
    expect(tierColor("warn")).toBe(statusColor("degraded"));
    expect(tierColor("danger")).toBe(statusColor("major_outage"));
    expect(tierColor("unknown")).toBe(statusColor("unknown"));
  });
});

describe("worstTier", () => {
  it("is the worst tier present, not the most common", () => {
    expect(worstTier(["operational", "operational", "degraded"])).toBe("warn");
    expect(worstTier(["operational", "degraded", "major_outage"])).toBe("danger");
  });

  it("is ok only when every provider is operational", () => {
    expect(worstTier(["operational", "operational"])).toBe("ok");
  });

  // The headline beside the beacon already counts a never-measured provider as
  // not operational; a green beacon next to it would contradict it.
  it("ranks a never-measured provider above ok, so green means measured", () => {
    expect(worstTier(["operational", "unknown"])).toBe("unknown");
  });

  it("still ranks a real fault above a never-measured one", () => {
    expect(worstTier(["unknown", "degraded"])).toBe("warn");
  });

  it("reports unknown when there is no provider at all", () => {
    expect(worstTier([])).toBe("unknown");
  });
});
