import { describe, expect, it } from "vitest";
import { deviceLabel, encode } from "./push.ts";

describe("deviceLabel", () => {
  it("names the browser and the platform so two devices are told apart", () => {
    expect(
      deviceLabel(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
      ),
    ).toBe("Chrome · Windows");
    expect(deviceLabel("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0")).toBe(
      "Firefox · Linux",
    );
  });

  it("falls back rather than showing an empty label", () => {
    expect(deviceLabel("")).toBe("Browser");
  });
});

describe("encode", () => {
  it("emits base64url, not standard base64", () => {
    // 0xfb 0xf0 is standard-base64 "+/A=": both characters base64url
    // forbids, plus the padding it drops entirely. web-push and
    // `PushSubscription.toJSON()` both speak base64url, so a key whose
    // bytes happen to base64-encode to all-alphanumeric characters would
    // pass either encoding and hide a regression back to `btoa`'s raw
    // output.
    const buffer = new Uint8Array([0xfb, 0xf0]).buffer;
    expect(encode(buffer)).toBe("-_A");
  });

  it("returns an empty string for a missing key", () => {
    expect(encode(null)).toBe("");
  });
});
