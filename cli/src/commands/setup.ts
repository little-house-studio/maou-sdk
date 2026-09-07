/**
 * maou setup —— 配置全系列产品共用的全局 API（~/.maou/config.json）。
 *
 * 交互式；写盘后 chmod 0600。其它 maou 产品读同一文件。
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

export interface SetupOptions {
  /** 已配置时仍重新走向导 */
  force?: boolean;
  /** 非交互：从环境变量写最小 preset（CI） */
  fromEnv?: boolean;
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
    defaultModel: "",
  });
  return rows;
}

function print(msg: string): void {
  output.write(msg + "\n");
}

/**
 * 系列产品首次运行门禁：未配置全局 API 时先 maou setup，再继续原产品。
 * 已配置则跳过。返回是否已具备可用配置。
 */
export async function ensureApiConfigured(opts: SetupOptions = {}): Promise<boolean> {
  if (!opts.force && isGlobalApiConfigured()) return true;
  print("");
  print("══════════════════════════════════════");
  print("  首次使用 Maou 系列产品");
  print("══════════════════════════════════════");
  print("需要先完成全局 API 配置（全系列共用，之后其它产品无需重配）。");
  print(`配置文件：${resolveMaouConfigPath()}`);
  print("即将进入 maou setup …");
  print("");
  const ok = await runSetup(opts);
  if (ok) {
    print("✓ 全局 API 已就绪，继续启动产品…");
    print("");
  }
  return ok;
}

/** 是否「系列产品尚未配置过」—— 与 ensureApiConfigured 条件一致 */
export function isFirstSeriesRun(): boolean {
  return !isGlobalApiConfigured();
}

/**
 * 交互配置全局 API。
 * @returns 是否成功写入可用配置
 */
export async function runSetup(opts: SetupOptions = {}): Promise<boolean> {
  const configPath = resolveMaouConfigPath();
  print("══════════════════════════════════════");
  print("  Maou Setup · 全局 API 配置");
  print("══════════════════════════════════════");
  print(`将写入（全系列产品共用）：`);
  print(`  ${configPath}`);
  print("");

  if (opts.fromEnv) {
    return setupFromEnv();
  }

  if (!opts.force && isGlobalApiConfigured()) {
    const existing = Object.keys(loadProvidersFromMaouConfig());
    print(`已检测到 ${existing.length} 个厂商路由。`);
    print("使用 --force 可覆盖/追加。");
    print("");
    return true;
  }

  if (!input.isTTY || !output.isTTY) {
    print("非交互终端。可：");
    print("  1) 设置环境变量后：maou setup --from-env");
    print("     MAOU_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY");
    print("     可选 MAOU_API_URL、MAOU_MODEL");
    print("  2) 手动编辑：");
    print(`     ${configPath}`);
    return isGlobalApiConfigured();
  }

  const rl = readline.createInterface({ input, output });
  try {
    const PROVIDERS = catalogChoices();
    print("选择提供商（目录 id 即路由）：");
    PROVIDERS.forEach((p, i) => print(`  ${i + 1}) ${p.label} (${p.id})`));
    const choiceRaw = (await rl.question("编号 [1]：")).trim() || "1";
    const choice = Math.max(1, Math.min(PROVIDERS.length, parseInt(choiceRaw, 10) || 1));
    const prov = PROVIDERS[choice - 1]!;

    let url = prov.url;
    if (prov.id === "custom" || !url) {
      url = (await rl.question("API Base URL（完整 chat/completions 地址）：")).trim();
      if (!url) {
        print("❌ URL 不能为空");
        return false;
      }
    } else {
      const urlIn = (await rl.question(`API URL [${url}]：`)).trim();
      if (urlIn) url = urlIn;
    }

    const key = (await rl.question("API Key（可留空，稍后补；请勿分享）：")).trim();

    const modelDefault = prov.defaultModel || "gpt-4o";
    const model =
      (await rl.question(`模型 id [${modelDefault}]：`)).trim() || modelDefault;

    let id = prov.id;
    if (id === "custom") {
      const rawId = (await rl.question("路由 id [custom]：")).trim() || "custom";
      id = rawId.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "custom";
      if (!/^[a-z]/.test(id)) id = `p-${id}`;
    }

    const maxContextRaw = (await rl.question("maxContext 上下文窗口 [128000]：")).trim();
    const maxContext = Math.max(1024, parseInt(maxContextRaw, 10) || 128000);

    const path = saveGlobalApiConfig({
      providers: {
        [id]: {
          displayName: prov.label,
          protocol: prov.protocol,
          url,
          key,
          keyRef: `file:${id}`,
          defaultModel: model,
          models: [{ id: model, maxContext, maxTokens: 32768 }],
        },
      },
      roles: { main: { provider: id, model } },
      replace: !!opts.force && (await confirmReplace(rl)),
    });

    print("");
    print(`✓ 已保存全局 API 配置：${path}`);
    print("  此后 coding agent / 其它 Maou 系列产品共用此文件。");
    print("");
    return true;
  } finally {
    rl.close();
  }
}

async function confirmReplace(rl: readline.Interface): Promise<boolean> {
  const existing = Object.keys(loadProvidersFromMaouConfig());
  if (existing.length === 0) return true;
  const a = (await rl.question(`已有 ${existing.length} 个厂商。全部替换？[y/N]：`)).trim().toLowerCase();
  return a === "y" || a === "yes";
}

function setupFromEnv(): boolean {
  const key =
    process.env.MAOU_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    process.env.ANTHROPIC_API_KEY?.trim() ||
    "";
  if (!key) {
    print("❌ --from-env 需要 MAOU_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY");
    return false;
  }
  const isAnthropic = !!process.env.ANTHROPIC_API_KEY?.trim() && !process.env.MAOU_API_KEY?.trim() && !process.env.OPENAI_API_KEY?.trim();
  const url =
    process.env.MAOU_API_URL?.trim() ||
    (isAnthropic
      ? "https://api.anthropic.com/v1/messages"
      : "https://api.openai.com/v1/chat/completions");
  const model =
    process.env.MAOU_MODEL?.trim() ||
    (isAnthropic ? "claude-sonnet-4-5" : "gpt-4o");
  const name = process.env.MAOU_PRESET_NAME?.trim() || (isAnthropic ? "anthropic" : "default");

  const path = saveGlobalApiConfig({
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
  print(`✓ 已从环境变量写入：${path}`);
  return true;
}
