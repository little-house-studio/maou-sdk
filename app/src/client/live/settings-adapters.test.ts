/**
 * Live settings adapters — pure entry points (no re-implementation).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Meta } from "../api";
import {
  APPROVAL_MODES,
  LIVE_SETTINGS_SECTIONS,
  approvalModeHint,
  approvalModeLabel,
  buildLiveSettingsSnapshot,
  emptyLiveSettingsSnapshot,
  isApprovalMode,
  permissionPresetLabel,
  permissionPresetName,
  isDraftShowcaseApiKey,
  looksLikeDraftShowcasePreset,
  resolveModelAfterProviderChange,
  withApprovalMode,
} from "./settings-adapters";
import { defaultApiConfig } from "../drafts/api-settings";

const liveMeta: Meta = {
  sessionId: "s1",
  provider: "xfyun-glm-coding",
  model: "xopglm51",
  projectRoot: "/Users/me/proj",
  sandboxMode: "yolo",
  approvalMode: "yolo",
  agentName: "coding",
  providers: [
    { id: "xfyun-glm-coding", name: "xfyun-glm-coding" },
    { id: "xfyun-qwen-coding", name: "xfyun-qwen-coding" },
  ],
  models: [{ id: "xopglm51", name: "xopglm51" }],
};

describe("live settings adapters", () => {
  it("buildLiveSettingsSnapshot maps meta providers/models (not showcase seeds)", () => {
    const snap = buildLiveSettingsSnapshot(liveMeta);
    assert.equal(snap.offline, false);
    assert.equal(snap.provider, "xfyun-glm-coding");
    assert.equal(snap.model, "xopglm51");
    assert.ok(snap.providers.some((p) => p.id === "xfyun-qwen-coding"));
    assert.ok(snap.models.some((m) => m.id === "xopglm51"));
    assert.match(snap.statusLabel, /live|xfyun/);
    assert.equal(snap.projectRoot, "/Users/me/proj");
    assert.equal(snap.approvalMode, "yolo");
    assert.equal(snap.workspaceInstructions, true);
  });

  it("workspaceInstructions follows meta false", () => {
    const snap = buildLiveSettingsSnapshot({ ...liveMeta, workspaceInstructions: false });
    assert.equal(snap.workspaceInstructions, false);
  });

  it("empty / null meta is offline without fake openai gpt-5", () => {
    const snap = buildLiveSettingsSnapshot(null);
    assert.equal(snap.offline, true);
    assert.notEqual(snap.provider, "openai");
    assert.notEqual(snap.model, "gpt-5");
    assert.equal(emptyLiveSettingsSnapshot().offline, true);
  });

  it("resolveModelAfterProviderChange keeps or falls back", () => {
    const models = [{ id: "a" }, { id: "b" }];
    assert.equal(resolveModelAfterProviderChange(models, "b"), "b");
    assert.equal(resolveModelAfterProviderChange(models, "gone"), "a");
    assert.equal(resolveModelAfterProviderChange([], "x"), "");
  });

  it("detects draft showcase keys from defaultApiConfig seed", () => {
    const seed = defaultApiConfig().presets[0]!;
    assert.ok(isDraftShowcaseApiKey(seed.key));
    assert.ok(looksLikeDraftShowcasePreset(seed));
    assert.equal(isDraftShowcaseApiKey("sk-real-user-key"), false);
  });

  it("live meta snapshot is not draft showcase shape", () => {
    const snap = buildLiveSettingsSnapshot(liveMeta);
    assert.equal(
      looksLikeDraftShowcasePreset({
        key: "",
        model: snap.model,
        url: "",
      }),
      false,
    );
  });

  it("nav puts appearance first, then runtime_defaults, then llm", () => {
    assert.ok(LIVE_SETTINGS_SECTIONS.length >= 3);
    const ids = LIVE_SETTINGS_SECTIONS.map((s) => s.id);
    assert.equal(ids[0], "appearance");
    assert.ok(ids.includes("runtime_defaults"));
    assert.ok(ids.includes("llm"));
    assert.equal(LIVE_SETTINGS_SECTIONS[0]!.label, "外观");
  });

  it("approval mode helpers cover normal/auto/yolo", () => {
    assert.deepEqual([...APPROVAL_MODES], ["normal", "auto", "yolo"]);
    assert.equal(isApprovalMode("normal"), true);
    assert.equal(isApprovalMode("auto"), true);
    assert.equal(isApprovalMode("yolo"), true);
    assert.equal(isApprovalMode("ask"), false);
    assert.match(approvalModeLabel("normal"), /普通|白名单|询问/);
    assert.match(approvalModeHint("yolo"), /放行|YOLO|yolo/i);
  });

  it("permission presets use the same short name + comment as slash commands", () => {
    assert.equal(permissionPresetName("workspace+ask"), "ask");
    assert.equal(permissionPresetLabel("workspace+ask"), "询问");
    assert.equal(permissionPresetName("workspace+auto"), "auto");
    assert.equal(permissionPresetLabel("workspace+auto"), "审核");
    assert.equal(permissionPresetName("open+yolo"), "yolo");
    assert.equal(permissionPresetLabel("open+yolo"), "放开");
  });

  it("withApprovalMode updates snapshot display fields", () => {
    const base = buildLiveSettingsSnapshot(liveMeta);
    const next = withApprovalMode(base, "normal");
    assert.equal(next.approvalMode, "normal");
    assert.equal(next.sandboxMode, "normal");
    assert.match(next.statusLabel, /normal/);
    assert.equal(next.provider, base.provider);
  });

  it("snapshot prefers approvalMode over sandboxMode when both set", () => {
    const snap = buildLiveSettingsSnapshot({
      ...liveMeta,
      approvalMode: "auto",
      sandboxMode: "yolo",
    });
    assert.equal(snap.approvalMode, "auto");
  });
});
