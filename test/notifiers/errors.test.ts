import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChannelError, failUnlessOk } from "../../src/notifiers/errors.ts";

describe("failUnlessOk", () => {
  it("resolves on an ok response without reading the body", async () => {
    const response = new Response("fine", { status: 200 });
    await failUnlessOk("slack", response);
    assert.equal(response.bodyUsed, false);
  });

  it("rejects with the status and the trimmed reason", async () => {
    const response = new Response(" Unknown Webhook ", { status: 404 });
    await assert.rejects(failUnlessOk("discord", response), (error: unknown) => {
      assert.ok(error instanceof ChannelError);
      assert.equal(error.message, "discord notification failed: HTTP 404 (Unknown Webhook)");
      assert.equal(error.status, 404);
      assert.equal(error.channel, "discord");
      return true;
    });
  });

  it("omits the parentheses when the body is empty", async () => {
    const response = new Response("", { status: 500 });
    await assert.rejects(failUnlessOk("slack", response), {
      message: "slack notification failed: HTTP 500",
    });
  });

  it("falls back to the status alone when the body cannot be read", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new Error("boom"));
      },
    });
    const response = new Response(body, { status: 502 });
    await assert.rejects(failUnlessOk("slack", response), {
      message: "slack notification failed: HTTP 502",
    });
  });

  it("uses a custom verb in the message", async () => {
    const response = new Response("nope", { status: 401 });
    await assert.rejects(failUnlessOk("bluesky", response, "login failed"), {
      message: "bluesky notification login failed: HTTP 401 (nope)",
    });
  });
});
