/**
 * Drive shipped llm-config helpers (layered LLM + roles).
 * Isolation via configPath — never touches live ~/.maou/config.json.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  AGENT_MODEL_ROLES,
  composeUrl,
  isMaskedOrEmptyKey,
  loadLlmConfigSnapshot,
  maskApiKey,
  mergePresetPreservingKey,
  saveLlmConfigFromClient,
} from "./llm-config.js";

describe("llm-config pure helpers", () => {
  it("maskApiKey never returns full long secrets", () => {
    const full = "sk-live-secret-key-abcdefghijklmnop";
    const m = maskApiKey(full);
    assert.notEqual(m, full);
    assert.ok(m.includes("•"));
    assert.equal(isMaskedOrEmptyKey(""), true);
    assert.equal(isMaskedOrEmptyKey(m), true);
    assert.equal(isMaskedOrEmptyKey("sk-real-new-key-xyz"), false);
  });

  it("composeUrl appends query params", () => {
    assert.equal(
      composeUrl("https://api.example.com/v1", "api-version=1"),
      "https://api.example.com/v1?api-version=1",
    );
  });

  it("merge preserves key and stores multimodal + pricing + sampling", () => {
    const disk = {
      name: "m1",
      url: "https://x/v1",
      model: "old",
      key: "sk-disk-secret-keep",
      protocol: "openai",
    };
    const merged = mergePresetPreservingKey(
      {
        name: "m1",
        url: "https://x/v1",
        model: "new-model",
        key: "",
        supportsImage: true,
        supportsAudio: true,
        supportsVideo: true,
        temperature: "0.7",
        topP: "0.9",
        inputPricePerMt: "1.5",
        outputPricePerMt: "6",
        maxConcurrent: "4",
        customRequestJson: '{"foo":1}',
      },
      disk,
    ) as Record<string, unknown>;
    assert.equal(merged.key, "sk-disk-secret-keep");
    assert.equal(merged.model, "new-model");
    assert.equal(merged.supportsVision, true);
    assert.equal(merged.supportsAudio, true);
    assert.equal(merged.supportsVideo, true);
    assert.equal(merged.temperature, 0.7);
    assert.equal(merged.inputPrice, 1.5);
    assert.equal(merged.outputPrice, 6);
    assert.equal(merged.maxConcurrent, 4);
    // nested pricing for computeCost / stream
    const pricing = merged.pricing as {
      inputPrice?: number;
      outputPrice?: number;
    };
    assert.equal(pricing?.inputPrice, 1.5);
    assert.equal(pricing?.outputPrice, 6);
    const body = merged.extraBody as Record<string, unknown>;
    assert.equal(body?.temperature, 0.7);
    assert.equal(body?.top_p, 0.9);
    assert.equal(body?.foo, 1);
  });

  it("agent role defs cover main/fast/vision with template hints", () => {
    const ids = AGENT_MODEL_ROLES.map((r) => r.id);
    assert.ok(ids.includes("main"));
    assert.ok(ids.includes("fast"));
    assert.ok(ids.includes("vision"));
    for (const r of AGENT_MODEL_ROLES) {
      assert.ok(r.templateHint.length > 0);
    }
  });
});

describe("llm-config load/save persist (temp path)", () => {
  const dir = mkdtempSync(join(tmpdir(), "maou-llm-cfg-"));
  const configPath = join(dir, "config.json");
  after(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("round-trips vendor/model/advanced fields + roles main/fast/vision", () => {
    writeFileSync(
      configPath,
      JSON.stringify({ api: { presets: [], defaultPreset: 0 } }, null, 2),
    );

    const saved = saveLlmConfigFromClient({
      configPath,
      replace: true,
      roles: {
        main: "primary",
        fast: "cheap",
        vision: "primary",
      },
      presets: [
        {
          name: "primary",
          vendor: "openai",
          protocol: "openai",
          url: "https://api.example.com/v1",
          urlParams: "region=cn",
          model: "big-model",
          key: "sk-test-secret-value-9999",
          maxContext: 64000,
          maxTokens: 8192,
          supportsImage: true,
          supportsAudio: true,
          supportsVideo: false,
          temperature: "0.2",
          presencePenalty: "0.1",
          frequencyPenalty: "0.05",
          inputPricePerMt: "2",
          outputPricePerMt: "8",
          cacheHitPricePerMt: "0.5",
          maxConcurrent: "3",
          customRequestJson: '{"thinking":{"type":"disabled"}}',
        },
        {
          name: "cheap",
          vendor: "custom",
          protocol: "openai",
          url: "https://cheap.example.com/v1",
          model: "small-model",
          key: "sk-cheap-key-aaaa",
          supportsImage: false,
          inputPricePerMt: "0.1",
          outputPricePerMt: "0.3",
        },
      ],
    });

    assert.equal(saved.presets.length, 2);
    assert.equal(saved.roles.main, "primary");
    assert.equal(saved.roles.fast, "cheap");
    assert.equal(saved.roles.vision, "primary");
    const primary = saved.presets.find((p) => p.name === "primary")!;
    assert.equal(primary.supportsImage, true);
    assert.equal(primary.supportsAudio, true);
    assert.equal(primary.inputPricePerMt, "2");
    assert.equal(primary.outputPricePerMt, "8");
    assert.equal(primary.maxConcurrent, "3");
    assert.equal(primary.temperature, "0.2");
    assert.ok(
      primary.urlParams.includes("region=cn") ||
        primary.url.includes("region=cn"),
    );
    assert.notEqual(primary.keyMasked, "sk-test-secret-value-9999");
    assert.ok(!JSON.stringify(saved).includes("sk-test-secret-value-9999"));

    const disk = JSON.parse(readFileSync(configPath, "utf8")) as {
      api: {
        roles?: { main?: string; fast?: string; vision?: string };
        presets: Array<Record<string, unknown>>;
      };
    };
    assert.equal(disk.api.roles?.main, "primary");
    assert.equal(disk.api.roles?.fast, "cheap");
    assert.equal(disk.api.presets[0]!.key, undefined);
    assert.equal(disk.api.presets[0]!.keyRef, "file:primary");
    const vault = JSON.parse(readFileSync(join(dir, "secrets.json"), "utf8")) as {
      keys?: Record<string, string>;
    };
    assert.equal(vault.keys?.primary, "sk-test-secret-value-9999");
    // 磁盘为 models[] 嵌套；模型级字段在 models[0]
    const diskModels = disk.api.presets[0]!.models as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(diskModels) && diskModels.length >= 1);
    assert.equal(diskModels[0]!.id, "big-model");
    assert.equal(diskModels[0]!.temperature, 0.2);
    assert.equal(diskModels[0]!.inputPrice, 2);
    assert.equal(disk.api.presets[0]!.maxConcurrent ?? diskModels[0]!.maxConcurrent, 3);
    const diskPricing = (diskModels[0]!.pricing ?? disk.api.presets[0]!.pricing) as {
      inputPrice?: number;
      outputPrice?: number;
      cacheHitPrice?: number;
    };
    assert.equal(diskPricing?.inputPrice, 2);
    assert.equal(diskPricing?.outputPrice, 8);
    assert.equal(diskPricing?.cacheHitPrice, 0.5);
    const diskBody = (diskModels[0]!.extraBody ?? disk.api.presets[0]!.extraBody) as Record<
      string,
      unknown
    >;
    assert.equal(diskBody?.temperature, 0.2);
    assert.equal(diskBody?.presence_penalty, 0.1);

    // empty key update preserves secret
    const again = saveLlmConfigFromClient({
      configPath,
      replace: true,
      roles: { main: "primary", fast: "cheap", vision: "cheap" },
      presets: [
        {
          name: "primary",
          url: "https://api.example.com/v1",
          model: "big-model-v2",
          key: "",
          maxContext: 64000,
          maxTokens: 8192,
        },
        {
          name: "cheap",
          url: "https://cheap.example.com/v1",
          model: "small-model",
          key: "",
        },
      ],
    });
    assert.equal(again.roles.vision, "cheap");
    assert.equal(again.presets[0]!.model, "big-model-v2");
    assert.equal(again.presets[0]!.hasKey, true);
    const disk2 = JSON.parse(readFileSync(configPath, "utf8")) as {
      api: { presets: { key?: string }[] };
    };
    assert.equal(disk2.api.presets[0]!.key, undefined);
    assert.equal(disk2.api.presets[0]!.keyRef, "file:primary");

    const snap = loadLlmConfigSnapshot(configPath);
    assert.equal(snap.roles.main, "primary");
    assert.equal(snap.configPath, configPath);
  });
});

describe("paste parse does not write config", () => {
  it("fills fields from a compact paste", async () => {
    const { parseLlmClipboardText } = await import("./paste-parse.js");
    const r = await parseLlmClipboardText(
      [
        "api_key: sk-abcDEF1234567890xyz",
        "base_url: https://api.deepseek.com/v1",
        "model: gpt-4o",
      ].join("\n"),
      { probeModels: false },
    );
    assert.equal(r.fields.api_key?.value, "sk-abcDEF1234567890xyz");
    assert.equal(r.fields.base_url?.value, "https://api.deepseek.com/v1");
    assert.equal(r.fields.model?.value, "gpt-4o");
    assert.equal(r.fields.protocol?.value, "openai");
  });
});
