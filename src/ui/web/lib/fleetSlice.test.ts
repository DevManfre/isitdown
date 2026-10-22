import { describe, expect, it } from "vitest";
import { providerFixture } from "@/test/harness.tsx";
import { fleetSlice } from "./fleetSlice.ts";
import type { ProviderGroupStatus } from "./types.ts";

const github = providerFixture({ id: "github", name: "GitHub", uptime90: 99.9 });
const aws = providerFixture({ id: "aws", name: "AWS", uptime90: 100 });
const stripe = providerFixture({ id: "stripe", name: "Stripe", uptime90: 99.5 });
const off = providerFixture({ id: "off", name: "Off", enabled: false, uptime90: 10 });
const configured = [github, aws, stripe, off];

const groups: ProviderGroupStatus[] = [
  { id: "cloud", providers: ["aws"], status: "operational", affected: [] },
  { id: "pay", providers: ["stripe"], status: "operational", affected: [] },
];

const none = { groups: [], providers: [] };

describe("fleetSlice", () => {
  it("is the whole enabled fleet when the filter is empty — the Overview's own numbers", () => {
    const slice = fleetSlice(configured, groups, none);
    expect(slice.providers.map((p) => p.id)).toEqual(["github", "aws", "stripe"]);
    // (99.9 + 100 + 99.5) / 3, to two places — what Overview always showed.
    expect(slice.average).toBe(99.8);
    expect(slice.shape).toBe("compact");
    expect(slice.groups).toEqual(groups);
    expect(slice.filtered).toBe(false);
    expect(slice.empty).toBe(false);
  });

  it("takes a group's members, in fleet order", () => {
    const slice = fleetSlice(configured, groups, { groups: ["cloud"], providers: [] });
    expect(slice.providers.map((p) => p.id)).toEqual(["aws"]);
    expect(slice.groups.map((g) => g.id)).toEqual(["cloud"]);
    expect(slice.average).toBe(100);
    expect(slice.filtered).toBe(true);
  });

  it("is the union of the named groups and the named providers", () => {
    const slice = fleetSlice(configured, groups, { groups: ["pay"], providers: ["github"] });
    expect(slice.providers.map((p) => p.id)).toEqual(["github", "stripe"]);
    expect(slice.groups.map((g) => g.id)).toEqual(["pay"]);
  });

  it("keeps a group that holds a named provider, even when the group is not named", () => {
    const slice = fleetSlice(configured, groups, { groups: [], providers: ["aws"] });
    expect(slice.groups.map((g) => g.id)).toEqual(["cloud"]);
  });

  it("never widens to the whole fleet when every name in the filter is gone", () => {
    const slice = fleetSlice(configured, groups, { groups: ["gone"], providers: ["heroku"] });
    expect(slice.providers).toEqual([]);
    expect(slice.empty).toBe(true);
    expect(slice.filtered).toBe(true);
  });

  it("leaves disabled providers out even when named", () => {
    const slice = fleetSlice(configured, groups, { groups: [], providers: ["off"] });
    expect(slice.providers).toEqual([]);
    expect(slice.empty).toBe(true);
  });
});
