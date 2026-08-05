/**
 * ProactiveService —— Agent 层主动智能循环
 *
 * 附属驻扎（nested under coding）扫描 → 看板 → 派发主体 coding（CodingDispatchPort）
 */

import type { StreamEvent } from "@little-house-studio/types";
import {
  buildDispatchUserMessage,
  buildScanUserPrompt,
  bumpRun,
  canRunToday,
  isQueued,
  mergeSuggestions,
  normalizeSettings,
  parseSuggestionsFromModelText,
  setItemChecked,
  setItemDone,
} from "./board-format.js";
import type {
  ProactiveBoard,
  ProactiveChatLine,
  ProactiveJobState,
  ProactiveSettings,
  ProactiveZone,
} from "./types.js";
import {
  findItem,
  readBoard,
  readSettings,
  writeBoard,
  writeBoardRaw,
  writeSettings,
} from "./board-store.js";
import { DEFAULT_PROACTIVE_AGENT_NAME } from "./defaults.js";
import {
  createProactiveAffiliateRunner,
  type ProactiveRunner,
} from "./runner.js";

const MAX_CHAT = 120;

export type ProactiveSnapshot = {
  board: ProactiveBoard;
  settings: ProactiveSettings;
  job: ProactiveJobState;
  chat: ProactiveChatLine[];
  projectRoot: string;
};

/** 主 coding 落地端口（宿主注入，避免 agent 层依赖 Web） */
export type CodingDispatchPort = {
  runChat(message: string): AsyncGenerator<StreamEvent>;
  abortRun?: () => void;
};

export type ProactiveServiceOpts = {
  getProjectRoot: () => string;
  maouRoot: string;
  sandboxMode?: string;
  getDispatchPort: () => CodingDispatchPort;
  /** 附属名，默认 proactive */
  scanAgentName?: string;
  /** 挂靠主体，默认 coding */
  parentAgentName?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function lineId(): string {
  return `pcl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "\n…(截断)";
}

function collectText(ev: StreamEvent): string {
  if (ev.type === "text_delta" || ev.type === "assistant_delta") {
    return String(
      (ev as { delta?: string; text?: string }).delta ??
        (ev as { text?: string }).text ??
        "",
    );
  }
  if (ev.type === "message" || ev.type === "assistant") {
    return String(
      (ev as { content?: string; text?: string }).content ??
        (ev as { text?: string }).text ??
        "",
    );
  }
  return "";
}

export class ProactiveService {
  private readonly getProjectRoot: () => string;
  private readonly maouRoot: string;
  private readonly sandboxMode: string;
  private readonly getDispatchPort: () => CodingDispatchPort;
  private readonly scanAgentName: string;
  private readonly parentAgentName: string;

  private job: ProactiveJobState = { status: "idle" };
  private chat: ProactiveChatLine[] = [];
  private runner: ProactiveRunner | null = null;
  private runnerProjectRoot = "";
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private afterEditTimer: ReturnType<typeof setTimeout> | null = null;
  private loopBusy = false;

  constructor(opts: ProactiveServiceOpts) {
    this.getProjectRoot = opts.getProjectRoot;
    this.maouRoot = opts.maouRoot;
    this.sandboxMode = opts.sandboxMode ?? "yolo";
    this.getDispatchPort = opts.getDispatchPort;
    this.scanAgentName = opts.scanAgentName ?? DEFAULT_PROACTIVE_AGENT_NAME;
    this.parentAgentName = opts.parentAgentName ?? "coding";
  }

  start(): void {
    this.rearmInterval();
    this.pushSystem(
      "主动智能（附属驻扎）已就绪。挂靠主 coding，非可切换主体。可开启扫描或点「立即扫描」。",
    );
  }

  stop(): void {
    this.clearIntervalTimer();
    if (this.afterEditTimer) {
      clearTimeout(this.afterEditTimer);
      this.afterEditTimer = null;
    }
    this.abort();
  }

  snapshot(): ProactiveSnapshot {
    const projectRoot = this.getProjectRoot();
    return {
      board: readBoard(projectRoot),
      settings: readSettings(projectRoot),
      job: this.job,
      chat: [...this.chat],
      projectRoot,
    };
  }

  getSettings(): ProactiveSettings {
    return readSettings(this.getProjectRoot());
  }

  setSettings(patch: Partial<ProactiveSettings>): ProactiveSettings {
    const next = writeSettings(this.getProjectRoot(), {
      ...readSettings(this.getProjectRoot()),
      ...patch,
    });
    this.rearmInterval();
    this.pushSystem(
      `设置已更新：enabled=${next.enabled} frequency=${next.frequency}` +
        (next.frequency === "interval"
          ? ` interval=${next.intervalMinutes}m`
          : "") +
        ` max/day=${next.maxRunsPerDay}`,
    );
    return next;
  }

  getBoard(): ProactiveBoard {
    return readBoard(this.getProjectRoot());
  }

  saveBoardRaw(raw: string): ProactiveBoard {
    return writeBoardRaw(this.getProjectRoot(), raw);
  }

  updateBoard(mutator: (b: ProactiveBoard) => ProactiveBoard): ProactiveBoard {
    const root = this.getProjectRoot();
    return writeBoard(root, mutator(readBoard(root)));
  }

  setItemQueue(id: string, queued: boolean): ProactiveBoard {
    return this.updateBoard((b) => setItemChecked(b, id, queued));
  }

  setItemDoneFlag(id: string, done: boolean): ProactiveBoard {
    return this.updateBoard((b) => setItemDone(b, id, done));
  }

  abort(): void {
    this.runner?.abort();
    try {
      this.getDispatchPort().abortRun?.();
    } catch {
      /* ignore */
    }
    if (this.job.status === "scanning" || this.job.status === "dispatching") {
      this.job = { status: "error", message: "已中止", at: nowIso() };
      this.pushSystem("任务已中止。");
    }
    this.loopBusy = false;
  }

  notifyProjectEdit(): void {
    const s = normalizeSettings(readSettings(this.getProjectRoot()));
    if (!s.enabled || s.frequency !== "after_edit") return;
    if (this.afterEditTimer) clearTimeout(this.afterEditTimer);
    this.afterEditTimer = setTimeout(() => {
      this.afterEditTimer = null;
      void this.runScan({ reason: "after_edit" });
    }, 8000);
  }

  async runScan(opts?: {
    reason?: string;
    autoDispatch?: boolean;
  }): Promise<ProactiveSnapshot> {
    if (this.loopBusy) {
      this.pushSystem("已有扫描/派发在进行，请稍后再试。");
      return this.snapshot();
    }
    const root = this.getProjectRoot();
    let settings = normalizeSettings(readSettings(root));
    if (!canRunToday(settings)) {
      this.pushSystem(
        `今日扫描次数已达上限（${settings.maxRunsPerDay}）。可在设置中调高 maxRunsPerDay。`,
      );
      return this.snapshot();
    }

    this.loopBusy = true;
    this.job = { status: "scanning", startedAt: nowIso() };
    const reason = opts?.reason ?? "manual";
    this.pushUser(`【扫描】触发：${reason}`);
    this.pushSystem("附属驻扎 agent 正在分析项目…");

    try {
      const prompt = buildScanUserPrompt(root);
      let assistantText = "";
      for await (const ev of this.runScanAgent(prompt)) {
        const chunk = collectText(ev);
        if (chunk) assistantText += chunk;
        if (ev.type === "error") {
          throw new Error(
            String((ev as { message?: string }).message ?? "scan error"),
          );
        }
      }

      if (assistantText.trim()) {
        this.pushAssistant(truncate(assistantText, 6000));
      }

      const suggestions = parseSuggestionsFromModelText(assistantText);
      let board = readBoard(root);
      if (suggestions.length) {
        board = mergeSuggestions(board, suggestions);
        for (const it of board.items) {
          if (it.done) continue;
          if (
            settings.autoZones.includes(it.zone as ProactiveZone) &&
            suggestions.some((s) => s.zone === it.zone && s.title === it.title)
          ) {
            board = setItemChecked(board, it.id, true);
          }
        }
        board = writeBoard(root, board);
        this.pushSystem(
          `已合并 ${suggestions.length} 条建议到看板` +
            (settings.autoZones.length
              ? `；自动勾选分区：${settings.autoZones.join("、")}`
              : ""),
        );
      } else {
        this.pushSystem("模型未返回可解析的 proactive-json 条目（看板未变）。");
      }

      settings = writeSettings(root, {
        ...bumpRun(settings),
        lastScanAt: nowIso(),
      });

      const shouldAuto =
        opts?.autoDispatch !== false &&
        settings.enabled &&
        (settings.frequency === "interval" ||
          settings.frequency === "after_edit" ||
          reason === "manual_auto");

      this.job = { status: "idle" };
      this.loopBusy = false;

      if (shouldAuto) {
        const queued = board.items.filter((i) => !i.done && isQueued(i));
        const autoIds = queued
          .filter((i) => settings.autoZones.includes(i.zone as ProactiveZone))
          .map((i) => i.id);
        if (autoIds.length) {
          this.pushSystem(`自动派发 ${autoIds.length} 条（autoZones）…`);
          return this.runDispatch(autoIds, { auto: true });
        }
      }

      return this.snapshot();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.job = { status: "error", message: msg, at: nowIso() };
      this.pushSystem(`扫描失败：${msg}`);
      this.loopBusy = false;
      return this.snapshot();
    }
  }

  async runDispatch(
    itemIds: string[],
    opts?: { auto?: boolean },
  ): Promise<ProactiveSnapshot> {
    if (this.loopBusy) {
      this.pushSystem("扫描/派发进行中，无法再次派发。");
      return this.snapshot();
    }
    const root = this.getProjectRoot();
    const board = readBoard(root);
    const ids = [...new Set(itemIds)].filter(Boolean);
    const items = ids
      .map((id) => findItem(board, id))
      .filter((i): i is NonNullable<typeof i> => Boolean(i) && !i!.done);

    if (!items.length) {
      this.pushSystem("没有可派发的条目（已完成或不存在）。");
      return this.snapshot();
    }

    this.loopBusy = true;
    this.job = {
      status: "dispatching",
      startedAt: nowIso(),
      itemIds: items.map((i) => i.id),
    };
    this.pushUser(
      `【派发】${opts?.auto ? "自动" : "手动"} → 主体 coding · ${items.map((i) => i.title).join("；")}`,
    );

    const port = this.getDispatchPort();
    try {
      for (const item of items) {
        this.pushSystem(
          `开始落地：${item.title}（${item.zone} / 风险 ${item.risk}）`,
        );
        const msg = buildDispatchUserMessage(item);
        let reply = "";
        try {
          for await (const ev of port.runChat(msg)) {
            const chunk = collectText(ev);
            if (chunk) reply += chunk;
            if (ev.type === "error") {
              throw new Error(
                String(
                  (ev as { message?: string }).message ?? "dispatch error",
                ),
              );
            }
          }
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          this.pushSystem(`派发失败「${item.title}」：${m}`);
          continue;
        }
        if (reply.trim()) {
          this.pushAssistant(truncate(reply, 4000));
        }
        const settings = readSettings(root);
        const autoComplete =
          Boolean(opts?.auto) &&
          settings.autoZones.includes(item.zone as ProactiveZone) &&
          (item.risk === "低" || String(item.risk).toLowerCase() === "low");
        if (autoComplete) {
          writeBoard(root, setItemDone(readBoard(root), item.id, true));
          this.pushSystem(`已自动勾选完成：${item.title}`);
        } else {
          writeBoard(root, setItemChecked(readBoard(root), item.id, false));
          this.pushSystem(
            `已派发「${item.title}」给主体 coding。请在看板确认完成后勾选。`,
          );
        }
      }

      writeSettings(root, {
        ...readSettings(root),
        lastDispatchAt: nowIso(),
      });
      this.job = { status: "idle" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.job = { status: "error", message: msg, at: nowIso() };
      this.pushSystem(`派发异常：${msg}`);
    } finally {
      this.loopBusy = false;
    }
    return this.snapshot();
  }

  async *chatStream(message: string): AsyncGenerator<StreamEvent> {
    const text = message.trim();
    if (!text) return;
    this.pushUser(text);
    let acc = "";
    try {
      for await (const ev of this.runScanAgent(text)) {
        yield ev;
        const chunk = collectText(ev);
        if (chunk) acc += chunk;
      }
      if (acc.trim()) this.pushAssistant(truncate(acc, 6000));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.pushSystem(`对话失败：${msg}`);
      yield { type: "error", message: msg };
    }
  }

  private rearmInterval(): void {
    this.clearIntervalTimer();
    const s = normalizeSettings(readSettings(this.getProjectRoot()));
    if (!s.enabled || s.frequency !== "interval") return;
    const ms = Math.max(5, s.intervalMinutes) * 60 * 1000;
    this.intervalTimer = setInterval(() => {
      void this.runScan({ reason: "interval" });
    }, ms);
    this.intervalTimer.unref?.();
  }

  private clearIntervalTimer(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  private ensureRunner(): ProactiveRunner {
    const projectRoot = this.getProjectRoot();
    if (this.runner && this.runnerProjectRoot === projectRoot) {
      return this.runner;
    }
    this.runner = createProactiveAffiliateRunner({
      projectRoot,
      maouRoot: this.maouRoot,
      parentAgentName: this.parentAgentName,
      agentName: this.scanAgentName,
      sandboxMode: this.sandboxMode,
    });
    this.runnerProjectRoot = projectRoot;
    return this.runner;
  }

  private async *runScanAgent(
    userMessage: string,
  ): AsyncGenerator<StreamEvent> {
    const runner = this.ensureRunner();
    yield* runner.run(userMessage);
  }

  private pushUser(text: string) {
    this.push({ role: "user", text });
  }
  private pushAssistant(text: string) {
    this.push({ role: "assistant", text });
  }
  private pushSystem(text: string) {
    this.push({ role: "system", text });
  }
  private push(p: { role: ProactiveChatLine["role"]; text: string }) {
    this.chat.push({
      id: lineId(),
      role: p.role,
      text: p.text,
      ts: nowIso(),
    });
    if (this.chat.length > MAX_CHAT) {
      this.chat = this.chat.slice(-MAX_CHAT);
    }
  }
}

/** @deprecated 别名 */
export { ProactiveService as ProactiveHub };
export type { ProactiveServiceOpts as ProactiveHubOpts };
