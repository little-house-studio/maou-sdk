// ── 组装入口 ──────────────────────────────────────────────────────────
//
// 依赖环：App 的 Editor.onSubmit 需要 driver.send；driver 需要 tui + app 的
// getState/setState。解法：用共享 state 盒打破环 —— driver 和 app 都读写
// 同一个 box.state。App 持 box 引用，setState 同步回 box；driver 的
// getState/setState 直接操作 box。
//
// index.ts 调用 createAppWithConfig(state, config)，它完成全部接线。

import { TUI, Editor, ProcessTerminal } from "@oh-my-pi/pi-tui";
import type { AgentDriver, AgentCliConfig } from "./agent.js";
import { App } from "./app.js";
import type { UIState } from "./state/types.js";
import type { SoundConfig } from "./sound.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 共享 state 盒：driver 与 app 共享同一份 state，避免循环构造依赖。 */
export interface StateBox {
  state: UIState;
}

export interface AppHandle {
  tui: TUI;
  app: App;
  driver: AgentDriver;
  editor: Editor;
  box: StateBox;
}

/**
 * 从 ~/.maou/config.json 读取 ui.sounds 配置段。
 * 轻量读取，不依赖 ConfigStore（避免 zod/jsonc-parser 重依赖）。
 */
function loadSoundConfig(): Partial<SoundConfig> | undefined {
  const maouRoot = process.env.HOME ?? "";
  const cfgPath = join(maouRoot, ".maou", "config.json");
  if (!existsSync(cfgPath)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
    const ui = raw.ui as Record<string, unknown> | undefined;
    if (!ui) return undefined;
    const sounds = ui.sounds as Record<string, unknown> | undefined;
    if (!sounds) return undefined;
    // 逐步提取，保持和 SoundConfig.events 结构兼容
    const result: Partial<SoundConfig> = {};
    if (typeof sounds.enabled === "boolean") result.enabled = sounds.enabled;
    if (typeof sounds.volume === "number") result.volume = sounds.volume;
    if (typeof sounds.idleTimeout === "number" || typeof sounds.idleTimeoutSec === "number") {
      result.idleTimeoutSec = typeof sounds.idleTimeoutSec === "number" ? sounds.idleTimeoutSec : sounds.idleTimeout as number;
    }
    // 每事件开关
    const evtDone = typeof sounds.done === "boolean" ? sounds.done : undefined;
    const evtError = typeof sounds.error === "boolean" ? sounds.error : undefined;
    const evtWarning = typeof sounds.warning === "boolean" ? sounds.warning : undefined;
    const evtApproval = typeof sounds.approval === "boolean" ? sounds.approval : undefined;
    if (evtDone !== undefined || evtError !== undefined || evtWarning !== undefined || evtApproval !== undefined) {
      // SoundManager.updateConfig / constructor 中会用 { ...DEFAULT.events, ...partial.events } 合并
      // 所以这里只需传非 undefined 的字段即可
      result.events = {
        done: evtDone ?? true,
        error: evtError ?? true,
        warning: evtWarning ?? true,
        approval: evtApproval ?? true,
      };
    }
    return result;
  } catch {
    return undefined;
  }
}

/**
 * 完整组装：tui + box + driver + app。index.ts 用这个（已 loadConfig）。
 * 返回的 handle.box.state 是唯一真源；driver 与 app 都指向它。
 */
export function createAppWithConfig(
  state: UIState,
  config: AgentCliConfig,
  DriverCtor: typeof AgentDriver,
): AppHandle {
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal, false);
  const box: StateBox = { state };

  // 加载音效配置
  const soundConfig = loadSoundConfig();

  // driver 接线到 box + tui
  const driver = new DriverCtor(config, {
    tui,
    getState: () => box.state,
    setState: (updater) => {
      box.state = updater(box.state);
      app.setState(box.state);  // 同步到 app（app 持有旧引用，需显式更新）
    },
    soundConfig,
  });

  const app = new App(box.state, driver, tui);
  // app.setState 后同步回 box（保持 driver.getState() 一致）
  const origSetState = app.setState.bind(app);
  app.setState = (s: UIState) => {
    origSetState(s);
    box.state = s;
  };

  tui.addChild(app);
  tui.setFocus(app.getEditor());
  return { tui, app, driver, editor: app.getEditor(), box };
}
