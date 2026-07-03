/**
 * 主 TUI app —— 磁带复古未来主义 agent 界面（基于 Pi TUI）。
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
 * 配色：Tau Ceti（暗棕底 #0C0A08 + 火焰橙 #FF8A3D + 数据青 #26C6DA）。
 * 装饰：// ▌ ▸ HH:MM:SS REC ● ████░░ [ch.NN] —— 每个元素都有信息功能。
 *
 * 依赖 Pi TUI 的：Editor、Markdown、Box、truncateToWidth、visibleWidth、Ellipsis。
 * 自写的：fg()、装饰函数、手动垂直布局（Pi 无 flex-grow）。
 */

import {
  TUI, Editor, Markdown, ProcessTerminal, Box, TruncatedText,
  CombinedAutocompleteProvider,
  truncateToWidth, visibleWidth, Ellipsis,
} from "@oh-my-pi/pi-tui";
import type {
  Component, EditorTheme, MarkdownTheme, SymbolTheme, SelectListTheme,
  BoxBorder, SlashCommand,
  NativeScrollbackLiveRegion, NativeScrollbackCommittedRows,
} from "@oh-my-pi/pi-tui";
import type { AgentDriver, AgentCliConfig } from "./agent.js";
import type { UIState, ChatMessage, Block } from "./state/types.js";
import type { SoundConfig } from "./sound.js";
import { FileHistoryStorage } from "./history.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── 配色：Marathon 酸性（黑底 + 签名黄绿 C1FD05 标题 + 绿色AI/橙色user/电光蓝/红/紫） ──
const C = {
  bg: "0A0A0A",        // 主背景（近黑）
  panelBg: "141414",   // 面板/卡片底
  inputBg: "141414",   // 输入框底
  fg: "E8E8E8",        // 主文字（近白，高对比）
  muted: "8A8A8A",     // 次要文字
  dim: "555555",       // 暗淡
  border: "2A2A2A",    // 边框
  borderAccent: "3A4A0A", // 选中面板边框（签名色暗版）
  accent: "C1FD05",    // 标题/强调（Marathon 签名酸性黄绿，最亮）
  accent2: "0A64FE",   // 电光蓝（链接/信息）
  ok: "39FF14",        // 霓虹绿（成功/状态）
  warn: "FF5E00",      // 电光橙（警告）
  err: "FC0D01",       // 纯红（错误）
  info: "0A64FE",      // 电光蓝（信息）
  highlight: "FFF01F", // 霓虹黄（选中/匹配）
  magenta: "BC13FE",   // 霓虹紫（系统提示）
  cardBg: "2A2600",    // 工具卡片背景（暗黄底，衬托黄色边框+内容）
  user: "FF5E00",      // user 消息（电光橙，区别于 AI）
  assistant: "39FF14", // assistant 消息（霓虹绿）
  system: "BC13FE",    // system（紫）
  tool: "FFF01F",      // 工具名（黄）
  cache: "39FF14",     // 缓存率（霓虹绿）
};

/** 真彩前景色函数：text → \x1b[38;2;R;G;Bm{text}\x1b[0m */
function fg(hex: string): (t: string) => string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (t: string) => `\x1b[38;2;${r};${g};${b}m${t}\x1b[0m`;
}

/** 真彩背景色函数：text → \x1b[48;2;R;G;Bm{text}\x1b[0m（填满整行需配合 pad） */
function bg(hex: string): (t: string) => string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (t: string) => `\x1b[48;2;${r};${g};${b}m${t}\x1b[0m`;
}

// ── 装饰符号（与 cli/theme/tokens SYMBOLS 对齐） ─────────────────────
const SYM = {
  separator: "//",
  index: "▌",
  marker: "▸",
  recDot: "●",
  // spinner 从 symbolTheme.spinnerFrames 取（与 Pi Loader 一致，不重复定义）
};

// ── 装饰元素（移植自 cli/layout/decorators.ts） ───────────────────────
function timecode(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function codename(role: string): string {
  return `${SYM.separator} ${role}`;
}
function compact(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ── Pi TUI truncateToWidth 适配：返回纯文本截断（带省略号） ──────────
/** CJK 安全截断：按可见宽度截断，超宽追加 … */
function trunc(s: string, maxCols: number): string {
  return truncateToWidth(s, maxCols, Ellipsis.Unicode);
}

// ── Markdown 主题（Pi MarkdownTheme） ─────────────────────────────────
const symbolTheme: SymbolTheme = {
  cursor: SYM.index,
  inputCursor: SYM.index,
  boxRound: { topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘", horizontal: "─", vertical: "│" },
  boxSharp: { topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘", horizontal: "─", vertical: "│", teeDown: "┬", teeUp: "┴", teeLeft: "├", teeRight: "┤", cross: "┼" },
  table: { topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘", horizontal: "─", vertical: "│", teeDown: "┬", teeUp: "┴", teeLeft: "├", teeRight: "┤", cross: "┼" },
  quoteBorder: "│",
  hrChar: "─",
  spinnerFrames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  colorSwatch: "◆",
};

/** SelectList 主题（app 与 driver 审批 overlay 共用）。 */
export const selectListTheme: SelectListTheme = {
  selectedPrefix: fg(C.accent),
  selectedText: fg(C.fg),
  description: fg(C.muted),
  scrollInfo: fg(C.dim),
  noMatch: fg(C.dim),
  symbols: symbolTheme,
};

/** 斜杠命令（Pi autocomplete 用，执行逻辑在 Editor.onSubmit）。
 *  这是命令的单一真源——autocomplete 和 onSubmit 都从这里读。 */
const slashCommands: SlashCommand[] = [
  { name: "new", description: "新建会话" },
  { name: "quit", description: "退出会话" },
  { name: "exit", description: "退出会话", aliases: ["q"] },
  { name: "help", description: "显示所有命令", aliases: ["?"] },
  { name: "clear", description: "清空对话（同 /new）" },
  { name: "tools", description: "显示当前 agent 的工具列表" },
  { name: "model", description: "切换模型" },
  { name: "compact", description: "手动压缩上下文" },
  { name: "history", description: "搜索输入历史" },
  { name: "expand", description: "展开所有工具卡片", aliases: ["e"] },
  { name: "collapse", description: "折叠所有工具卡片", aliases: ["c"] },
  { name: "settings", description: "打开设置菜单（审批模式等）", aliases: ["s"] },
];

const editorTheme: EditorTheme = {
  borderColor: fg(C.border),
  selectList: selectListTheme,
  symbols: symbolTheme,
  editorPaddingX: 1,
  hintStyle: fg(C.muted),
};

const markdownTheme: MarkdownTheme = {
  heading: fg(C.accent),      // 标题：签名黄绿（最醒目）
  link: fg(C.accent2),        // 链接：电光蓝
  linkUrl: fg(C.dim),         // 链接 URL：暗
  code: fg(C.highlight),      // 行内代码：霓虹黄
  codeBlock: fg(C.accent2),   // 代码块：电光蓝
  codeBlockBorder: fg(C.border),
  quote: fg(C.magenta),       // 引用：霓虹紫
  quoteBorder: fg(C.magenta),
  hr: fg(C.dim),
  listBullet: fg(C.accent),   // 列表项：黄绿
  bold: (t) => `\x1b[1m${t}\x1b[22m`,
  italic: (t) => `\x1b[3m${t}\x1b[23m`,
  strikethrough: (t) => `\x1b[9m${t}\x1b[29m`,
  underline: (t) => `\x1b[4m${t}\x1b[24m`,
  symbols: symbolTheme,
};

// ── 工具卡片 Box 边框 ─────────────────────────────────────────────────
const toolCardBorder: BoxBorder = {
  chars: {
    topLeft: "┌", topRight: "┐",
    bottomLeft: "└", bottomRight: "┘",
    horizontal: "─", vertical: "│",
  },
  color: fg(C.border),
};

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
  private mdCache = new Map<string, { content: string; width: number; instance: Markdown }>();
  /** 输入历史存储（上键填充历史） */
  private historyStorage = new FileHistoryStorage();

  // ── 对话区行缓存（稳定区 + 活跃区） ──
  /** 已 finalize 消息渲染成的稳定行（字节冻结，可进 scrollback） */
  private stableRows: readonly string[] = [];
  /** 生成 stableRows 时的 messages 快照签名（messages 长度 + 最后一条 id + width） */
  private stableSig = "";
  /** 当前流式消息渲染成的活跃行（视口内重绘） */
  private liveRows: readonly string[] = [];
  private liveSig = "";

  // ── NativeScrollback 边界（render 时算出，供引擎读取） ──
  /** liveRegionStart = stableRows.length（稳定区结束 = 活跃区开始） */
  private liveRegionStart = 0;
  /** commitSafeEnd = stableRows.length + 流式消息已稳定前缀行数 */
  private commitSafeEnd = 0;
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
        const handled = this.handleSlashCommand(cmd);
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

  /** 处理斜杠命令，返回 true 表示已处理。 */
  private handleSlashCommand(cmd: string): boolean {
    switch (cmd) {
      case "quit": case "exit": case "q":
        this.requestExit();
        return true;
      case "new": case "clear":
        this.driver.clearMessages();
        this.editor.setText("");
        this.mdCache.clear();
        return true;
      case "help": case "?": {
        const lines = slashCommands.map(c => `/${c.name}${c.aliases ? ` (${c.aliases.map(a=>"/"+a).join(",")})` : ""} — ${c.description}`);
        this.driver.toast(lines.join(" | ").slice(0, 80), "info");
        return true;
      }
      case "tools": {
        const tools = this.driver.getToolWhitelist();
        this.driver.toast(`工具: ${tools.join(", ")}`.slice(0, 80), "info");
        return true;
      }
      case "expand": case "e":
        this.state = { ...this.state, toolsExpanded: true };
        this.tui.requestRender();
        return true;
      case "collapse": case "c":
        this.state = { ...this.state, toolsExpanded: false };
        this.tui.requestRender();
        return true;
      case "settings": case "s":
        this.driver.showSettings();
        return true;
      case "model":
      case "compact":
      case "history":
        this.driver.toast(`/${cmd} 暂未实现，敬请期待`, "warn");
        return true;
      default:
        return false; // 未知命令，当普通消息发给 agent
    }
  }

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

  getEditor(): Editor {
    return this.editor;
  }

  invalidate(): void {
    this.editor.invalidate();
    this.mdCache.clear();
    this.stableRows = [];
    this.liveRows = [];
    this.stableSig = "";
    this.liveSig = "";
  }

  // ── NativeScrollbackLiveRegion 实现（方案 A） ────────────────────────
  /**
   * liveRegionStart = 稳定区行数。这之上的行字节冻结，滚出视口顶部时
   * Pi 引擎提交进终端原生 scrollback，用户用滚轮翻历史。
   * 活跃区（liveRows）在视口内就地重绘，不进 scrollback。
   */
  getNativeScrollbackLiveRegionStart(): number | undefined {
    return this.liveRegionStart;
  }

  /**
   * commitSafeEnd = 稳定区 + 当前流式消息的已稳定前缀。
   * 流式消息除最后一行外（已生成的 token 不会变），都算字节稳定——
   * 让长消息溢出视口的头部提前进 scrollback，不悬空。
   * 非流式时 = liveRegionStart（无活跃区）。
   */
  getNativeScrollbackCommitSafeEnd(): number | undefined {
    return this.commitSafeEnd;
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
    this.buildChatRegions(width);

    // 拼接对话区全部行（全量渲染，引擎按 liveRegionStart 判断哪些进 scrollback）。
    // 不再手动 slice 视口——Pi 引擎 windowTop 机制（tui.ts:2730）自动只画视口尾部、
    // 把滚出顶部的稳定行提交进原生 scrollback，用户用滚轮翻历史。
    const chatRows: string[] = [];
    chatRows.push(...this.stableRows);
    chatRows.push(...this.liveRows);
    // 空对话占位
    if (chatRows.length === 0) {
      chatRows.push(...this.renderEmpty(width));
    }

    // 边界报告：liveRegionStart = 稳定区长度；commitSafeEnd 见 buildChatRegions
    this.liveRegionStart = this.stableRows.length;

    const inputHeight = Math.min(8, Math.max(2, Math.max(1, this.editor.getLines().length) + 1));

    const rows: string[] = [];
    rows.push(...this.renderTopBar(width));
    rows.push(...chatRows);
    // 系统提示（toast）居中显示，颜色按 kind 区分
    if (this.state.toast && this.state.toast.expiresAt > Date.now()) {
      rows.push(...this.renderToast(width));
    }
    // 事件块已删除：顶栏显示运行状态（● 运行中），状态栏显示 token 计数，信息不冗余。
    rows.push(...this.renderInput(width, inputHeight));
    rows.push(...this.renderStatusBar(width));
    return rows;
  }

  /**
   * 构建对话区两段：稳定区（已 finalize 消息）+ 活跃区（当前流式消息）。
   * 稳定区用签名缓存避免每帧重渲染已完成消息；活跃区每帧重建（内容在变）。
   */
  private buildChatRegions(width: number): void {
    const msgs = this.state.messages;
    const streamingId = this.state.streaming ? this.state.currentAssistantId : null;

    // ── 稳定区：所有非 streaming 消息 ──
    const stableMsgs = msgs.filter(m => m.id !== streamingId && !m.streaming);
    const stableSig = `${stableMsgs.length}:${stableMsgs[stableMsgs.length - 1]?.id ?? ""}:${width}`;
    if (stableSig !== this.stableSig) {
      const rows: string[] = [];
      for (const m of stableMsgs) rows.push(...this.renderMessage(m, width));
      this.stableRows = rows;
      this.stableSig = stableSig;
    }

    // ── 活跃区：当前流式消息（streaming 中或刚 done 但本轮的） ──
    const liveMsg = streamingId ? msgs.find(m => m.id === streamingId) : null;
    const liveSig = `${liveMsg?.id ?? ""}:${liveMsg?.blocks.map(b => b.type === "text" || b.type === "thinking" ? b.content.length : b.type === "tool" ? (b.result?.length ?? 0) : 0).join(",") ?? ""}:${width}`;
    let liveRows: readonly string[] = [];
    if (liveMsg) {
      const rows: string[] = [];
      rows.push(...this.renderMessage(liveMsg, width));
      liveRows = rows;
      // commitSafeEnd：流式消息除最后一行外都算稳定（追加式，已生成 token 不变）
      // 最后一行可能在变（流式光标、正在打字），排除它。
      const stablePrefix = Math.max(0, rows.length - 1);
      this.commitSafeEnd = this.stableRows.length + stablePrefix;
    } else {
      this.commitSafeEnd = this.stableRows.length;
    }
    // 仅在签名变化时更新 liveRows 引用（减少引擎 diff）
    if (liveSig !== this.liveSig) {
      this.liveRows = liveRows;
      this.liveSig = liveSig;
    }
  }

  // ── 顶栏：▌ MAOU // <agentName> ────── ●运行中/○待命 ────────────────
  private renderTopBar(width: number): string[] {
    const left = `${fg(C.accent)(SYM.index)} ${fg(C.fg)("MAOU")} ${fg(C.muted)(codename(this.state.agentName))}`;
    const status = this.state.streaming
      ? `${fg(C.accent)(`${SYM.recDot} ${this.state.aborting ? "中断中" : "运行中"}`)}`
      : `${fg(C.dim)("○ 待命")}`;
    const leftW = visibleWidth(left);
    const statusW = visibleWidth(status);
    const gap = Math.max(1, width - leftW - statusW);
    return [left + " ".repeat(gap) + status];
  }

  private renderEmpty(width: number): string[] {
    const lines = [
      `${fg(C.dim)("─".repeat(Math.min(width, 50)))}`,
      `${fg(C.muted)(`${SYM.separator} 欢迎使用 MAOU TUI`)}`,
      `${fg(C.muted)("输入消息后回车发送，Alt+Enter 换行")}`,
      `${fg(C.dim)("/new /quit /help /tools /expand /collapse  · 输入 / 查看所有命令")}`,
    ];
    return lines;
  }

  private renderMessage(msg: ChatMessage, width: number): string[] {
    const rows: string[] = [];
    // user 消息前加实心块分割（标示新一轮 loop 开始）+ 块 id
    if (msg.role === "user") {
      const round = this.state.round;
      const blockId = msg.id.slice(-6);
      const sep = fg(C.borderAccent)("▆".repeat(Math.min(width, 60)));
      const label = fg(C.dim)(` loop #${round} · ${blockId} `);
      rows.push(sep);
      rows.push(label);
    }
    // 角色头（含块 id，便于回溯定位）
    const roleColor = msg.role === "user" ? fg(C.user) : msg.role === "system" ? fg(C.system) : fg(C.assistant);
    const roleLabel = msg.role === "user" ? "user" : msg.role === "system" ? "sys" : "ai";
    const ts = new Date(msg.ts);
    const blockId = msg.id.slice(-6);
    rows.push(`${roleColor(`${SYM.index} ${roleLabel}`)} ${fg(C.dim)(timecode(ts))} ${fg(C.dim)(`#${blockId}`)} ${fg(C.muted)(codename(msg.role))}`);

    // 按 blocks 顺序渲染（text/thinking/tool 天然穿插，按时序）
    for (const block of msg.blocks) {
      if (block.type === "text" && block.content) {
        rows.push(...this.renderMarkdown(msg.id, block.content, width, !!msg.streaming));
      } else if (block.type === "thinking") {
        rows.push(...this.renderThinking(block, width));
      } else if (block.type === "tool") {
        rows.push(...this.renderToolCard(block, width));
      }
    }

    rows.push(""); // 消息间空行
    return rows;
  }

  private renderThinking(tb: Extract<Block, { type: "thinking" }>, width: number): string[] {
    const prefix = fg(C.dim)(`${SYM.marker} `);
    const lines = tb.content.split("\n").filter(l => l.length > 0);
    if (lines.length === 0) {
      return [`${prefix}${fg(C.muted)(tb.streaming ? "思考中…" : "[思考]")}`];
    }
    if (tb.streaming) {
      const shown = lines.slice(-2);
      return shown.map(l => `${prefix}${fg(C.muted)(trunc(l, width - 2))}`);
    }
    const first = trunc(lines[0]!, width - 12);
    const more = lines.length > 1 ? ` ${fg(C.dim)(`[+${lines.length - 1}行]`)}` : "";
    return [`${prefix}${fg(C.muted)(first)}${more}`];
  }

  private renderToolCard(tc: Extract<Block, { type: "tool" }>, width: number): string[] {
    const expanded = this.state.toolsExpanded;
    const status = tc.done
      ? fg(C.dim)(tc.isError ? "✗" : "✓")
      : fg(C.warn)(`${symbolTheme.spinnerFrames[this.spinnerFrame % symbolTheme.spinnerFrames.length]}…`);
    const name = fg(C.tool)(tc.name);

    // 折叠：head 行 = 工具名 + 状态 + 参数摘要（单行），有更多内容加 …
    if (!expanded) {
      const argsPreview = (tc.args && tc.args !== "{}")
        ? ` ${fg(C.dim)(trunc(tc.args, width - tc.name.length - 8))}`
        : "";
      const hasMore = (tc.result && tc.result.split("\n").filter(l => l.trim()).length > 0);
      const more = hasMore ? ` ${fg(C.dim)("…")}` : "";
      const head = `${SYM.marker} ${name} ${status}${argsPreview}${more}`;
      // 自己画边框+背景（Pi Box bgFn 只填内容区不填边框行）
      return this.drawCardFrame([head], width);
    }

    // 展开：head + 完整 args + result 12 行 + 折叠提示
    const innerRows: string[] = [`${SYM.marker} ${name} ${status}`];
    if (tc.args && tc.args !== "{}") {
      innerRows.push(`  ${fg(C.dim)(trunc(tc.args, width - 6))}`);
    }
    if (tc.result) {
      const allLines = tc.result.split("\n").filter(l => l.trim().length > 0);
      const resultLines = allLines.slice(0, 12);
      const color = tc.isError ? fg(C.err) : fg(C.ok);
      for (const l of resultLines) {
        innerRows.push(`  ${color(trunc(l, width - 6))}`);
      }
      const total = allLines.length;
      if (total > 12) {
        innerRows.push(`  ${fg(C.dim)(`[+${total - 12}行]`)}`);
      }
    }
    innerRows.push(`  ${fg(C.dim)("[ctrl+o: 折叠]")}`);
    return this.drawCardFrame(innerRows, width);
  }

  /** 画工具卡片边框+背景：每行 pad 到 width + bg(C.cardBg) 整行填色 */
  private drawCardFrame(rows: string[], width: number): string[] {
    const borderColor = fg(C.border);
    const h = "─".repeat(Math.max(0, width - 2));
    const bgFn = bg(C.cardBg);
    const padBg = (s: string) => {
      const w = visibleWidth(s);
      return bgFn(s + " ".repeat(Math.max(0, width - w)));
    };
    const result: string[] = [
      padBg(borderColor(`┌${h}┐`)),
    ];
    for (const row of rows) {
      const padded = row + " ".repeat(Math.max(0, width - visibleWidth(row) - 2));
      result.push(padBg(borderColor("│") + padded + borderColor("│")));
    }
    result.push(padBg(borderColor(`└${h}┘`)));
    return result;
  }

  /**
   * Markdown 渲染。
   * - 流式消息（streaming=true）：按 msgId 缓存实例，复用 Pi Markdown 的
   *   streaming lex cache（频繁 new 会丢流式前缀缓存）。
   * - finalize 消息：不缓存实例，靠 Pi Markdown 模块级 L2 LRU（跨实例存活）。
   * 失败降级纯文本手动 wrap。
   */
  private renderMarkdown(msgId: string, content: string, width: number, streaming: boolean): readonly string[] {
    const renderWidth = width - 1;
    // 流式：命中缓存（同 content+width）则复用实例
    if (streaming) {
      const cached = this.mdCache.get(msgId);
      if (cached && cached.content === content && cached.width === renderWidth) {
        try { return cached.instance.render(renderWidth); } catch { this.mdCache.delete(msgId); }
      }
    }
    // 新建实例（finalize 走 Pi L2 LRU；流式则存回 mdCache）
    try {
      const md = new Markdown(content, 1, 0, markdownTheme);
      const rows = md.render(renderWidth);
      if (streaming) this.mdCache.set(msgId, { content, width: renderWidth, instance: md });
      return rows.length > 0 ? rows : [content];
    } catch {
      // 降级：纯文本手动 wrap
      try {
        return content.split("\n").flatMap(line => {
          if (line.length === 0) return [""];
          const wrapped: string[] = [];
          let remaining = line;
          while (visibleWidth(remaining) > renderWidth) {
            const truncated = trunc(remaining, renderWidth);
            wrapped.push(truncated);
            remaining = remaining.slice(truncated.length);
          }
          if (remaining.length > 0) wrapped.push(remaining);
          return wrapped;
        });
      } catch {
        return content.split("\n");
      }
    }
  }

  // ── 系统提示（toast）：居中框，颜色按 kind 区分 ─────────────────────
  private renderToast(width: number): string[] {
    const t = this.state.toast;
    if (!t) return [];
    const color = t.kind === "err" ? fg(C.err) : t.kind === "warn" ? fg(C.warn) : t.kind === "ok" ? fg(C.ok) : fg(C.magenta);
    const text = ` ${t.text} `;
    const tw = visibleWidth(text);
    const pad = Math.max(0, Math.floor((width - tw) / 2));
    const line = " ".repeat(pad) + color(text);
    return [line];
  }

  // ── 输入框：Pi Editor（直角框 + 灰底 + 空 placeholder） ────────────
  private renderInput(width: number, _height: number): string[] {
    void _height;
    // 流式事件状态：显示在输入框顶边框（oh-my-pi 风格，替代独立事件块）
    const modeLabel: Record<string, string> = {
      thinking: "思考中",
      generating: "生成中",
      tool_pending:  `工具 ${this.state.eventBlock.detail ?? ""}`,
      error: "错误",
      idle: "待命",
    };
    const eb = this.state.eventBlock;
    const isActive = this.state.streaming || eb.mode !== "idle";
    const spinner = isActive ? symbolTheme.spinnerFrames[this.spinnerFrame % symbolTheme.spinnerFrames.length] : "";
    const modeColor = eb.mode === "error" ? fg(C.err)
      : eb.mode === "tool_pending" ? fg(C.warn)
      : eb.mode === "thinking" ? fg(C.info)
      : eb.mode === "generating" ? fg(C.accent)
      : fg(C.dim);
    const modeText = isActive ? `${spinner}${modeLabel[eb.mode] ?? "处理中"}` : "";
    const tokenText = isActive ? `${fg(C.muted)(`${compact(eb.upTokens)}↑ ${compact(eb.downTokens)}↓`)}` : "";
    const topText = [modeText, tokenText].filter(Boolean).join("  ");
    if (topText) {
      try { this.editor.setTopBorder({ content: topText, width: visibleWidth(topText) }); }
      catch { /* 忽略 */ }
    } else {
      try { this.editor.setTopBorder(undefined); } catch { /* 忽略 */ }
    }
    const rows = [...this.editor.render(width)];
    // 空输入时：加灰底背景 + placeholder 提示文字
    const isEmpty = this.editor.getText().length === 0;
    if (isEmpty) {
      const placeholder = fg(C.dim)("input [Alt+Enter 换行 / Enter 发送]");
      const bgFn = bg(C.inputBg);
      // 给每行加背景色，底行在光标后加 placeholder
      for (let i = 0; i < rows.length; i++) {
        const line = rows[i]!;
        const padded = line + " ".repeat(Math.max(0, width - visibleWidth(line)));
        rows[i] = bgFn(padded);
      }
      // 底行（光标行）追加 placeholder
      const last = rows.length - 1;
      if (last >= 0) {
        rows[last] = rows[last]!.replace(/\x1b\[0m$/, "") + placeholder + "\x1b[0m";
      }
    }
    return rows;
  }

  // ── 状态栏：单行截断（Pi TruncatedText）──────────────────────────────
  private renderStatusBar(width: number): string[] {
    const s = this.state;
    const mode = fg(C.accent)(this.driver.getApprovalMode());
    const currentTokens = s.currentRoundUsage.input + s.currentRoundUsage.output;
    const lastRound = s.rounds[s.rounds.length - 1];
    const ctxTokens = lastRound ? (lastRound.total ?? (lastRound.input + lastRound.output)) : currentTokens;
    const ctxPct = s.maxContext > 0 ? Math.min(1, ctxTokens / s.maxContext) : 0;
    const model = fg(C.muted)(`${s.provider}/${s.model || "?"}`);
    const pct = fg(C.dim)(`${Math.round(ctxPct * 100)}%`);
    // 平均缓存率：sum(cacheRead)/sum(cacheRead+input) 合并计算（非 mean-of-rates）。
    let cacheSeg = "";
    if (s.cacheHistory.length > 0) {
      const sumCache = s.cacheHistory.reduce((a, c) => a + (c.cacheRead ?? 0), 0);
      const sumInput = s.cacheHistory.reduce((a, c) => a + (c.input ?? 0), 0);
      const rate = sumInput > 0 ? sumCache / sumInput : 0;
      cacheSeg = ` ${fg(C.dim)("·")} ${fg(C.cache)(`c${Math.round(rate * 100)}%`)}`;
    }
    // 前面加空格对齐输入框 paddingX=1
    const text = ` ${mode} ${fg(C.dim)("·")} ${model} ${fg(C.dim)("·")} ${compact(ctxTokens)}/${compact(s.maxContext)} ${pct}${cacheSeg}`;
    return [...new TruncatedText(text, 0, 0).render(width)];
  }
}

// ── 组装入口 ──────────────────────────────────────────────────────────
//
// 依赖环：App 的 Editor.onSubmit 需要 driver.send；driver 需要 tui + app 的
// getState/setState。解法：用共享 state 盒打破环 —— driver 和 app 都读写
// 同一个 box.state。App 持 box 引用，setState 同步回 box；driver 的
// getState/setState 直接操作 box。
//
// index.ts 调用 createAppWithConfig(state, config)，它完成全部接线。

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
