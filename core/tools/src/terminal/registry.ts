/**
 * TerminalRegistry — 常驻终端管理单例
 *
 * - Agent 级隔离：不同 agentName 的终端互不可见
 * - AI 自定义 ID：由 AI 指定名称，同名 exited 终端可复用
 * - 持久化：元数据写入 .maou/terminals.json，重启后恢复名单
 * - ring buffer：保留最近 2000 行输出
 */

import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { IPtyLike, SpawnPtyOptions } from "./pty.js";
import { spawnPty, buildSafeEnv } from "./pty.js";

const TRANSCRIPT_MAX = 2000;

export type TerminalState = "running" | "exited" | "interrupted";

export class Terminal {
  readonly id: string;
  readonly agentName: string;
  readonly createdAt: Date;

  pty: IPtyLike | null;
  state: TerminalState;
  exitCode: number | null;
  cwd: string;
  command: string;
  description: string;
  exitedAt?: Date;
  lastMessageAt?: Date;
  lastViewedAt?: Date;
  timedOut: boolean;

  private _ring: string[] = [];
  private _lineBuf = "";

  constructor(opts: {
    id: string;
    agentName: string;
    command: string;
    description: string;
    pty: IPtyLike;
    cwd: string;
  }) {
    this.id = opts.id;
    this.agentName = opts.agentName;
    this.command = opts.command;
    this.description = opts.description;
    this.pty = opts.pty;
    this.cwd = opts.cwd;
    this.state = "running";
    this.exitCode = null;
    this.createdAt = new Date();
    this.timedOut = false;
    this.lastMessageAt = new Date();

    this.pty.onData((data) => {
      this._appendData(data);
      this.lastMessageAt = new Date();
    });
    this.pty.onExit((e) => {
      this.state = "exited";
      this.exitCode = e.exitCode;
      this.exitedAt = new Date();
      this.lastMessageAt = new Date();
    });
  }

  get pid(): number {
    return this.pty?.pid ?? 0;
  }

  tail(n: number): string {
    return this._ring.slice(-n).join("\n");
  }

  /** 按字数返回尾部内容 */
  tailChars(n: number): string {
    const full = this._ring.join("\n");
    if (full.length <= n) return full;
    const truncated = full.slice(full.length - n);
    return `...[省略前 ${full.length - n} 字符]...\n${truncated}`;
  }

  write(data: string): void {
    if (this.state === "running" && this.pty) {
      this.pty.write(data);
    }
  }

  kill(signal?: string): boolean {
    if (this.state !== "running" || !this.pty) return false;
    this.pty.kill(signal || "SIGTERM");
    return true;
  }

  /** 复用已退出终端：清 buffer、换新 PTY */
  reuse(pty: IPtyLike, command: string, description: string): void {
    this._ring = [];
    this._lineBuf = "";
    this.pty = pty;
    this.command = command;
    this.description = description;
    this.state = "running";
    this.exitCode = null;
    this.exitedAt = undefined;
    this.timedOut = false;
    this.lastMessageAt = new Date();

    pty.onData((data) => {
      this._appendData(data);
      this.lastMessageAt = new Date();
    });
    pty.onExit((e) => {
      this.state = "exited";
      this.exitCode = e.exitCode;
      this.exitedAt = new Date();
      this.lastMessageAt = new Date();
    });
  }

  clearBuffer(): void {
    this._ring = [];
    this._lineBuf = "";
  }

  private _appendData(data: string): void {
    this._lineBuf += data;
    const lines = this._lineBuf.split("\n");
    this._lineBuf = lines.pop() ?? "";
    for (const line of lines) {
      this._ring.push(line);
    }
    if (this._ring.length > TRANSCRIPT_MAX) {
      this._ring.splice(0, this._ring.length - TRANSCRIPT_MAX);
    }
  }
}

export interface CreateTerminalOptions {
  agentName: string;
  id: string;
  command: string;
  args?: string[];
  cwd: string;
  description: string;
  sessionId: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

interface PersistedEntry {
  id: string;
  agentName: string;
  command: string;
  description: string;
  state: TerminalState;
  exitCode: number | null;
  cwd: string;
  createdAt: string;
  exitedAt?: string;
  lastMessageAt?: string;
  lastViewedAt?: string;
  timedOut: boolean;
}

function fmtDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}:${ss}`;
}

export function generateAutoId(): string {
  return "auto_" + randomBytes(3).toString("hex");
}

export class TerminalRegistry {
  private _byId = new Map<string, Terminal>();
  private _persistPath: string | null = null;

  setPersistPath(path: string): void {
    this._persistPath = path;
    this.load();
  }

  /** 创建新终端或复用已退出的同名终端 */
  createOrReuse(opts: CreateTerminalOptions): { terminal: Terminal; reused: boolean } {
    const existing = this._byId.get(opts.id);
    if (existing && existing.agentName !== opts.agentName) {
      throw new Error(`终端 ${opts.id} 属于另一个 Agent，无法操作`);
    }
    if (existing && existing.state === "running") {
      throw new Error(`终端 ${opts.id} 正在运行任务「${existing.description}」，请先 stop 或等待完成`);
    }

    const safeEnv = buildSafeEnv(opts.env);
    const ptyOpts: SpawnPtyOptions = {
      cwd: opts.cwd,
      env: safeEnv,
      cols: opts.cols ?? 120,
      rows: opts.rows ?? 36,
    };
    const cmdStr = opts.command + (opts.args?.length ? " " + opts.args.join(" ") : "");
    const pty = spawnPty(opts.command, opts.args ?? [], ptyOpts);

    if (existing) {
      existing.reuse(pty, cmdStr, opts.description);
      return { terminal: existing, reused: true };
    }

    const term = new Terminal({
      id: opts.id,
      agentName: opts.agentName,
      command: cmdStr,
      description: opts.description,
      pty,
      cwd: opts.cwd,
    });
    this._byId.set(opts.id, term);
    return { terminal: term, reused: false };
  }

  get(id: string): Terminal | undefined {
    return this._byId.get(id);
  }

  list(agentName: string): Terminal[] {
    return Array.from(this._byId.values()).filter((t) => t.agentName === agentName);
  }

  /** 仅返回有后台运行终端的 agent 的状态面板文本 */
  agentStatusPanel(agentName: string): string {
    const terminals = this.list(agentName);
    if (terminals.length === 0) return "";

    const lines: string[] = [];
    for (const t of terminals) {
      const stateLabel =
        t.state === "running"
          ? t.timedOut ? "⚠ 超时运行中" : "▶ 运行中"
          : t.state === "exited"
            ? `■ 已退出(${t.exitCode})`
            : "✕ 已中断";
      const created = fmtDate(t.createdAt);
      const lastMsg = t.lastMessageAt ? fmtDate(t.lastMessageAt) : "-";
      const lastView = t.lastViewedAt ? fmtDate(t.lastViewedAt) : "未查看";
      lines.push(`${t.id} | ${t.description} | ${stateLabel} | 创建:${created} | 更新:${lastMsg} | 查看:${lastView}`);
    }
    return lines.join("\n");
  }

  remove(id: string, agentName: string): boolean {
    const t = this._byId.get(id);
    if (!t || t.agentName !== agentName) return false;
    t.kill("SIGKILL");
    this._byId.delete(id);
    return true;
  }

  cleanupAgent(agentName: string): number {
    let count = 0;
    for (const [id, t] of this._byId) {
      if (t.agentName === agentName) {
        t.kill("SIGKILL");
        this._byId.delete(id);
        count++;
      }
    }
    return count;
  }

  shutdown(): void {
    for (const t of this._byId.values()) {
      t.kill("SIGKILL");
    }
    this._byId.clear();
  }

  /** 持久化元数据到磁盘 */
  persist(): void {
    if (!this._persistPath) return;
    const entries: PersistedEntry[] = [];
    for (const t of this._byId.values()) {
      entries.push({
        id: t.id,
        agentName: t.agentName,
        command: t.command,
        description: t.description,
        state: t.state,
        exitCode: t.exitCode,
        cwd: t.cwd,
        createdAt: t.createdAt.toISOString(),
        exitedAt: t.exitedAt?.toISOString(),
        lastMessageAt: t.lastMessageAt?.toISOString(),
        lastViewedAt: t.lastViewedAt?.toISOString(),
        timedOut: t.timedOut,
      });
    }
    try {
      const dir = dirname(this._persistPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this._persistPath, JSON.stringify(entries, null, 2), "utf-8");
    } catch { /* best effort */ }
  }

  /** 从磁盘加载元数据（running 标记为 interrupted） */
  load(): void {
    if (!this._persistPath || !existsSync(this._persistPath)) return;
    try {
      const raw: PersistedEntry[] = JSON.parse(readFileSync(this._persistPath, "utf-8"));
      for (const e of raw) {
        if (this._byId.has(e.id)) continue;
        const term = Object.create(Terminal.prototype) as Terminal;
        (term as any).id = e.id;
        (term as any).agentName = e.agentName;
        (term as any).command = e.command;
        (term as any).description = e.description;
        (term as any).cwd = e.cwd;
        (term as any).createdAt = new Date(e.createdAt);
        (term as any).exitedAt = e.exitedAt ? new Date(e.exitedAt) : undefined;
        (term as any).lastMessageAt = e.lastMessageAt ? new Date(e.lastMessageAt) : undefined;
        (term as any).lastViewedAt = e.lastViewedAt ? new Date(e.lastViewedAt) : undefined;
        (term as any).timedOut = e.timedOut ?? false;
        (term as any).pty = null;
        (term as any)._ring = [];
        (term as any)._lineBuf = "";
        (term as any).state = e.state === "running" ? "interrupted" : e.state;
        (term as any).exitCode = e.state === "running" ? null : e.exitCode;
        this._byId.set(e.id, term);
      }
    } catch { /* best effort */ }
  }
}

export const TERMINAL_REGISTRY = new TerminalRegistry();
