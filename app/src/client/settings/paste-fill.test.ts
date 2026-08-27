import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyDraftPasteToPresets,
  applyLivePasteToRows,
  draftPatchFromPaste,
  guessPresetName,
  livePatchFromPaste,
  looksAutoPresetName,
  mapDraftProtocol,
  mapLiveProtocol,
  modelsFromParse,
  serializeParseFields,
  summarizePaste,
  type ClipboardParseResult,
} from "./paste-fill";

const parsed: ClipboardParseResult = {
  fields: {
    api_key: { value: "sk-test-key-abcdefghij", confidence: 0.96, source: "regex" },
    base_url: { value: "https://codex666ai.com/v1", confidence: 0.92, source: "regex" },
    protocol: { value: "responses", confidence: 0.95, source: "regex" },
    model: { value: "gpt-5.5", confidence: 0.95, source: "list" },
  },
  needsConfirm: [],
};

describe("paste-fill mapping", () => {
  it("maps protocols for live and draft", () => {
    assert.equal(mapLiveProtocol("responses"), "responses");
    assert.equal(mapLiveProtocol("openai-responses"), "responses");
    assert.equal(mapDraftProtocol("responses"), "openai-responses");
    assert.equal(mapDraftProtocol("anthropic"), "anthropic");
  });

  it("fills live patch and names auto presets", () => {
    const patch = livePatchFromPaste({ name: "provider-1" }, parsed);
    assert.equal(patch.url, "https://codex666ai.com/v1");
    assert.equal(patch.keyEdit, "sk-test-key-abcdefghij");
    assert.equal(patch.model, "gpt-5.5");
    assert.equal(patch.protocol, "responses");
    assert.equal(patch.vendor, "openai");
    assert.equal(patch.name, "codex666ai.com/gpt-5.5");
    assert.equal(looksAutoPresetName("provider-2"), true);
    assert.equal(looksAutoPresetName("work/main"), false);
  });

  it("fills draft patch with openai-responses", () => {
    const patch = draftPatchFromPaste({ name: "openai" }, parsed);
    assert.equal(patch.protocol, "openai-responses");
    assert.equal(patch.name, undefined);
  });

  it("summarizes filled fields", () => {
    const s = summarizePaste(parsed);
    assert.match(s, /Key/);
    assert.match(s, /gpt-5.5/);
    assert.match(s, /responses/);
  });

  it("collects multiple model ids and batches live rows", () => {
    const multi: ClipboardParseResult = {
      ...parsed,
      fields: {
        ...parsed.fields,
        model: {
          value: "gpt-5.2",
          confidence: 0.95,
          source: "list",
          candidates: ["gpt-5.2", "gpt-5.6", "gpt-5.6-sol"],
        },
      },
    };
    assert.deepEqual(modelsFromParse(multi), ["gpt-5.2", "gpt-5.6", "gpt-5.6-sol"]);
    assert.match(summarizePaste(multi), /3 个/);

    const applied = applyLivePasteToRows({
      rows: [
        {
          name: "provider-1",
          model: "",
          url: "https://api.openai.com/v1",
          keyEdit: "",
          protocol: "openai",
          vendor: "openai",
        },
      ],
      selected: 0,
      groupIndices: [0],
      parsed: multi,
      uniqueName: (base, existing) => {
        const set = new Set(existing);
        if (!set.has(base)) return base;
        return `${base}-2`;
      },
      seedRow: () => ({
        name: "model-1",
        model: "",
        url: "",
        keyEdit: "",
        protocol: "openai",
        vendor: "openai",
      }),
    });
    assert.equal(applied.rows.length, 3);
    assert.deepEqual(applied.rows.map((r) => r.model), ["gpt-5.2", "gpt-5.6", "gpt-5.6-sol"]);
    assert.equal(new Set(applied.rows.map((r) => r.url)).size, 1);
    assert.equal(applied.rows[0]!.url, "https://codex666ai.com/v1");
    assert.equal(applied.rows[0]!.keyEdit, "sk-test-key-abcdefghij");

    const draft = applyDraftPasteToPresets(
      [
        {
          name: "openai",
          url: "https://api.openai.com/v1",
          key: "old",
          model: "gpt-5",
          protocol: "openai",
        },
      ],
      0,
      multi,
      (n) => ({
        name: `preset-${n}`,
        url: "https://api.openai.com/v1",
        key: "",
        model: "gpt-5",
        protocol: "openai",
      }),
    );
    assert.equal(draft.presets.length, 3);
    assert.deepEqual(draft.presets.map((p) => p.model), ["gpt-5.2", "gpt-5.6", "gpt-5.6-sol"]);
  });

  it("serializes parse fields and names from host", () => {
    const fields = serializeParseFields({
      api_key: { value: "sk-x", confidence: 1, source: "regex" },
      skip: { value: "no", confidence: 1, source: "regex" },
      model: { value: "gpt-5.2", confidence: 1, source: "list", candidates: ["gpt-5.2", "gpt-5.6"] },
    });
    assert.equal(fields.api_key?.value, "sk-x");
    assert.deepEqual(fields.model?.candidates, ["gpt-5.2", "gpt-5.6"]);
    assert.equal(guessPresetName("https://api.deepseek.com/v1", "deepseek-chat", "openai"), "deepseek.com/deepseek-chat");
  });
});
