/**
 * 极简 API setup。复用全局 config.json，不依赖 cli 包。
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  isGlobalApiConfigured,
  saveGlobalApiConfig,
  resolveMaouConfigPath,
  loadPresetsFromMaouConfig,
} from "@little-house-studio/agent";
import type { APIPreset } from "@little-house-studio/llm";

function print(msg: string): void {
  output.write(msg + "\n");
}

export async function ensureInstallApiConfigured(): Promise<boolean> {
  if (process.env.MAOU_SKIP_API_SETUP === "1") return isGlobalApiConfigured();
  if (isGlobalApiConfigured()) return true;

  print("");
  print("首次使用需要配置 API（全系列共用）。");
  print(`配置文件：${resolveMaouConfigPath()}`);
  print("");

  if (!input.isTTY || !output.isTTY) {
    if (setupFromEnv()) return true;
    print("非交互终端。请设置 MAOU_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY 后重试。");
    return isGlobalApiConfigured();
  }

  const rl = readline.createInterface({ input, output });
  try {
    print("选择提供商：");
    print("  1) OpenAI");
    print("  2) Anthropic");
    print("  3) OpenRouter");
    print("  4) 自定义 OpenAI 兼容接口");
    const choiceRaw = (await rl.question("编号 [1]：")).trim() || "1";
    const choice = Math.max(1, Math.min(4, parseInt(choiceRaw, 10) || 1));

    const presets: Array<{
      url: string;
      protocol: APIPreset["protocol"];
      model: string;
      name: string;
    }> = [
      {
        url: "https://api.openai.com/v1/chat/completions",
        protocol: "openai",
        model: "gpt-4o",
        name: "openai",
      },
      {
        url: "https://api.anthropic.com/v1/messages",
        protocol: "anthropic",
        model: "claude-sonnet-4-5",
        name: "anthropic",
      },
      {
        url: "https://openrouter.ai/api/v1/chat/completions",
        protocol: "openai",
        model: "openai/gpt-4o",
        name: "openrouter",
      },
      { url: "", protocol: "openai", model: "gpt-4o", name: "custom" },
    ];
    const prov = presets[choice - 1]!;

    let url = prov.url;
    if (!url) {
      url = (await rl.question("API Base URL：")).trim();
      if (!url) {
        print("URL 不能为空");
        return false;
      }
    } else {
      const urlIn = (await rl.question(`API URL [${url}]：`)).trim();
      if (urlIn) url = urlIn;
    }

    const key = (await rl.question("API Key：")).trim();
    if (!key) {
      print("API Key 不能为空");
      return false;
    }

    const model = (await rl.question(`模型 id [${prov.model}]：`)).trim() || prov.model;
    const name = (await rl.question(`Preset 名称 [${prov.name}]：`)).trim() || prov.name;

    const path = saveGlobalApiConfig({
      presets: [
        {
          name,
          url,
          key,
          model,
          protocol: prov.protocol,
          maxTokens: 32768,
          maxContext: 128000,
          stream: true,
          nativeToolCalling: true,
        },
      ],
      defaultPreset: 0,
      replace: loadPresetsFromMaouConfig().length === 0,
    });
    print(`已保存：${path}`);
    return isGlobalApiConfigured();
  } finally {
    rl.close();
  }
}

function setupFromEnv(): boolean {
  const key =
    process.env.MAOU_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.ANTHROPIC_API_KEY?.trim() ||
    "";
  if (!key) return false;
  const isAnthropic =
    !!process.env.ANTHROPIC_API_KEY?.trim() &&
    !process.env.MAOU_API_KEY?.trim() &&
    !process.env.OPENAI_API_KEY?.trim();
  const url =
    process.env.MAOU_API_URL?.trim() ||
    (isAnthropic
      ? "https://api.anthropic.com/v1/messages"
      : "https://api.openai.com/v1/chat/completions");
  const model =
    process.env.MAOU_MODEL?.trim() || (isAnthropic ? "claude-sonnet-4-5" : "gpt-4o");
  const name = process.env.MAOU_PRESET_NAME?.trim() || (isAnthropic ? "anthropic" : "default");
  saveGlobalApiConfig({
    presets: [
      {
        name,
        url,
        key,
        model,
        protocol: isAnthropic ? "anthropic" : "openai",
        maxTokens: 32768,
        maxContext: 128000,
        stream: true,
        nativeToolCalling: true,
      },
    ],
    defaultPreset: 0,
    replace: false,
  });
  return true;
}
