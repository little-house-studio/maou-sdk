import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_CHAT_IMAGES, sanitizeChatImages } from "./chat-images.js";

describe("sanitizeChatImages", () => {
  it("keeps image/* base64 and strips data URLs", () => {
    const out = sanitizeChatImages([
      { mimeType: "image/png", data: "data:image/png;base64,AAA" },
      { mimeType: "text/plain", data: "nope" },
      { mimeType: "image/jpeg", data: "  BBB  " },
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0]!.data, "AAA");
    assert.equal(out[1]!.data, "BBB");
  });

  it("caps count and rejects empty", () => {
    const raw = Array.from({ length: MAX_CHAT_IMAGES + 3 }, (_, i) => ({
      mimeType: "image/png",
      data: `x${i}`,
    }));
    assert.equal(sanitizeChatImages(raw).length, MAX_CHAT_IMAGES);
    assert.deepEqual(sanitizeChatImages(null), []);
  });
});
