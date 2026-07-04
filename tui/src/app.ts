/**
 * 主 TUI app —— agent 界面（基于 Pi TUI）的瘦壳。
 *
 * 布局（垂直栈，自顶向下）：
 *   顶栏  ：MAOU logo + agent 状态（1 行）
 *   对话区：消息列表（user/assistant Markdown + thinking 折叠 + tool 卡片）—— flexGrow
 *           实现 NativeScrollbackLiveRegion：稳定区进终端原生 scrollback，
 *           活跃流式区视口内重绘。滚轮走终端原生 scrollback。
 *   事件块：流式 token 上下行 + 思考中/生成中（1 行）
 *   输入框：Pi Editor（多行，onSubmit 发送，Alt+Enter 换行）
 *   状态栏：时码/信道/agent名/思考级/token条/sparkline/model（1 行）
 *
 * 配色：Marathon（暗棕底 #0C0A08 + 火焰橙 #FF8A3D + 数据青 #26C6DA）。
 * 装饰：// ▌ ▸ HH:MM:SS REC ● ████░░ [ch.NN] —— 每个元素都有信息功能。
 *
 * App 类只持有 state/driver/editor/tui 引用 + 缓存字段；具体渲染委托给
 * render/ 各模块的纯函数，scrollback 逻辑委托给 scrollback/regions.ts，
 * 组装入口在 assembly.ts。
 */

import {
  TUI, Editor, Markdown, CombinedAutocompleteProvider,
} from "@oh-my-pi/pi-tui";
import type {
  Component,
  NativeScrollbackLiveRegion, NativeScrollbackCommittedRows,
} from "@oh-my-pi/pi-tui";
import type { AgentDriver } from "./agent.js";
import type { UIState } from "./state/types.js";
import { FileHistoryStorage } from "./history.js";
import { editorTheme } from "./theme/themes.js";
import { SYM } from "./theme/symbols.js";
import { slashCommands, handleSlashCommand } from "./commands/slash-commands.js";
import type { MdCache } from "./render/markdown.js";
import { renderTopBar } from "./render/topbar.js";
import { renderStatusBar } from "./render/statusbar.js";
import { renderInput } from "./render/input.js";
import { renderToast } from "./render/toast.js";
import { renderEmpty } from "./render/empty.js";
import { buildChatRegions, type RegionCache } from "./scrollback/regions.js";

// ── 主 App 组件：垂直栈布局 + 原生 scrollback ──────────────────────
/**
 * App 是一个 Component，同时实现 NativeScrollbackLiveRegion（方案 A）。
 *
 * 对话区分两段：
 *   - 稳定区（stableRows）：已 finalize 的消息（user 已发、assistant 已 done），
 *     字节冻结，报告为 liveRegionStart——滚出视口顶部的行被 Pi 引擎
 *     提交进终端原生 scrollback，用户用终端滚轮翻历史。
 *   - 活跃区（liveRows）：当前 streaming 的 assistant 消息，视口内就地重绘。
 *     commitSafeEnd 报告其已生成的稳定前缀（最后一行除外），让长消息
 *     滚出视口的头部也能提前进 scrollback，不悬空。
 *
 * Pi 的 Box 无 flexGrow，故手动算高度分配（顶栏/对话区/事件块/输入框/状态栏）。
 */

/** 薄包装：把预格式化行数组变成 Pi Component（喂给 Box 等容器，不做 wrap）。 */
class Lines implements Component {
  constructor(private rows: readonly string[]) {}
  render(_width: number): readonly string[] { return this.rows; }
  invalidate(): void {}
}

export class App implements Component, NativeScrollbackLiveRegion, NativeScrollbackCommittedRows {
  private state: UIState;
  private driver: AgentDriver;
  private editor: Editor;
  private spinnerFrame = 0;
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private tui: TUI;
  /** Markdown 实例缓存：msgId → { content, width, instance } */
  private mdCache: MdCache = new Map<string, { content: string; width: number; instance: Markdown }>();
  /** 输入历史存储（上键填充历史） */
  private historyStorage = new FileHistoryStorage();

  // ── 对话区行缓存（稳定区 + 活跃区）—— 委托给 RegionCache ──
  private regionCache: RegionCache = {
    stableRows: [],
    stableSig: "",
    liveRows: [],
    liveSig: "",
    liveRegionStart: 0,
    commitSafeEnd: 0,
  };

  // ── NativeScrollback 边界（render 时算出，供引擎读取） ──
  /** 引擎回写的已提交行数（stable 区已被引擎提交进 scrollback 的量） */
  private committedRows = 0;

  constructor(state: UIState, driver: AgentDriver, tui: TUI) {
    this.state = state;
    this.driver = driver;
    this.tui = tui;
    this.editor = new Editor(editorTheme);
    this.editor.setMaxHeight(8);
    this.editor.setPromptGutter(`${SYM.marker} `);
    // Pi 原生 autocomplete：斜杠命令 + 文件路径补全（@ fuzzy / Tab 路径）
    this.editor.setAutocompleteProvider(new CombinedAutocompleteProvider(slashCommands));
    // Pi 原生输入历史导航：上键空输入/首行时填充历史
    this.editor.setHistoryStorage(this.historyStorage);
    // Editor 文本变化时触发重渲染（Pi Editor 不自动 requestRender）
    this.editor.onChange = () => this.tui.requestRender();
    this.editor.onSubmit = (text) => {
      const t = text.trim();
      if (!t) return;
      // 斜杠命令处理
      if (t.startsWith("/")) {
        const cmd = t.slice(1).split(/\s+/)[0] ?? "";
        const handled = handleSlashCommand(cmd, this);
        if (handled) {
          this.editor.addToHistory(t);
          this.editor.setText("");
          return;
        }
        // 未知命令当普通消息发给 agent（让 agent 处理）
      }
      // streaming 时 send 会静默 return——提示运行中
      if (this.state.streaming) {
        this.driver.toast("运行中，请等待或 Ctrl+C 中断", "warn");
        return;
      }
      void this.driver.send(t);
      this.editor.addToHistory(t);
      this.editor.setText("");
    };
  }

  // ── 供 commands/ 与外部访问的 getter/setter ──

  getDriver(): AgentDriver { return this.driver; }
  getEditor(): Editor { return this.editor; }

  /** 设置工具卡片展开状态（/expand /collapse 用）。 */
  setToolsExpanded(expanded: boolean): void {
    this.state = { ...this.state, toolsExpanded: expanded };
    this.tui.requestRender();
  }

  /** 清空 Markdown 实例缓存（/new /clear 用）。 */
  clearMdCache(): void { this.mdCache.clear(); }

  // ── 生命周期 ──

  /** 启动 spinner 定时器（tui.start 后调用）。 */
  startTimers(): void {
    // spinner：streaming 时每 120ms 重渲（思考/工具动画）
    this.spinnerTimer = setInterval(() => {
      if (this.state.streaming || this.state.eventBlock.mode !== "idle") {
        this.spinnerFrame++;
        this.tui.requestRender();
      }
    }, 120);
  }

  /** 停止定时器。 */
  stopTimers(): void {
    if (this.spinnerTimer) { clearInterval(this.spinnerTimer); this.spinnerTimer = null; }
  }

  /** 由 driver 在 state 变更后调用（通过 onRender 回调）。 */
  setState(s: UIState): void {
    this.state = s;
  }

  getState(): UIState {
    return this.state;
  }

  /** 请求退出（/quit 或 Ctrl+C 双击）。 */
  requestExit(): void {
    this.state = { ...this.state, exitRequested: true };
  }

  invalidate(): void {
    this.editor.invalidate();
    this.mdCache.clear();
    this.regionCache.stableRows = [];
    this.regionCache.liveRows = [];
    this.regionCache.stableSig = "";
    this.regionCache.liveSig = "";
  }

  // ── NativeScrollbackLiveRegion 实现（方案 A） ────────────────────────
  /**
   * liveRegionStart = 稳定区行数。这之上的行字节冻结，滚出视口顶部时
   * Pi 引擎提交进终端原生 scrollback，用户用滚轮翻历史。
   * 活跃区（liveRows）在视口内就地重绘，不进 scrollback。
   */
  getNativeScrollbackLiveRegionStart(): number | undefined {
    return this.regionCache.liveRegionStart;
  }

  /**
   * commitSafeEnd = 稳定区 + 当前流式消息的已稳定前缀。
   * 流式消息除最后一行外（已生成的 token 不会变），都算字节稳定——
   * 让长消息溢出视口的头部提前进 scrollback，不悬空。
   * 非流式时 = liveRegionStart（无活跃区）。
   */
  getNativeScrollbackCommitSafeEnd(): number | undefined {
    return this.regionCache.commitSafeEnd;
  }

  // getNativeScrollbackSnapshotSafeEnd 不实现——我们的流式内容字节稳定
  // （追加式，不 re-layout），用 commitSafeEnd 足够。

  // ── NativeScrollbackCommittedRows 实现 ───────────────────────────────
  /** 引擎回写已提交行数。可用于跳过已进 scrollback 的稳定区重新渲染。 */
  setNativeScrollbackCommittedRows(rows: number): void {
    this.committedRows = rows;
  }

  /** 主渲染：垂直栈 + 原生 scrollback。 */
  render(width: number): readonly string[] {
    // ── 构建对话区：稳定区 + 活跃区 ──
    buildChatRegions(this.state, this.spinnerFrame, this.mdCache, width, this.regionCache);

    // 拼接对话区全部行（全量渲染，引擎按 liveRegionStart 判断哪些进 scrollback）。
    // 不再手动 slice 视口——Pi 引擎 windowTop 机制（tui.ts:2730）自动只画视口尾部、
    // 把滚出顶部的稳定行提交进原生 scrollback，用户用滚轮翻历史。
    const chatRows: string[] = [];
    chatRows.push(...this.regionCache.stableRows);
    chatRows.push(...this.regionCache.liveRows);
    // 空对话占位
    if (chatRows.length === 0) {
      chatRows.push(...renderEmpty(width));
    }

    const inputHeight = Math.min(8, Math.max(2, Math.max(1, this.editor.getLines().length) + 1));

    const rows: string[] = [];
    rows.push(...renderTopBar(this.state, width));
    rows.push(...chatRows);
    // 系统提示（toast）居中显示，颜色按 kind 区分
    if (this.state.toast && this.state.toast.expiresAt > Date.now()) {
      rows.push(...renderToast(this.state, width));
    }
    // 事件块已删除：顶栏显示运行状态（● 运行中），状态栏显示 token 计数，信息不冗余。
    rows.push(...renderInput(this.editor, this.state, this.spinnerFrame, width, inputHeight));
    rows.push(...renderStatusBar(this.state, this.driver, width));
    return rows;
  }
}
