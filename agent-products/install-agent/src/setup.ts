/**
 * 极简 API setup。复用全局 config.json，不依赖 cli 包。
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  isGlobalApiConfigured,
  saveGlobalApiConfig,
  resolveMaouConfigPath,
  loadProvidersFromMaouConfig,
} from "@little-house-studio/agent";
import { builtinCatalog } from "@little-house-studio/llm";

function print(msg: string): void {
  output.write(msg + "\n");
}

function catalogChoices(): Array<{
  id: string;
  label: string;
  url: string;
  protocol: string;
  defaultModel: string;
}> {
  const rows = builtinCatalog().map((p) => ({
    id: p.id,
    label: p.name,
    url: p.baseUrl,
    protocol: String(p.protocol ?? "openai"),
    defaultModel: p.models[0]?.id ?? "",
  }));
  rows.push({
    id: "custom",
    label: "自定义 OpenAI 兼容接口",
    url: "",
    protocol: "openai",
    defaultModel: "gpt-4o",
  });
  return rows;
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
    const choices = catalogChoices();
    print("选择提供商（目录 id 即路由）：");
    choices.forEach((p, i) => print(`  ${i + 1}) ${p.label} (${p.id})`));
    const choiceRaw = (await rl.question("编号 [1]：")).trim() || "1";
    const choice = Math.max(1, Math.min(choices.length, parseInt(choiceRaw, 10) || 1));
    const prov = choices[choice - 1]!;

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

    const key = (await rl.question("API Key（可留空）：")).trim();
    const model =
      (await rl.question(`模型 id [${prov.defaultModel || "gpt-4o"}]：`)).trim() ||
      prov.defaultModel ||
      "gpt-4o";
    let id = prov.id;
    if (id === "custom") {
      const rawId = (await rl.question("路由 id [custom]：")).trim() || "custom";
      id = rawId.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "custom";
      if (!/^[a-z]/.test(id)) id = `p-${id}`;
    }

    const path = saveGlobalApiConfig({
      providers: {
        [id]: {
          displayName: prov.label,
          protocol: prov.protocol,
          url,
          key,
          keyRef: `file:${id}`,
          defaultModel: model,
          models: [{ id: model, maxContext: 128000, maxTokens: 32768 }],
        },
      },
      roles: { main: { provider: id, model } },
      replace: Object.keys(loadProvidersFromMaouConfig()).length === 0,
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
    providers: {
      [name]: {
        displayName: name,
        protocol: isAnthropic ? "anthropic" : "openai",
        url,
        key,
        keyRef: `file:${name}`,
        defaultModel: model,
        models: [{ id: model, maxContext: 128000, maxTokens: 32768 }],
      },
    },
    roles: { main: { provider: name, model } },
    replace: false,
  });
  return true;
}
