/**
 * coding-agent 的 CLI 配置 —— AgentCliConfig 实现。
 *
 * `maou`（无参数）默认加载此文件，启动 coding agent 的 CLI 界面。
 * agent 开发者可参照此文件写自己的 cli-config，用 `maou <path>` 加载。
 *
 * preset 从 ~/.maou/config.json 的 api.presets 读（和 maou-agent / 飞书一致），
 * 不用 LLMConfig（它读 llm-config.json，路径/结构不同）。
 */

import { ConfigStore } from "@little-house-studio/types";
import { SessionStore } from "@little-house-studio/context";
import { ToolRegistry, registerBuiltins } from "@little-house-studio/tools";
import { LLMClient } from "@little-house-studio/llm";
import type { APIPreset } from "@little-house-studio/llm";
import { createCodingAgent } from "./index.js";
import type { AgentCliConfig } from "@little-house-studio/agent";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

/** 从 ~/.maou/config.json 读 api.presets（和 maou-agent 一致） */
function loadPresets(): APIPreset[] {
  const configPath = process.env.MAOU_LLM_CONFIG
    ?? join(homedir(), ".maou", "config.json");
  if (!existsSync(configPath)) return [];
  try {
    const data = JSON.parse(readFileSync(configPath, "utf-8"));
    const presets = data?.api?.presets ?? data?.presets ?? [];
    return presets.filter((p: unknown) => p && typeof p === "object" && "name" in p);
  } catch {
    return [];
  }
}

let _presets: APIPreset[] | null = null;
function getPresets(): APIPreset[] {
  if (!_presets) _presets = loadPresets();
  return _presets;
}

const codingCliConfig: AgentCliConfig = {
  name: "coding",

  createAgent(projectRoot: string, maouRoot: string) {
    const configStore = new ConfigStore(projectRoot, maouRoot);
    const toolRegistry = new ToolRegistry();
    registerBuiltins(toolRegistry);
    const sessionStore = new SessionStore(join(projectRoot, ".maou", "sessions"));
    const llmClient = new LLMClient();

    const agent = createCodingAgent({
      projectRoot,
      maouRoot,
      configStore,
      sessionStore,
      toolRegistry,
      llmClient,
      log: () => {},           // 静默 Runtime 日志（避免污染 Ink stdout）
      enablePostLogger: false, // 关闭 pino postLogger（避免污染 Ink stdout）
    });
    // 透传完整 AgentHandle（含 agentName/projectRoot/toolWhitelist），
    // 让 cli 状态栏能动态显示「当前是哪个 agent 的 CLI」而非硬编码。
    return agent;
  },

  getPreset(_provider: string, model: string): Record<string, unknown> {
    // 从 config.json 的 presets 里按 name 或 model 匹配
    const presets = getPresets();
    const found = presets.find(p => p.name === model || p.model === model)
      ?? presets[0]; // 兜底用第一个
    if (!found) throw new Error(`未找到模型配置: ${model}（config.json 里有 ${presets.length} 个 preset）`);
    return found as unknown as Record<string, unknown>;
  },

  getProviders() {
    // 从 config.json 的 presets 提取 provider 列表
    const presets = getPresets();
    const seen = new Map<string, string>();
    for (const p of presets) {
      const id = p.name ?? p.model ?? "unknown";
      seen.set(id, p.name ?? id);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  },

  getModels(provider: string) {
    // provider = preset name，返回该 preset 下的 model
    const presets = getPresets();
    return presets
      .filter(p => p.name === provider)
      .map(p => ({ id: p.model ?? p.name ?? "unknown", name: p.model ?? p.name ?? "unknown" }));
  },
};

export default codingCliConfig;
