/// <reference types="node" />
// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import {
  impactColor, impactFill, impactKey, impactStatus, incidentStatusKey, INCIDENT_STEPS, pageWindow,
} from "./incidents.ts";

const tokens = readFileSync(new URL("../css/tokens.css", import.meta.url), "utf8");

describe("impact mapping", () => {
  it("maps every impact word the adapter can produce", () => {
    for (const impact of ["none", "minor", "major", "critical"]) {
      expect(en).toHaveProperty(impactKey(impact));
    }
  });

  it("orders impact onto the severity model", () => {
    expect(impactStatus("none")).toBe("operational");
    expect(impactStatus("minor")).toBe("degraded");
    expect(impactStatus("major")).toBe("partial_outage");
    expect(impactStatus("critical")).toBe("major_outage");
  });

  it("falls back to unknown for an impact word it has never seen", () => {
    expect(impactStatus("apocalyptic")).toBe("unknown");
    expect(en).toHaveProperty(impactKey("apocalyptic"));
  });

  it("resolves impact colours to declared tokens", () => {
    for (const impact of ["none", "minor", "major", "critical"]) {
      for (const value of [impactColor(impact), impactFill(impact)]) {
        const name = value.match(/var\((--[\w-]+)\)/)?.[1];
        expect(tokens).toContain(`${name}:`);
      }
    }
  });

  it("keys every lifecycle word the stepper walks through", () => {
    for (const step of INCIDENT_STEPS) {
      expect(en).toHaveProperty(incidentStatusKey(step));
    }
  });

  it("keys postmortem too, which is not a step but is a real status", () => {
    expect(en).toHaveProperty(incidentStatusKey("postmortem"));
  });
});

describe("pageWindow", () => {
  it("lists every page while they still fit", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps the first, the last and the current page's neighbours, gapping the rest", () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, "gap", 20]);
    expect(pageWindow(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
    expect(pageWindow(20, 20)).toEqual([1, "gap", 19, 20]);
  });

  it("never gaps a single hidden page — the number is shorter than the ellipsis", () => {
    expect(pageWindow(4, 8)).toEqual([1, 2, 3, 4, 5, "gap", 8]);
  });

  it("has no pages to list when there are none", () => {
    expect(pageWindow(1, 0)).toEqual([]);
  });
});
