#!/usr/bin/env node
/**
 * MAOU TUI —— 通用 agent 终端 UI 库（磁带复古未来主义，基于 Pi TUI）。
 *
 * 本文件导出：
 *   - runTui(config, opts?)        直接传 AgentCliConfig 实例启动
 *   - runTuiFromPath(target, opts) 从路径/包名加载 agent 配置后启动
 *   - loadAgentConfig(target?)     通用 agent 配置加载器
 *
 * 不硬编码任何 agent 模板——`maou <path>` 由调用方决定加载哪个。
 *
 * 退出安全网：installExitGuard 恢复终端（备用屏/光标/鼠标）。
 * console.log/warn 重定向到 stderr（SDK 内部 console.log 会撕裂 Pi 画面）。
 *
 * 用法（agent 模板的 CLI 入口）：
 *   import { runTui } from "@little-house-studio/tui";
 *   runTui(myConfig);
 *
 * 用法（通用 maou 启动器）：
 *   maou @little-house-studio/coding-agent/cli-config
 *   maou ./agents/foo
 */

import { createAppWithConfig } from "./app.js";
import { AgentDriver, loadAgentConfig } from "./agent.js";
export { loadAgentConfig };
import { initialState } from "./state/types.js";
import type { AgentCliConfig } from "@little-house-studio/agent";
import { emergencyTerminalRestore, getKeybindings } from "@oh-my-pi/pi-tui";

// ── 退出安全网 ─────────────────────────────────────────────────────────
// Pi 普通模式不进备用屏，但 crash/SIGKILL 下仍需恢复终端（光标/raw mode/同步
// 输出/bracketed paste/kitty keyboard 等）。用 Pi 原生 emergencyTerminalRestore
// （terminal.ts:262，比手拼转义序列覆盖更多 crash 路径，含 Windows codepage）。
// Pi 不自动注册 process.on 信号处理器，这部分由我们做。
let exitGuardInstalled = false;
export function installExitGuard(): void {
  if (exitGuardInstalled) return;
  exitGuardInstalled = true;

  const restore = (): void => {
    try { emergencyTerminalRestore(); } catch { /* 兜底：至少恢复基础状态 */ }
  };

  const onSignal = (sig: NodeJS.Signals): void => {
    restore();
    process.exitCode = sig === "SIGINT" ? 130 : 143;
    setTimeout(() => process.exit(process.exitCode), 50);
  };

  process.on("exit", restore);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("SIGHUP", onSignal);
  process.on("uncaughtException", (err) => {
    restore();
    process.stderr.write(`\n[maou-tui] uncaught: ${err?.stack ?? err}\n`);
    process.exit(1);
  });
}

// ── 预初始化：在 tui.start 前必须执行 ────────────────────────────────
/** 在 runTui 前自动调用。也可由 agent CLI 入口提前调用。 */
export function preInit(): void {
  process.env.NODE_ENV = "production";
  console.log = (...a: unknown[]) => { process.stderr.write(a.join(" ") + "\n"); };
  console.warn = (...a: unknown[]) => { process.stderr.write(a.join(" ") + "\n"); };
  console.error = (...a: unknown[]) => { process.stderr.write(a.join(" ") + "\n"); };
  installExitGuard();
}

// ── 启动选项 ───────────────────────────────────────────────────────────
export interface RunTuiOptions {
  /** agent 工作目录（agent 的 projectRoot）。默认 process.cwd()。 */
  cwd?: string;
}

// ── runTui：核心入口（传 config 实例） ────────────────────────────────
/**
 * 启动 TUI 界面。由 agent 模板的 CLI 入口调用，直接传 AgentCliConfig 实例。
 *
 * @example
 * ```ts
 * import { runTui } from "@little-house-studio/tui";
 * import myConfig from "./cli-config.js";
 * runTui(myConfig);
 * ```
 */
export function runTui(config: AgentCliConfig, opts?: RunTuiOptions): void {
  preInit();

  if (opts?.cwd) {
    try {
      process.chdir(opts.cwd);
    } catch (e) {
      process.stderr.write(`❌ cwd ${opts.cwd}: ${e instanceof Error ? e.message : e}\n`);
      process.exit(1);
    }
  }

  const state = initialState();
  const handle = createAppWithConfig(state, config, AgentDriver);

  handle.driver.initProviderModel();
  handle.app.startTimers();

  // Ctrl+C：streaming 时中断，否则退出
  // Ctrl+C：用 Pi keybindings 识别（tui.select.cancel = ctrl+c/escape），
  // 与 Pi 键位体系一致，支持用户自定义键位。abort vs 退出是 app 业务语义。
  const kb = getKeybindings();
  handle.tui.addInputListener((data: string) => {
    if (kb.matches(data, "tui.select.cancel")) {
      if (handle.box.state.streaming) {
        handle.driver.abort();
        return { consume: true };
      }
      handle.app.stopTimers();
      handle.tui.stop();
      process.exit(130);
    }
    return undefined;
  });

  const checkExit = (): void => {
    if (handle.box.state.exitRequested) {
      handle.app.stopTimers();
      handle.tui.stop();
      process.exit(0);
    }
  };
  const exitPoll = setInterval(checkExit, 200);

  handle.tui.start();

  const origStop = handle.tui.stop.bind(handle.tui);
  handle.tui.stop = () => {
    clearInterval(exitPoll);
    origStop();
  };
}

// ── runTuiFromPath：从路径/包名加载后启动 ─────────────────────────────
/**
 * 从 target（路径/包名）加载 AgentCliConfig 后启动 TUI。
 * `maou <path>` 命令的核心。
 *
 * @param target agent 模板路径或包名
 * @param opts   启动选项
 */
export async function runTuiFromPath(target: string, opts?: RunTuiOptions): Promise<void> {
  preInit();
  let config: AgentCliConfig;
  try {
    config = await loadAgentConfig(target);
  } catch (e) {
    process.stderr.write(`❌ 加载 agent 配置失败: ${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
  }
  runTui(config, opts);
}
