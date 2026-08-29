/**
 * Structural: layered LLM / Agent / template defaults settings surface.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));

function read(rel: string): string {
  return readFileSync(join(here, rel), "utf8");
}

describe("LiveSettingsPanel structure", () => {
  const src = read("LiveSettingsPanel.tsx");
  const adapters = read("settings-adapters.ts");
  const api = read("../api.ts");
  const llmCfg = read("../../server/llm-config.ts");
  const createServer = read("../../server/create-server.ts");

  it("combines agent + template + approval into top runtime_defaults section", () => {
    assert.match(adapters, /id:\s*["']runtime_defaults["']/);
    assert.match(adapters, /方案与审批/);
    assert.match(adapters, /id:\s*["']llm["']/);
    // runtime_defaults is first in nav
    assert.match(
      adapters,
      /LIVE_SETTINGS_SECTIONS[\s\S]*appearance[\s\S]*runtime_defaults[\s\S]*llm/,
    );
    assert.match(src, /data-live-settings-section=["']appearance["']/);
    assert.match(src, /data-sheet-theme/);
    assert.match(src, /data-live-settings-section=["']runtime_defaults["']/);
    assert.match(src, /data-live-settings-section-agent/);
    assert.match(src, /data-live-settings-section-template/);
    assert.match(src, /data-live-settings-section-approval/);
    assert.match(src, /data-live-block=["']roles["']/);
    assert.match(src, /data-live-block=["']approval["']/);
    assert.match(src, /主模型/);
    assert.match(src, /小模型/);
    assert.match(src, /多模态/);
    assert.match(src, /权限套餐|终端审批/);
  });

  it("LLM section: vendor + model + multimodal + price + advanced", () => {
    assert.match(src, /厂商配置|预设厂商|厂商连接/);
    assert.match(src, /urlParams|URL 附加/);
    assert.match(src, /data-live-cap-image|图片/);
    assert.match(src, /data-live-cap-audio|音频/);
    assert.match(src, /data-live-cap-video|视频/);
    assert.match(src, /inputPricePerMt|输入价/);
    assert.match(src, /outputPricePerMt|输出价/);
    assert.match(src, /maxConcurrent|最大并发/);
    assert.match(src, /temperature/);
    assert.match(src, /top_p|topP/);
    assert.match(src, /presence_penalty|presencePenalty/);
    assert.match(src, /frequency_penalty|frequencyPenalty/);
    assert.match(src, /extraBody|请求自定义/);
    assert.match(src, /showAdvanced|更多参数/);
  });

  it("LLM section: connection test + SVG 降智探针画廊", () => {
    assert.match(src, /测试连接/);
    assert.match(src, /runLlmSvgProbe|运行画图探针/);
    assert.match(src, /设为标准参考/);
    assert.match(src, /模型画图探针/);
    assert.match(src, /请求已通|未抽出/);
    assert.match(api, /svg-probe/);
    assert.match(api, /setSvgProbeReference|runLlmSvgProbe/);
    // 业务 ok=false 不能 jsonOrThrow 成无意义的 "http 200"
    assert.match(api, /readJsonBody/);
    assert.doesNotMatch(
      api,
      /export async function runLlmSvgProbe[\s\S]{0,500}jsonOrThrow/,
    );
  });

  it("agent + template share roles SoT and bind main/fast/vision", () => {
    assert.match(src, /data-live-role=\{roleId\}/);
    assert.match(src, /roleSelect\(\s*["']main["']/);
    assert.match(src, /roleSelect\(\s*["']fast["']/);
    assert.match(src, /roleSelect\(\s*["']vision["']/);
    assert.match(src, /api\.roles/);
    assert.match(src, /转译/);
    assert.match(src, /role-main|role-vision|runtime_defaults/);
    assert.match(llmCfg, /AGENT_MODEL_ROLES/);
    assert.match(llmCfg, /templateHint/);
  });

  it("LLM section: paste fill card then form, no auto save", () => {
    assert.match(src, /PasteFillCard/);
    assert.match(src, /parseLlmClipboard/);
    assert.match(src, /applyClipboardParse/);
    assert.match(api, /\/api\/config\/llm\/parse/);
    assert.match(api, /parseLlmClipboard/);
    assert.doesNotMatch(src, /applyLlmPresetToConfig/);
  });

  it("persists via config APIs not only setModel", () => {
    assert.match(src, /fetchLlmConfig/);
    assert.match(src, /saveLlmConfig/);
    assert.match(api, /\/api\/config\/llm/);
    assert.match(api, /roles\?:/);
    assert.match(api, /inputPricePerMt/);
    assert.match(llmCfg, /saveGlobalApiConfig/);
    assert.match(llmCfg, /inputPrice|input_price/);
    assert.match(llmCfg, /maxConcurrent|max_concurrent/);
    assert.match(createServer, /mountLlmConfigRoutes/);
  });

  it("never uses draft showcase as SoT", () => {
    assert.doesNotMatch(src, /defaultApiConfig/);
    assert.doesNotMatch(src, /sk-draft-/);
    assert.match(src, /data-live-settings=["']true["']/);
  });
});
