/**
 * Live settings adapters — pure entry points (no re-implementation).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Meta } from "../api";
import {
  buildLiveSettingsSnapshot,
  emptyLiveSettingsSnapshot,
  isDraftShowcaseApiKey,
  looksLikeDraftShowcasePreset,
  resolveModelAfterProviderChange,
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
});
