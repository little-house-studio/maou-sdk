#!/usr/bin/env node
/**
 * Maou CLI 入口 —— 多产品路由器
 *
 *   maou coding         启动编程 agent（主产品）
 *   maou agent          coding 兼容别名
 *   maou                默认 coding
 *   maou setup          配置全局 API（全系列产品共用）
 *   maou doctor         检查/补齐依赖
 *   maou <path|pkg>     加载自定义 AgentCliConfig
 *
 * 后续新产品：在 commands/products.ts 登记后即可 `maou <name>` 启动。
 */

import { installExitGuard } from "./hooks/useExitGuard.js";
import { resolveMaouConfigPath } from "@little-house-studio/agent";
import {
  formatProductList,
  resolveCliToken,
} from "./commands/products.js";

const HELP = `Maou CLI — 终端 AI agent 多产品入口

用法:
  maou coding             启动编程 agent（当前主产品）
  maou agent              同 maou coding（兼容别名）
  maou                    默认启动 coding
  maou setup              配置全局 API（全系列产品共用，首次必做）
  maou setup --force      强制重新配置
  maou setup --from-env   从环境变量写入 API
  maou doctor             检查 Node/依赖，缺失则尝试自动安装
  maou coding --yes       新路径免确认直接创建 .maou
  maou coding --theme <name|path>  配色方案（assets/themes/<name>.json 或路径）
  maou <path|pkg>         加载自定义 agent cli 配置

产品:
${formatProductList()}

启动产品时顺序：
  0. 依赖预检（缺则自动装）
  1. 首次系列产品 → maou setup
  2. 新项目路径 → 确认后创建 .maou
  3. 进入 TUI

全局 API 配置文件（所有 Maou 系列产品共用）:
  ${resolveMaouConfigPath()}
  覆盖：MAOU_HOME 或 MAOU_LLM_CONFIG

环境变量:
  MAOU_HOME                用户态根目录（默认 ~/.maou）
  MAOU_LLM_CONFIG          全局 config.json 绝对路径
  MAOU_API_KEY             临时 key（或 OPENAI_API_KEY / ANTHROPIC_API_KEY）
  MAOU_SKIP_API_SETUP=1    跳过首次 setup（调试）
  MAOU_PROJECT_YES=1       等同 --yes（新项目确认）
  MAOU_NO_AUTO_INSTALL=1   禁止自动安装依赖
  MAOU_SKIP_DEPS=1         跳过依赖预检
  MAOU_SKIP_PROJECT_GATE=1 跳过新项目确认
  MAOU_LITE=1              帧率试验：关动画/hover/闪烁/轮询，历史窗缩到 12
  MAOU_LITE_HISTORY=N      LITE 下历史条数（默认 12）
  MAOU_PERF_HUD=0          关闭右上角性能条
  MAOU_TUI=ink|ratatui     TUI 后端（默认 ink；ratatui 需 cargo build）
  MAOU_TUI_BIN=path        ratatui 二进制路径（可选）
  maou coding --tui ratatui  同上（旗标优先于 env）
`;

function printHelp(): void {
  process.stdout.write(HELP);
}

// pino 日志不污染 Ink stdout
process.env.NODE_ENV = "production";

installExitGuard();

console.log = (...a: unknown[]) => {
  process.stderr.write(a.join(" ") + "\n");
};
console.warn = (...a: unknown[]) => {
  process.stderr.write(a.join(" ") + "\n");
};
console.error = (...a: unknown[]) => {
  process.stderr.write(a.join(" ") + "\n");
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let themePath: string | undefined;
  let setupForce = false;
  let setupFromEnv = false;
  let yes = false;

  /** 解析出的启动意图 */
  let systemCmd: string | undefined;
  let productName: string | undefined;
  let configTarget: string | undefined;
  let tuiBackend: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    }
    if (a === "--theme") {
      themePath = argv[++i];
      continue;
    }
    if (a === "--tui") {
      tuiBackend = argv[++i];
      continue;
    }
    if (a.startsWith("--tui=")) {
      tuiBackend = a.slice("--tui=".length);
      continue;
    }
    if (a === "--force") {
      setupForce = true;
      continue;
    }
    if (a === "--from-env") {
      setupFromEnv = true;
      continue;
    }
    if (a === "--yes" || a === "-y") {
      yes = true;
      continue;
    }
    if (a.startsWith("-")) {
      // 未知 flag 忽略，避免打断
      continue;
    }

    // 第一个非 flag 词决定路由；后续非 flag 仅在尚未有 configTarget 时作路径
    if (systemCmd || productName || configTarget) {
      // 已确定主意图后，多余位置参数暂忽略
      continue;
    }

    const resolved = resolveCliToken(a);
    switch (resolved.kind) {
      case "system":
        systemCmd = resolved.cmd;
        break;
      case "product":
        productName = resolved.product.name;
        break;
      case "config":
        configTarget = resolved.target;
        break;
      case "unknown":
        process.stderr.write(
          `❌ 未知子命令或产品「${resolved.token}」\n\n` +
            `可用产品:\n${formatProductList()}\n\n` +
            `系统命令: setup, doctor, help\n` +
            `自定义配置: maou <path-or-package>\n` +
            `运行 maou --help 查看完整帮助。\n`,
        );
        process.exit(1);
    }
  }

  if (systemCmd === "help") {
    printHelp();
    process.exit(0);
  }

  if (systemCmd === "doctor") {
    const { runDoctor } = await import("./commands/deps-check.js");
    const ok = await runDoctor();
    process.exit(ok ? 0 : 1);
  }

  if (systemCmd === "setup") {
    const { runSetup } = await import("./commands/setup.js");
    const ok = await runSetup({ force: setupForce, fromEnv: setupFromEnv });
    process.exit(ok ? 0 : 1);
  }

  // 产品启动：默认 coding；显式 path 时仍挂默认产品元数据（project 标记）
  const { launchAgent } = await import("./commands/agent.js");
  await launchAgent({
    product: productName ?? "coding",
    configTarget,
    themePath,
    yes,
    tui: tuiBackend,
  });
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`❌ ${err?.message ?? err}\n`);
  process.exit(1);
});
