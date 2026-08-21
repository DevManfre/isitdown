import { beforeAll, describe, expect, it } from "vitest";
import i18n, { switchLocale } from "./i18n.ts";

beforeAll(async () => {
  await i18n.init();
});

describe("dashboard i18n", () => {
  it("treats a dotted key as one flat key", () => {
    expect(i18n.t("nav.overview")).not.toBe("nav.overview");
  });

  it("interpolates single-brace placeholders", () => {
    expect(i18n.t("overview.uptime-window", { uptime: "99.90%" })).toContain("99.90%");
  });

  it("selects the plural form by count", () => {
    const one = i18n.t("overview.title.down", { count: 1 });
    const many = i18n.t("overview.title.down", { count: 3 });
    expect(one).not.toBe(many);
    expect(many).toContain("3");
  });

  it("clamps an unsupported language to en before i18next sees it", async () => {
    // This tests switchLocale's own resolve() guard, NOT fallbackLng — the
    // guard rewrites "xx" to "en", so i18next is never asked for "xx".
    await switchLocale("xx");
    expect(i18n.language).toBe("en");
  });

  it("falls back to the english catalog when i18next IS given an unknown language", async () => {
    // Bypasses switchLocale deliberately: this is the assertion that actually
    // exercises fallbackLng, which is what keeps a missing catalog from
    // rendering raw keys.
    await i18n.changeLanguage("xx");
    expect(i18n.t("nav.overview")).toBe(i18n.getFixedT("en")("nav.overview"));
    expect(i18n.t("nav.overview")).not.toBe("nav.overview");
    await i18n.changeLanguage("en");
  });

  it("switches to the it catalog when it exists", async () => {
    await switchLocale("it");
    expect(i18n.language).toBe("it");
    expect(i18n.t("nav.overview")).not.toBe(i18n.getFixedT("en")("nav.overview"));
  });

  it("stamps the chosen language on <html> for the pre-paint script", async () => {
    await switchLocale("it");
    expect(document.documentElement.getAttribute("lang")).toBe("it");
    expect(localStorage.getItem("isitdown.uiLocale")).toBe("it");
  });

  it("does not escape interpolated values into html entities", async () => {
    await switchLocale("en");
    expect(i18n.t("overview.body.down", { providers: "A & B" })).toContain("A & B");
  });
});
