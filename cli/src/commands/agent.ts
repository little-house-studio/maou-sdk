/**
 * maou <product> —— 在当前项目目录启动指定 agent 产品 TUI。
 *
 * 入口示例：
 *   maou coding          编程 agent（主产品）
 *   maou agent           coding 兼容别名
 *   maou                 默认 coding
 *   maou ./my-cli.ts     自定义配置路径
 *
 * 启动顺序：
 *   0. 依赖预检 / 自动补齐
 *   1. 系列首次 → maou setup（全局 API）
 *   2. 新路径 → 项目确认（创建 .maou）
 *   3. 进入 Ratatui TUI（唯一产品 UI）
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentCliConfig } from "../types.js";
import { ensureApiConfigured } from "./setup.js";
import { ensureProjectConsent } from "./project-gate.js";
import { resolveProduct, type MaouProduct } from "./products.js";

export interface AgentLaunchOptions {
  /**
   * 产品名（如 coding）。与 configTarget 二选一；
   * 都不传时默认 coding。
   */
  product?: string;
  /** 自定义 agent cli-config 路径 / 包名；优先于 product */
  configTarget?: string;
  themePath?: string;
  /** 跳过 API 门禁（仅测试） */
  skipSetup?: boolean;
  /** 跳过依赖预检 */
  skipDeps?: boolean;
  /** 跳过新项目确认 */
  skipProjectGate?: boolean;
  /** 新项目非交互确认 */
  yes?: boolean;
  /**
   * 历史兼容：曾支持 ink|ratatui。现仅 ratatui；
   * 传入 ink 会报错并提示编译二进制。
   */
  tui?: string;
}

async function loadConfigFromPath(target: string): Promise<AgentCliConfig> {
  const abs = resolve(target);
  let importPath = abs;
  if (!existsSync(abs) || abs.endsWith("/")) {
    for (const n of ["cli.ts", "index.ts", "agent-cli.ts", "cli-config.ts"]) {
      const c = `${abs}/${n}`;
      if (existsSync(c)) {
        importPath = c;
        break;
      }
    }
    if (importPath === abs) {
      const mod = await import(target);
      return (mod.default ?? mod) as AgentCliConfig;
    }
  }
  const mod = await import(importPath);
  const cfg = (mod.default ?? mod) as AgentCliConfig;
  if (!cfg?.createAgent) {
    throw new Error(`${importPath} 缺少 createAgent`);
  }
  return cfg;
}

async function resolveLaunchConfig(
  opts: AgentLaunchOptions,
): Promise<{ config: AgentCliConfig; product: MaouProduct }> {
  const productName = opts.product ?? "coding";
  const product = resolveProduct(productName);
  if (!product) {
    throw new Error(
      `未知产品「${productName}」。运行 maou --help 查看可用产品。`,
    );
  }

  if (opts.configTarget) {
    return {
      config: await loadConfigFromPath(opts.configTarget),
      product,
    };
  }

  return {
    config: await product.loadConfig(),
    product,
  };
}

/** 启动产品 TUI（Ratatui） */
export async function launchAgent(opts: AgentLaunchOptions = {}): Promise<void> {
  // 0) 依赖：Core 必须；缺则自动修复一次再查
  if (!opts.skipDeps && process.env.MAOU_SKIP_DEPS !== "1") {
    const { ensureDependencies, autoFixDependencies } = await import("./deps-check.js");
    let dep = await ensureDependencies({ autoInstall: false, quiet: true });
    if (!dep.tiers.core || !dep.tiers.dcg || !dep.tiers.terminal) {
      process.stderr.write("[maou] 依赖不完整，尝试自动修复…\n");
      const fix = await autoFixDependencies({
        quiet: false,
      });
      for (const e of fix.errors) process.stderr.write(`  ⚠ ${e}\n`);
      dep = await ensureDependencies({ autoInstall: false, quiet: true });
    }
    if (!dep.tiers.core) {
      process.stderr.write(
        "❌ Core 未就绪，无法启动。请运行：maou doctor\n" +
          dep.errors.map((e) => `   - ${e}`).join("\n") +
          "\n",
      );
      process.exit(1);
    }
    if (!dep.tiers.terminal) {
      process.stderr.write(
        "△ Terminal 未完整 — 降级 PTY。可再执行: maou doctor\n",
      );
    }
    if (!dep.tiers.dcg) {
      process.stderr.write("△ dcg 未就绪 — 危险命令门可能异常。maou doctor\n");
    }
  }

  // 1) 系列首次 → 全局 API setup
  if (!opts.skipSetup) {
    const ok = await ensureApiConfigured();
    if (!ok) {
      process.stderr.write(
        "❌ 全局 API 未配置。请运行：maou setup\n" +
          "   或设置 MAOU_API_KEY / OPENAI_API_KEY 后：maou setup --from-env\n",
      );
      process.exit(1);
    }
  }

  const { config, product } = await resolveLaunchConfig(opts);

  // 2) 新项目确认（product 写入 .maou/project.json）
  if (!opts.skipProjectGate && process.env.MAOU_SKIP_PROJECT_GATE !== "1") {
    const ok = await ensureProjectConsent({
      yes: opts.yes,
      product: product.productId,
    });
    if (!ok) {
      process.exit(1);
    }
  }

  const themePath = opts.themePath;

  // 画廊：catalog / 源图变更时自动重烘焙 ASCII
  try {
    const { syncGalleryOnStartup } = await import("../gallery/sync-gallery.js");
    const g = syncGalleryOnStartup({
      log: (m) => process.stderr.write(`  ${m}\n`),
    });
    if (g.rebuilt.length > 0) {
      process.stderr.write(`✓ 画廊已更新：${g.rebuilt.join(", ")}\n`);
    }
    if (g.errors.length > 0) {
      process.stderr.write(
        `△ 画廊烘焙警告：${g.errors.slice(0, 3).join(" | ")}\n`,
      );
    }
  } catch (e) {
    process.stderr.write(
      `△ 画廊同步跳过：${e instanceof Error ? e.message : String(e)}\n`,
    );
  }

  // 3) 唯一 TUI：Ratatui
  const flag = (opts.tui || process.env.MAOU_TUI || "").toLowerCase().trim();
  if (flag === "ink" || flag === "react") {
    process.stderr.write(
      "❌ Ink TUI 已移除。请使用 Ratatui：\n" +
        "  cd maou-sdk/cli && npm run build:tui-ratatui\n" +
        "  或 maou doctor\n" +
        "  或 MAOU_TUI_BIN=/path/to/maou-tui-ratatui maou coding\n",
    );
    process.exit(1);
  }

  const { markRatatuiActive } = await import("../tui-bridge/config.js");
  const { ensureRatatuiBinary } = await import("../tui-bridge/resolve-binary.js");
  const bin = ensureRatatuiBinary({
    tryBuild: true,
    log: (m) => process.stderr.write(`${m}\n`),
  });
  if (!bin) {
    process.stderr.write(
      "❌ 找不到 maou-tui-ratatui 二进制（Ink 已删除，无法回退）。\n" +
        "  编译：cd maou-sdk/cli && npm run build:tui-ratatui\n" +
        "  或：maou doctor\n" +
        "  或：MAOU_TUI_BIN=/path/to/maou-tui-ratatui\n",
    );
    process.exit(1);
  }

  markRatatuiActive();
  process.stderr.write(`[maou] tui=ratatui binary=${bin}\n`);
  const { runAgentWithRatatui } = await import("../tui-bridge/run-agent-ratatui.js");
  await runAgentWithRatatui({
    config,
    productName: product.name,
    themePath,
  });
}
