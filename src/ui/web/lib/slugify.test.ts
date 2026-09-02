import { describe, expect, it } from "vitest";
import { slugify } from "./slugify.ts";

// The point of the helper is that whatever comes out is a value
// `config.schema.ts` accepts, so every case asserts against that same regex
// as well as the exact slug.
const SERVICE_ID = /^[a-z0-9][a-z0-9-]*$/;

describe("slugify", () => {
  it("lowercases a single-word name", () => {
    expect(slugify("GitHub")).toBe("github");
  });

  it("joins words with a dash, never an underscore", () => {
    expect(slugify("Google Cloud Platform")).toBe("google-cloud-platform");
  });

  it("strips accents rather than dropping the letter", () => {
    expect(slugify("Città di Modena")).toBe("citta-di-modena");
  });

  it("collapses punctuation runs into one dash", () => {
    expect(slugify("Cloudflare — Workers & KV")).toBe("cloudflare-workers-kv");
  });

  it("never leaves a leading or trailing dash", () => {
    expect(slugify("  .Anthropic!  ")).toBe("anthropic");
  });

  it("keeps digits and existing dashes", () => {
    expect(slugify("s3-eu-west-1")).toBe("s3-eu-west-1");
  });

  it("returns an empty string when there is nothing sluggable", () => {
    expect(slugify("   ")).toBe("");
    expect(slugify("!!!")).toBe("");
  });

  it("produces a valid service id for every non-empty case", () => {
    for (const name of ["GitHub", "Google Cloud Platform", "Città di Modena", "Cloudflare — Workers & KV", "  .Anthropic!  "]) {
      expect(slugify(name)).toMatch(SERVICE_ID);
    }
  });
});
