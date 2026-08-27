import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAOU_WEBUI_BIND_HOST,
  MAOU_WEBUI_DEFAULT_PORT,
  maouWebUiPublicUrl,
} from "./local-entry.js";

describe("local entry simple IP:port", () => {
  it("public URL is 127.0.0.1:8787", () => {
    assert.equal(MAOU_WEBUI_BIND_HOST, "127.0.0.1");
    assert.equal(MAOU_WEBUI_DEFAULT_PORT, 8787);
    assert.equal(maouWebUiPublicUrl(), "http://127.0.0.1:8787");
    assert.ok(!maouWebUiPublicUrl().includes("maou.localhost"));
  });
});
