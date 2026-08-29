#!/usr/bin/env node
/**
 * Maou CLI 入口 —— 多产品路由器
 *
 *   maou                启动机器级 Ops Agent（默认）
 *   maou coding         启动当前目录的编程 agent
 *   maou agent          coding 兼容别名
 *   maou setup          配置全局 API（全系列产品共用）
 *   maou doctor         检查/补齐依赖
 *   maou <path|pkg>     加载自定义 AgentCliConfig
 *
 * 后续新产品：在 commands/products.ts 登记后即可 `maou <name>` 启动。
 */

import { installExitGuard } from "./hooks/useExitGuard.js";
import { resolveMaouConfigPath } from "@little-house-studio/agent";
import {
  DEFAULT_PRODUCT,
  formatProductList,
  resolveCliToken,
} from "./commands/products.js";

const HELP = `Maou CLI — 终端 AI agent 多产品入口

用法:
  maou                    启动机器级 Ops Agent（固定全局数据路径）
  maou ops                同 maou
  maou coding             启动当前目录的编程 Agent，并创建/复用 .maou
  maou agent              同 maou coding（兼容别名）
  maou setup              配置全局 API（全系列产品共用，首次必做）
  maou setup --force      强制重新配置
  maou setup --from-env   从环境变量写入 API
  maou --version          显示版本与安装形态
  maou doctor             诊断并自动修复依赖（缺啥补啥）
  maou doctor --check     只诊断，不修复
  maou doctor --agent     脚本修完后交给安装员继续
  maou aiinstall [任务]   安装员（无 TUI）
  aiinstall [任务]        同上（独立命令）
  maou update             更新（预编译包→下载新包；源码树→git pull + 构建）
  maou update --check     只检查有无更新，不应用
  maou update --force     强制重装 / 脏工作区先 stash 再 pull
  maou update --no-build  只 pull 不构建（仅源码树）
  maou update --channel X 切换发布通道 stable|dev（仅预编译包）
  maou session analyze    诊断会话：轮次/token/cache/浪费启发式
  maou session analyze <id> [--write] [--md] [--json]
  maou session export [id] -o <file.zip>
  maou coding --yes       新路径免确认
  maou <path|pkg>         自定义配置

产品:
${formatProductList()}

启动产品时顺序：
  0. 依赖预检（缺则自动装）
  1. 首次系列产品 → maou setup
  2. maou coding 新项目路径 → 确认后创建 .maou 并注册全局项目索引
  3. maou 使用固定全局 Ops 数据路径；不改当前目录
  4. 进入 Ratatui TUI

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
  MAOU_PERF_HUD=0          关闭右上角 Debug 性能条（设置 → Debug 显示 会写入 ~/.maou/cli-ui.json）
  MAOU_TUI_BIN=path        ratatui 二进制（默认 ~/.maou/bin/maou-tui-ratatui）
  MAOU_TUI=ratatui         仅 ratatui（ink 已删除）
  MAOU_DCG_PATH            dcg 二进制绝对路径
  MAOU_DOC_EXTRACT=1       文档抽取模式：拦截 write_file/edit_file
  MAOU_PIPELINE_ISOLATE=1  拒读 gold/management/previous_runs 路径段
  MAOU_DENY_PATH_SEGMENTS  额外 deny 段（逗号分隔）
  MAOU_MINIMAL_CONTEXT=1   项目上下文仅注入 RULE.md
  MAOU_PROJECT_CONTEXT     full|minimal|off（项目说明注入）
`;

function printHelp(): void {
  process.stdout.write(HELP);
}

// pino 日志不污染 TTY stdout
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
  const restArgv: string[] = [];

  let channel: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") {
      printHelp();
      process.exit(0);
    }
    if (a === "-v" || a === "--version") {
      const { runtimeVersionLabel } = await import("./commands/runtime-mode.js");
      process.stdout.write(`maou ${runtimeVersionLabel()}\n`);
      process.exit(0);
    }
    if (a === "--channel") {
      channel = argv[++i];
      continue;
    }
    if (a.startsWith("--channel=")) {
      channel = a.slice("--channel=".length);
      continue;
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
    if (systemCmd || productName || configTarget) {
      restArgv.push(a);
      continue;
    }

    if (a.startsWith("-")) {
      // 未知 flag 忽略，避免打断
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
            `系统命令: setup, doctor, update, session, help\n` +
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
    const { parseDoctorFlags, runDoctor } = await import("./commands/deps-check.js");
    const flags = parseDoctorFlags(argv);
    const ok = await runDoctor(flags);
    process.exit(ok ? 0 : 1);
  }

  if (systemCmd === "setup") {
    const { runSetup } = await import("./commands/setup.js");
    const ok = await runSetup({ force: setupForce, fromEnv: setupFromEnv });
    process.exit(ok ? 0 : 1);
  }

  if (systemCmd === "update") {
    const { runUpdate } = await import("./commands/update.js");
    const ok = await runUpdate({
      force: setupForce || argv.includes("--force"),
      keepTarget: argv.includes("--keep-target"),
      check: argv.includes("--check"),
      noBuild: argv.includes("--no-build"),
      channel,
    });
    process.exit(ok ? 0 : 1);
  }

  if (systemCmd === "session") {
    // maou session analyze [id] [--write] [--md] [--json]
    const rest = argv.filter((a) => a !== "session");
    const sub = rest.find((a) => !a.startsWith("-")) ?? "analyze";
    if (sub === "export") {
      const afterSub = rest.filter((a) => a !== "export");
      const { runSessionExport } = await import("./commands/session-export.js");
      const ok = runSessionExport({ argv: afterSub });
      process.exit(ok ? 0 : 1);
    }
    if (sub !== "analyze") {
      process.stderr.write(
        `❌ 未知 session 子命令「${sub}」\n` +
          `   用法: maou session analyze [sessionId] [--write] [--md] [--json]\n` +
          `         maou session export [sessionId] -o <file.zip>\n`,
      );
      process.exit(1);
    }
    const afterSub = rest.filter((a) => a !== "analyze");
    const { runSessionAnalyze } = await import("./commands/session-analyze.js");
    const ok = runSessionAnalyze({ argv: afterSub });
    process.exit(ok ? 0 : 1);
  }

  // 产品启动：默认机器级 ops；显式 path 仍挂默认产品元数据。
  const { launchAgent } = await import("./commands/agent.js");
  await launchAgent({
    product: productName ?? DEFAULT_PRODUCT,
    configTarget,
    themePath,
    yes,
    tui: tuiBackend,
    extraArgv: restArgv,
  });
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`❌ ${err?.message ?? err}\n`);
  process.exit(1);
});
