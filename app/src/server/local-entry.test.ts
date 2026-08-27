import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAOU_APP_BIND_HOST,
  MAOU_APP_DEFAULT_PORT,
  maouAppPublicUrl,
} from "./local-entry.js";

describe("local entry simple IP:port", () => {
  it("public URL is 127.0.0.1:8787", () => {
    assert.equal(MAOU_APP_BIND_HOST, "127.0.0.1");
    assert.equal(MAOU_APP_DEFAULT_PORT, 8787);
    assert.equal(maouAppPublicUrl(), "http://127.0.0.1:8787");
    assert.ok(!maouAppPublicUrl().includes("maou.localhost"));
  });
});
