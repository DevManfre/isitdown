import { describe, expect, it } from "vitest";
import type { RoutingRule } from "@/lib/types.ts";
import { componentMuteTarget, isComponentSilenced, withComponentSilenced, withoutComponentSilence } from "./componentMute.ts";

const catchAll: RoutingRule = {
  provider: "*",
  classes: ["status", "incident", "maintenance", "monitoring"],
  minSeverity: "any",
  channels: ["*"],
};

describe("componentMute", () => {
  it("names a component the way the routing core does", () => {
    expect(componentMuteTarget("github", "8l4ygp009s5s")).toBe("github#8l4ygp009s5s");
  });

  it("puts the silencing rule before every other, because the first match wins", () => {
    const next = withComponentSilenced([catchAll], "github#actions");
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual({
      provider: "github#actions",
      classes: ["status", "incident", "maintenance", "monitoring"],
      minSeverity: "any",
      channels: [],
    });
    expect(next[1]).toBe(catchAll);
  });

  it("does not add a second rule for a component that is already silenced", () => {
    const once = withComponentSilenced([catchAll], "github#actions");
    expect(withComponentSilenced(once, "github#actions")).toBe(once);
  });

  it("reads a component as silenced only when its rule sends nowhere", () => {
    const routed: RoutingRule = { ...catchAll, provider: "github#actions", channels: ["telegram"] };
    expect(isComponentSilenced([routed], "github#actions")).toBe(false);
    expect(isComponentSilenced([{ ...routed, channels: [] }], "github#actions")).toBe(true);
    expect(isComponentSilenced([catchAll], "github#actions")).toBe(false);
  });

  it("lifts the silence without touching a rule the operator routed on purpose", () => {
    const routed: RoutingRule = { ...catchAll, provider: "github#actions", channels: ["telegram"] };
    const silence = withComponentSilenced([], "github#actions")[0] as RoutingRule;
    expect(withoutComponentSilence([silence, routed, catchAll], "github#actions")).toEqual([routed, catchAll]);
  });

  it("leaves the list alone when there is no silence to lift", () => {
    const rules = [catchAll];
    expect(withoutComponentSilence(rules, "github#actions")).toBe(rules);
  });
});
