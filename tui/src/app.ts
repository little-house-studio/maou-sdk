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
import type { UIState, ChatMessage, ToolCardState, ThinkingBlock } from "./state/types.js";

// ── Tau Ceti 调色板（真彩 ANSI 38;2;R;G;B） ──────────────────────────
const C = {
  bg: "0C0A08",
  panelBg: "14110D",
  fg: "D7CFC4",
  muted: "6B6358",
  dim: "443F38",
  border: "2A2520",
  borderAccent: "FF8A3D",
  accent: "FF8A3D",   // 火焰橙
  accent2: "26C6DA",  // 数据青
  ok: "66D6A0",
  warn: "FFC44D",
  err: "FF5252",
  info: "4DD0E1",
  user: "FFAB78",
  assistant: "D7CFC4",
  system: "B39DDB",
  tool: "FFD18A",
};

/** 真彩前景色函数：text → \x1b[38;2;R;G;Bm{text}\x1b[0m */
function fg(hex: string): (t: string) => string {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (t: string) => `\x1b[38;2;${r};${g};${b}m${t}\x1b[0m`;
}

// ── 装饰符号（与 cli/theme/tokens SYMBOLS 对齐） ─────────────────────
const SYM = {
  separator: "//",
  index: "▌",
  marker: "▸",
  recDot: "●",
  // spinner 从 symbolTheme.spinnerFrames 取（与 Pi Loader 一致，不重复定义）
};
const SPARK_CHARS = "▁▂▃▄▅▆▇█";

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
function sparkline(values: number[], width = 12): string {
  if (values.length === 0) return "·".repeat(width);
  const recent = values.slice(-width);
  const max = Math.max(...recent, 1);
  const chars = recent.map(v => {
    const idx = Math.min(SPARK_CHARS.length - 1, Math.floor((v / max) * SPARK_CHARS.length));
    return SPARK_CHARS[idx]!;
  });
  while (chars.length < width) chars.unshift("·");
  return chars.join("");
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
  boxRound: { topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯", horizontal: "─", vertical: "│" },
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

/** 斜杠命令（Pi autocomplete 用，执行逻辑仍在 Editor.onSubmit）。 */
const slashCommands: SlashCommand[] = [
  { name: "quit", description: "退出会话" },
  { name: "exit", description: "退出会话", aliases: ["q"] },
  { name: "new", description: "新建会话" },
];

const editorTheme: EditorTheme = {
  borderColor: fg(C.border),
  selectList: selectListTheme,
  symbols: symbolTheme,
  editorPaddingX: 1,
  hintStyle: fg(C.muted),
};

const markdownTheme: MarkdownTheme = {
  heading: fg(C.accent),
  link: fg(C.accent2),
  linkUrl: fg(C.muted),
  code: fg(C.accent2),
  codeBlock: fg(C.info),
  codeBlockBorder: fg(C.border),
  quote: fg(C.muted),
  quoteBorder: fg(C.dim),
  hr: fg(C.dim),
  listBullet: fg(C.accent),
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
    // Editor 文本变化时触发重渲染（Pi Editor 不自动 requestRender）
    this.editor.onChange = () => this.tui.requestRender();
    this.editor.onSubmit = (text) => {
      const t = text.trim();
      if (!t) return;
      if (t === "/quit" || t === "/exit") {
        this.requestExit();
        return;
      }
      if (t === "/new") {
        this.driver.clearMessages();
        this.editor.setText("");
        this.mdCache.clear();
        return;
      }
      // streaming 时 send 会静默 return——这里不清空输入框，
      // 让用户的消息保留（避免丢失），并提示「运行中」。
      if (this.state.streaming) {
        this.driver.toast("运行中，请等待或 Ctrl+C 中断", "warn");
        return;
      }
      void this.driver.send(t);
      this.editor.setText("");
    };
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
    rows.push(...this.renderEventBlock(width));
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
    const liveSig = `${liveMsg?.id ?? ""}:${liveMsg?.content.length ?? 0}:${liveMsg?.thinkingBlocks?.map(t => t.content.length).join(",") ?? ""}:${width}`;
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

  // ── 顶栏：▌ MAOU // <agentName> ────── REC ●/○ ──────────────────────
  private renderTopBar(width: number): string[] {
    const left = `${fg(C.accent)(SYM.index)} ${fg(C.fg)("MAOU")} ${fg(C.muted)(codename(this.state.agentName))}`;
    const status = this.state.streaming
      ? `${fg(C.err)(`REC ${SYM.recDot}`)} ${fg(C.muted)(this.state.aborting ? "中断中" : "运行中")}`
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
      `${fg(C.dim)("/new 新会话  /quit 退出")}`,
    ];
    return lines;
  }

  private renderMessage(msg: ChatMessage, width: number): string[] {
    const rows: string[] = [];
    // 角色头
    const roleColor = msg.role === "user" ? fg(C.user) : msg.role === "system" ? fg(C.system) : fg(C.assistant);
    const roleLabel = msg.role === "user" ? "user" : msg.role === "system" ? "sys" : "ai";
    const ts = new Date(msg.ts);
    rows.push(`${roleColor(`${SYM.index} ${roleLabel}`)} ${fg(C.dim)(timecode(ts))} ${fg(C.muted)(codename(msg.role))}`);

    // thinking 块
    if (msg.thinkingBlocks && msg.thinkingBlocks.length > 0) {
      for (const tb of msg.thinkingBlocks) {
        rows.push(...this.renderThinking(tb, width));
      }
    }

    // 正文（Markdown）。流式消息保留实例复用 streaming lex cache；
    // finalize 消息靠 Pi Markdown 的模块级 L2 LRU，不自己缓存。
    if (msg.content) {
      rows.push(...this.renderMarkdown(msg.id, msg.content, width, !!msg.streaming));
    }

    // 工具卡片（Box 边框）
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        rows.push(...this.renderToolCard(tc, width));
      }
    }

    rows.push(""); // 消息间空行
    return rows;
  }

  private renderThinking(tb: ThinkingBlock, width: number): string[] {
    const prefix = fg(C.dim)(`${SYM.marker} `);
    const lines = tb.content.split("\n").filter(l => l.length > 0);
    if (lines.length === 0) {
      return [`${prefix}${fg(C.muted)(tb.streaming ? "思考中…" : "[思考]")}`];
    }
    if (tb.streaming) {
      const shown = lines.slice(-2);
      return shown.map(l => `${prefix}${fg(C.muted)(trunc(l, width - 2))}`);
    }
    // 完成：折叠为首行 + 计数
    const first = trunc(lines[0]!, width - 12);
    const more = lines.length > 1 ? ` ${fg(C.dim)(`[+${lines.length - 1}行]`)}` : "";
    return [`${prefix}${fg(C.muted)(first)}${more}`];
  }

  private renderToolCard(tc: ToolCardState, width: number): string[] {
    const head = tc.done
      ? `${fg(C.tool)(`${SYM.marker} ${tc.name}`)} ${fg(C.dim)(tc.isError ? "✗" : "✓")}`
      : `${fg(C.warn)(`${symbolTheme.spinnerFrames[this.spinnerFrame % symbolTheme.spinnerFrames.length]} ${tc.name}`)} ${fg(C.dim)("…")}`;
    const innerRows: string[] = [head];

    // 参数（折叠到一行）。Box 内 contentWidth = width - 2(边框) - 2(paddingX)，
    // 这里预留同样的缩进空间。
    if (tc.args && tc.args !== "{}") {
      innerRows.push(`  ${fg(C.dim)(trunc(tc.args, width - 6))}`);
    }
    // 结果（折叠）
    if (tc.result) {
      const resultLines = tc.result.split("\n").slice(0, 3);
      const color = tc.isError ? fg(C.err) : fg(C.ok);
      for (const l of resultLines) {
        innerRows.push(`  ${color(trunc(l, width - 6))}`);
      }
      const total = tc.result.split("\n").length;
      if (total > 3) innerRows.push(`  ${fg(C.dim)(`[+${total - 3}行]`)}`);
    }

    // 用 Pi Box 渲染边框（paddingX=1 自动缩进，border 自动画 ┌─┐│└─┘ + 宽度 pad）
    try {
      const box = new Box(1, 0, undefined, toolCardBorder);
      box.addChild(new Lines(innerRows));
      const rows = box.render(width);
      return [...rows];
    } catch {
      // 降级：不加边框
      return innerRows;
    }
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

  // ── 事件块：模式 + token 上下行 ─────────────────────────────────────
  private renderEventBlock(width: number): string[] {
    const eb = this.state.eventBlock;
    if (!this.state.streaming && eb.mode === "idle") {
      const spark = this.state.rounds.length > 0 ? sparkline(this.state.rounds.map(r => r.total ?? (r.input + r.output)), 12) : "";
      const left = fg(C.dim)("─".repeat(Math.min(width, 30)));
      const right = spark ? fg(C.accent2)(spark) : "";
      const lw = visibleWidth(left);
      const rw = visibleWidth(right);
      const gap = Math.max(1, width - lw - rw);
      return [left + " ".repeat(gap) + right];
    }
    const modeLabel: Record<string, string> = {
      thinking: "思考中",
      generating: "生成中",
      tool_pending: `工具 ${eb.detail ?? ""}`,
      error: "错误",
      idle: "待命",
    };
    const modeColor = eb.mode === "error" ? fg(C.err)
      : eb.mode === "tool_pending" ? fg(C.warn)
      : eb.mode === "thinking" ? fg(C.info)
      : fg(C.accent);
    const spinner = this.state.streaming ? symbolTheme.spinnerFrames[this.spinnerFrame % symbolTheme.spinnerFrames.length] : "";
    const left = `${modeColor(spinner + (modeLabel[eb.mode] ?? "处理中"))} ${eb.detail && eb.mode !== "tool_pending" ? fg(C.dim)(trunc(eb.detail, 20)) : ""}`;
    const right = `${codename("tokens")} ${fg(C.muted)(`${compact(eb.upTokens)}↑ ${compact(eb.downTokens)}↓`)}`;
    const lw = visibleWidth(left);
    const rw = visibleWidth(right);
    const gap = Math.max(1, width - lw - rw);
    return [left + " ".repeat(gap) + right];
  }

  // ── 输入框：Pi Editor（带边框） ────────────────────────────────────
  private renderInput(width: number, _height: number): string[] {
    const topBorder = this.state.streaming
      ? fg(C.warn)(`${SYM.marker} ${codename("input")} ${fg(C.dim)("[Alt+Enter 换行 / Ctrl+C 中断]")}`)
      : fg(C.accent)(`${SYM.marker} ${codename("input")} ${fg(C.dim)("[Alt+Enter 换行 / Enter 发送]")}`);
    void _height;
    try {
      this.editor.setTopBorder({ content: topBorder, width: visibleWidth(topBorder) });
    } catch {
      // setTopBorder 可能要求特定格式，忽略错误用默认边框
    }
    const rows = this.editor.render(width);
    return [...rows];
  }

  // ── 状态栏：单行截断（Pi TruncatedText）──────────────────────────────
  private renderStatusBar(width: number): string[] {
    const s = this.state;
    const rec = s.streaming ? `${fg(C.err)("REC ")} ` : "";
    const name = fg(C.accent)(`${SYM.index} ${s.agentName}`);
    const currentTokens = s.currentRoundUsage.input + s.currentRoundUsage.output;
    const lastRound = s.rounds[s.rounds.length - 1];
    const ctxTokens = lastRound ? (lastRound.total ?? (lastRound.input + lastRound.output)) : currentTokens;
    const ctxPct = s.maxContext > 0 ? Math.min(1, ctxTokens / s.maxContext) : 0;
    const model = fg(C.muted)(`${s.provider}/${s.model || "?"}`);
    const pct = fg(C.dim)(`${Math.round(ctxPct * 100)}%`);
    const text = `${rec}${name} ${fg(C.dim)("·")} ${model} ${fg(C.dim)("·")} ${compact(ctxTokens)}/${compact(s.maxContext)} ${pct}`;
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

  // driver 接线到 box + tui
  const driver = new DriverCtor(config, {
    tui,
    getState: () => box.state,
    setState: (updater) => {
      box.state = updater(box.state);
      app.setState(box.state);  // 同步到 app（app 持有旧引用，需显式更新）
    },
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
