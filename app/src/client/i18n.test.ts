import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { t } from "./i18n.ts";

describe("t()", () => {
  it("returns the key when missing", () => {
    assert.equal(t("not.a.real.key", "zh"), "not.a.real.key");
    assert.equal(t("not.a.real.key", "en"), "not.a.real.key");
  });

  it("shares the same keys in zh and en", () => {
    assert.equal(t("composer.send", "zh"), "发送");
    assert.equal(t("composer.send", "en"), "Send");
  });
});
