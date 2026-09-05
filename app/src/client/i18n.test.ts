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
    assert.equal(t("session.more", "zh"), "更多");
    assert.equal(t("session.more", "en"), "More");
    assert.equal(t("session.group.today", "zh"), "今天");
    assert.equal(t("session.group.today", "en"), "Today");
    assert.equal(t("session.group.week", "zh"), "近 7 天");
    assert.equal(t("session.group.week", "en"), "Last 7 days");
    assert.equal(t("session.delete", "zh"), "删除");
    assert.equal(t("session.delete", "en"), "Delete");
    assert.equal(t("plugins.title", "zh"), "插件");
    assert.equal(t("plugins.title", "en"), "Plugins");
    assert.equal(t("settings.workspaceInstructions.on", "zh"), "注入");
    assert.equal(t("settings.workspaceInstructions.on", "en"), "On");
  });
});
