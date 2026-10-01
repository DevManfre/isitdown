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
    expect(i18n.t("overview.body.down", { count: 1, providers: "A & B" })).toContain("A & B");
  });

  // Roadmap SEM-228: the English wording for these three keys happens to read
  // the same for one and many, which would hide a regression that drops the
  // "_one"/"_other" split back to a single fixed-plural key. Italian conjugates
  // the verb/adjective, so asserting against it is what actually catches that.
  describe("agrees the verb/adjective with the count, not just picking a key", () => {
    beforeAll(async () => {
      await switchLocale("it");
    });

    it("overview.body.down", () => {
      const one = i18n.t("overview.body.down", { count: 1, providers: "GitHub" });
      const many = i18n.t("overview.body.down", { count: 2, providers: "GitHub e Cloudflare" });
      expect(one).toContain("non è operativo");
      expect(many).toContain("non sono operativi");
    });

    it("overview.body.unreadable", () => {
      const one = i18n.t("overview.body.unreadable", { count: 1, providers: "GitHub" });
      const many = i18n.t("overview.body.unreadable", { count: 2, providers: "GitHub e Cloudflare" });
      expect(one).toContain("è giù");
      expect(many).toContain("sono giù");
    });

    it("stack.affected", () => {
      const one = i18n.t("stack.affected", { count: 1, names: "GitHub", total: 2 });
      const many = i18n.t("stack.affected", { count: 2, names: "GitHub e Cloudflare", total: 2 });
      expect(one).toContain("non operativo");
      expect(many).toContain("non operativi");
    });

    it("channel.summary.count", () => {
      const one = i18n.t("channel.summary.count", { count: 1, total: 3 });
      const many = i18n.t("channel.summary.count", { count: 2, total: 3 });
      expect(one).toBe("1 attivo su 3");
      expect(many).toBe("2 attivi su 3");
    });
  });
});
