/**
 * agent 驱动 —— 去除 React/zustand，用普通 async + tui.requestRender()。
 *
 * 移植自 cli/src/events/useAgent.ts（驱动逻辑）。
 *  - send(text)：pushUserMessage → runAgentCli onEvent→reduce→合并 state→requestRender
 *  - abort()：AbortController.abort()
 *  - error 兜底：runAgentCli 抛错时也确保 streaming 关闭（reducer 可能没收到 error 事件）
 *
 * loadAgentConfig 是通用加载器：从任意路径/包名加载 AgentCliConfig。
 * TUI 层不硬编码任何 agent 模板——`maou <path>` 由调用方决定加载哪个。
 */

import { runAgentCli } from "@little-house-studio/agent";
import type { AgentHandle, AgentCliConfig } from "@little-house-studio/agent";
export type { AgentCliConfig };
import { SelectList, TERMINAL, isNotificationSuppressed } from "@oh-my-pi/pi-tui";
import type { TUI, SelectItem, TerminalNotification } from "@oh-my-pi/pi-tui";
import { setTerminalApprover, addTerminalWhitelist, addTerminalBlacklist, getTerminalMode, setTerminalMode } from "@little-house-studio/tools";
import type { StreamEvent } from "@little-house-studio/types";
import type { UIState } from "./state/types.js";
import { selectListTheme } from "./app.js";
import { reduce } from "./state/reducer.js";
import { uid } from "./state/reducer.js";
import { SoundManager } from "./sound.js";
import type { SoundConfig } from "./sound.js";
import { existsSync, statSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/**
 * 加载 agent cli 配置 —— 通用加载器，不绑定任何具体 agent 模板。
 *
 * 接受多种 target 形式：
 *   - 包名/子路径：`@little-house-studio/coding-agent/cli-config`、`my-agent/cli-config`
 *   - 目录：`./agents/foo`（自动找该目录下的 cli.ts/index.ts/cli-config.ts/agent-cli.ts）
 *   - 文件：`./foo/cli-config.ts`、`./foo/cli.ts`
 *   - undefined：抛错（不再默认 coding-agent；由调用方决定默认策略）
 *
 * @param target 路径/包名/undefined
 * @returns AgentCliConfig 实例
 */
export async function loadAgentConfig(target?: string): Promise<AgentCliConfig> {
  if (!target) {
    throw new Error(
      "未指定 agent 模板。用法：maou <path-or-package>（例如 maou @little-house-studio/coding-agent/cli-config）"
    );
  }

  // 情况 A：看起来像包名/子路径（不含 / 或以 @scope/ 开头且不是相对路径）
  const isPackageLike = !target.startsWith(".") && !target.startsWith("/") &&
    (!target.includes("/") || target.startsWith("@"));

  if (isPackageLike) {
    // 包名解析：tui 包的 node_modules 可能没有该 agent 包（tui 不依赖它），
    // 所以从 cwd 向上用 createRequire 解析——用户在项目目录跑时，
    // 项目自身（或其上级 monorepo）装了该包即可找到。
    const cwdRequire = createRequire(join(process.cwd(), "<maou>"));
    try {
      const resolvedPath = cwdRequire.resolve(target);
      const mod = await import(pathToFileURL(resolvedPath).href);
      const cfg = (mod.default ?? mod) as AgentCliConfig;
      assertValidConfig(cfg, target);
      return cfg;
    } catch {
      // cwd 解析失败，退回从 tui 包自身解析（可能 tui 依赖了它）
      const mod = await import(target);
      const cfg = (mod.default ?? mod) as AgentCliConfig;
      assertValidConfig(cfg, target);
      return cfg;
    }
  }

  // 情况 B：文件系统路径
  const abs = resolve(target);
  let importPath = abs;

  // 如果是目录，自动探测入口文件
  if (!existsSync(abs) || statSync(abs).isDirectory()) {
    const entryNames = ["cli.ts", "index.ts", "agent-cli.ts", "cli-config.ts", "cli.js", "index.js"];
    let found: string | null = null;
    for (const n of entryNames) {
      const c = join(abs, n);
      if (existsSync(c)) { found = c; break; }
    }
    if (found) {
      importPath = found;
    } else {
      // 目录无入口，尝试当作包名 import（保留原 target）
      const mod = await import(target);
      const cfg = (mod.default ?? mod) as AgentCliConfig;
      assertValidConfig(cfg, target);
      return cfg;
    }
  }

  const mod = await import(importPath);
  const cfg = (mod.default ?? mod) as AgentCliConfig;
  assertValidConfig(cfg, importPath);
  return cfg;
}

function assertValidConfig(cfg: unknown, source: string): asserts cfg is AgentCliConfig {
  if (!cfg || typeof cfg !== "object" || !("createAgent" in cfg)) {
    throw new Error(`${source} 不是有效的 AgentCliConfig（缺少 createAgent）`);
  }
}

export interface AgentDriverOpts {
  tui: TUI;
  getState: () => UIState;
  setState: (updater: (s: UIState) => UIState) => void;
  /** 渲染后回调（app 可在此检查 exitRequested）。 */
  onRender?: () => void;
  /** 音效配置（环境变量 > 此处 > 默认值）。 */
  soundConfig?: Partial<SoundConfig>;
}

export class AgentDriver {
  private tui: TUI;
  private getState: () => UIState;
  private setState: (updater: (s: UIState) => UIState) => void;
  private onRender?: () => void;
  private config: AgentCliConfig;
  private agent: AgentHandle | null = null;
  private abortController: AbortController | null = null;
  private maouRoot: string;
  private sound: SoundManager;

  constructor(config: AgentCliConfig, opts: AgentDriverOpts) {
    this.config = config;
    this.tui = opts.tui;
    this.getState = opts.getState;
    this.setState = opts.setState;
    this.onRender = opts.onRender;
    this.maouRoot = join(process.env.HOME ?? "", ".maou");
    this.sound = new SoundManager(opts.soundConfig);
  }

  /** 获取音效管理器（供 Ctrl+S 切换等外部操作）。 */
  getSoundManager(): SoundManager {
    return this.sound;
  }

  /** 获取当前 agent 的工具白名单（供 /tools 命令显示）。 */
  getToolWhitelist(): readonly string[] {
    return this.agent?.toolWhitelist ?? [];
  }

  /** 获取当前终端审批模式（normal/auto/yolo，供状态栏显示）。 */
  getApprovalMode(): string {
    try { return getTerminalMode(this.agent?.agentName ?? "coding"); } catch { return "normal"; }
  }

  /** 获取可用 provider 列表（供设置菜单 API 配置用）。 */
  getProviders(): { id: string; name?: string }[] {
    try { return this.config.getProviders?.() ?? []; } catch { return []; }
  }

  /** 获取某 provider 下的 model 列表。 */
  getModels(provider: string): { id: string; name?: string }[] {
    try { return this.config.getModels?.(provider) ?? []; } catch { return []; }
  }

  /** 应用 reducer patch 到 state 并触发渲染 + 音效。 */
  private applyEvent(ev: StreamEvent): void {
    this.setState(s => {
      const patch = reduce(s, ev);
      return { ...s, ...patch };
    });
    this.tui.requestRender();
    this.onRender?.();

    // ── 音效触发（副作用，不在 reducer 中） ──────────────
    this.triggerSound(ev);
  }

  /** 根据事件类型触发音效 + 桌面通知。 */
  private triggerSound(ev: StreamEvent): void {
    switch (ev.type) {
      case "done": {
        this.sound.play("done", {
          title: "MAOU",
          body: "任务完成",
          urgency: "low",
        } as TerminalNotification);
        this.sound.clearIdleTimer();
        break;
      }
      case "error": {
        this.sound.play("error", {
          title: "MAOU",
          body: "运行出错",
          urgency: "critical",
        } as TerminalNotification);
        this.sound.clearIdleTimer();
        break;
      }
      case "log": {
        const level = ev.level as string | undefined;
        if (level === "error" || level === "warning" || level === "warn") {
          this.sound.play("warning");
        }
        // 空闲计时：log 事件也算活跃
        if (this.getState().streaming) this.sound.resetIdleTimer();
        break;
      }
      case "model.error":
      case "model.loop_detected":
      case "round_limit": {
        this.sound.play("warning");
        break;
      }
      default: {
        // 其他事件：streaming 中重置空闲计时器
        if (this.getState().streaming) this.sound.resetIdleTimer();
        break;
      }
    }
  }

  /** 发送用户消息，驱动 agent。 */
  async send(text: string): Promise<void> {
    const state = this.getState();
    if (!text.trim() || state.streaming) return;

    // 物化 agent 句柄（首次）
    if (!this.agent) {
      try {
        this.agent = this.config.createAgent(process.cwd(), this.maouRoot);
        // 注入 agentName 到状态栏
        this.setState(s => ({ ...s, agentName: this.agent?.agentName ?? s.agentName }));
        // 注入交互式审批器：use_terminal normal 模式 ask 分支弹 Yes/No 菜单
        setTerminalApprover((cmd: string, ctx: { agentName: string; cwd?: string }) => this.requestApproval(cmd, ctx.agentName));
      } catch (e) {
        this.toast(`agent 创建失败: ${String(e).slice(0, 50)}`, "err");
        return;
      }
    }
    const handle = this.agent;

    // pushUserMessage（移植自 store.pushUserMessage）
    const userMsg = { id: `u${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, role: "user" as const, blocks: [{ type: "text" as const, content: text }], ts: Date.now() };
    this.setState(s => ({
      ...s,
      messages: [...s.messages, userMsg],
      streaming: true,
      currentRoundUsage: { input: 0, output: 0 },
      eventBlock: { mode: "thinking" as const, upTokens: 0, downTokens: 0, detail: undefined },
      toast: null,
    }));
    this.tui.requestRender();
    this.sound.startIdleTimer();

    this.abortController = new AbortController();
    try {
      const preset = this.config.getPreset(this.getState().provider, this.getState().model);
      let sessionId = this.getState().sessionId ?? handle.startSession();
      if (!this.getState().sessionId) {
        this.setState(s => ({ ...s, sessionId }));
        this.tui.requestRender();
      }
      await runAgentCli(text, {
        runtime: handle.runtime,
        sessionId,
        preset,
        onEvent: (ev: StreamEvent) => {
          this.applyEvent(ev);
        },
        signal: this.abortController.signal,
        source: "tui",
      });
      // runAgentCli 遇 done/error 即 return，state 已由 reducer 更新
    } catch (e) {
      // 兜底：确保 streaming 关闭（reducer 可能没收到 error 事件）
      this.toast(String(e).slice(0, 60), "err");
      this.setState(s => ({ ...s, streaming: false, aborting: false }));
      this.sound.clearIdleTimer();
      this.tui.requestRender();
    }
  }

  /** 中断当前运行。 */
  abort(): void {
    const state = this.getState();
    if (state.aborting) return;
    this.setState(s => ({ ...s, aborting: true }));
    this.abortController?.abort();
    this.sound.clearIdleTimer();
    this.toast("已中断", "info");
  }

  /**
   * 交互式命令审批：弹 SelectList overlay 让用户选 Yes/No（Claude Code 式）。
   * 由 use_terminal normal 模式 ask 分支经 setTerminalApprover 调用，await 等用户选。
   * 选项：Yes（本次）/ Yes且不再问（加白名单）/ No（拒绝）/ No且不再问（加黑名单）。
   */
  requestApproval(command: string, agentName: string): Promise<{ approve: boolean; persist?: "whitelist" | "blacklist" | "none" }> {
    // 弹出审批时播放提示音
    this.sound.play("approval", {
      title: "MAOU",
      body: "需要审批",
      urgency: "critical",
    } as TerminalNotification);

    return new Promise((resolve) => {
      const items: SelectItem[] = [
        { value: "yes", label: "Yes", description: "执行本次" },
        { value: "yes-always", label: "Yes, and don't ask again", description: "执行并加入白名单" },
        { value: "no", label: "No", description: "拒绝" },
        { value: "no-always", label: "No, and don't ask again", description: "拒绝并加入黑名单" },
      ];
      const list = new SelectList(items, 8, selectListTheme, { overflowSearch: false });
      const handle = this.tui.showOverlay(list, {
        anchor: "bottom-center",
        width: "100%",
        maxHeight: 8,
      });
      list.onSelect = (item) => {
        handle.hide();
        const v = item.value;
        if (v === "yes-always") addTerminalWhitelist(agentName, command);
        if (v === "no-always") addTerminalBlacklist(agentName, command);
        resolve({
          approve: v.startsWith("yes"),
          persist: v === "yes-always" ? "whitelist" : v === "no-always" ? "blacklist" : "none",
        });
      };
      list.onCancel = () => { handle.hide(); resolve({ approve: false, persist: "none" }); };
    });
  }

  /**
   * 设置菜单：用 overlay 栈做多级菜单（和斜杠命令分开）。
   * 一级菜单选设置项 → 关一级弹二级选具体值。
   * 比 SettingsList 简单可控（SettingsList 对 CJK label 渲染有问题）。
   */
  showSettings(): void {
    const agentName = this.agent?.agentName ?? "coding";
    const currentMode = this.getApprovalMode();
    // 一级菜单：设置项列表
    const items: SelectItem[] = [
      { value: "apiConfig", label: "API 配置", description: `当前: ${this.getState().provider}/${this.getState().model}` },
      { value: "approvalMode", label: "审批模式", description: `当前: ${currentMode}` },
    ];
    const list = new SelectList(items, 8, selectListTheme, { overflowSearch: false });
    const handle = this.tui.showOverlay(list, {
      anchor: "bottom-center",
      width: "100%",
      maxHeight: 8,
    });
    list.onSelect = (item) => {
      handle.hide();
      if (item.value === "approvalMode") {
        this.showApprovalModeSubmenu(agentName);
      } else if (item.value === "apiConfig") {
        this.showApiConfigSubmenu();
      }
    };
    list.onCancel = () => { handle.hide(); };
    this.tui.requestRender();
  }

  /** API 配置子菜单：先选 provider → 再选 model */
  private showApiConfigSubmenu(): void {
    const providers = this.getProviders();
    if (providers.length === 0) {
      this.toast("无可用 API 配置（~/.maou/config.json 为空）", "warn");
      return;
    }
    const providerItems: SelectItem[] = providers.map(p => ({
      value: p.id,
      label: p.name ?? p.id,
      description: p.id,
    }));
    const list = new SelectList(providerItems, 8, selectListTheme, { overflowSearch: false });
    const handle = this.tui.showOverlay(list, {
      anchor: "bottom-center",
      width: "100%",
      maxHeight: 10,
    });
    list.onSelect = (item) => {
      handle.hide();
      this.showModelSubmenu(item.value);
    };
    list.onCancel = () => { handle.hide(); };
    this.tui.requestRender();
  }

  /** Model 子菜单：选 provider 后选具体 model */
  private showModelSubmenu(provider: string): void {
    const models = this.getModels(provider);
    if (models.length === 0) {
      this.toast(`provider ${provider} 下无可用模型`, "warn");
      return;
    }
    const modelItems: SelectItem[] = models.map(m => ({
      value: m.id,
      label: m.name ?? m.id,
      description: m.id,
    }));
    const list = new SelectList(modelItems, 8, selectListTheme, { overflowSearch: false });
    const handle = this.tui.showOverlay(list, {
      anchor: "bottom-center",
      width: "100%",
      maxHeight: 10,
    });
    list.onSelect = (item) => {
      handle.hide();
      this.setProviderModel(provider, item.value);
      this.toast(`API → ${provider}/${item.value}`, "ok");
    };
    list.onCancel = () => { handle.hide(); };
    this.tui.requestRender();
  }

  /** 二级菜单：审批模式选择（normal/auto/yolo） */
  private showApprovalModeSubmenu(agentName: string): void {
    const subItems: SelectItem[] = [
      { value: "normal", label: "Normal", description: "每次命令需确认" },
      { value: "auto", label: "Auto", description: "小模型审核自动放行" },
      { value: "yolo", label: "Yolo", description: "全部放行不确认" },
    ];
    const subList = new SelectList(subItems, 8, selectListTheme, { overflowSearch: false });
    const subHandle = this.tui.showOverlay(subList, {
      anchor: "bottom-center",
      width: "100%",
      maxHeight: 8,
    });
    subList.onSelect = (item) => {
      subHandle.hide();
      setTerminalMode(agentName, item.value as "normal" | "auto" | "yolo");
      this.toast(`审批模式 → ${item.value}`, "ok");
    };
    subList.onCancel = () => { subHandle.hide(); };
    this.tui.requestRender();
  }

  /** 设置 provider/model（启动时由 index 从 preset 推断，或未来 ModelDialog 用）。 */
  setProviderModel(provider: string, model: string): void {
    this.setState(s => ({ ...s, provider, model }));
    this.tui.requestRender();
  }

  /** 推断默认 provider/model（取 config 第一个 provider 的第一个 model，若无则留空）。 */
  initProviderModel(): void {
    const providers = this.config.getProviders?.() ?? [];
    if (providers.length === 0) return;
    const provider = providers[0]!;
    const models = this.config.getModels?.(provider.id) ?? [];
    const model = models[0]?.id ?? "";
    const maxContext = this.extractMaxContext(provider.id, model);
    this.setState(s => ({ ...s, provider: provider.id, model, maxContext }));
  }

  /** 从 preset 提取 maxContext（若 preset 带 maxContext 字段）。 */
  private extractMaxContext(provider: string, model: string): number {
    try {
      const preset = this.config.getPreset(provider, model) as { maxContext?: number };
      return Number(preset?.maxContext) || 0;
    } catch {
      return 0;
    }
  }

  toast(text: string, kind: "ok" | "err" | "info" | "warn"): void {
    this.setState(s => ({
      ...s,
      toast: { text: text.slice(0, 80), kind, expiresAt: Date.now() + 4000 },
    }));
    this.tui.requestRender();
  }

  /** 清除消息/会话（"new" 命令用）。 */
  clearMessages(): void {
    this.setState(s => ({
      ...s,
      messages: [],
      currentAssistantId: null,
      rounds: [],
      cacheHistory: [],
      round: 0,
      sessionId: null,
      toast: { text: "新会话", kind: "ok", expiresAt: Date.now() + 2000 },
    }));
    this.agent = null; // 下次 send 重新物化（新 session）
    this.tui.requestRender();
  }
}

/** 生成用户消息 id（与 reducer uid 同源风格，供 app 直接 push 用）。 */
export const userMsgId = (): string => `u${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

// 重新导出 uid 供 app 用（避免 app 直接依赖 reducer 内部）
export { uid };
