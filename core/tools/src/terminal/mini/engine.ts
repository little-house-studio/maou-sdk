/**
 * 纯 Node 管道终端（mini）。
 * Unix：detached 新进程组 + kill(-pid)；Windows：PowerShell -Command + taskkill /T。
 * write / resize / openInteractive / subscribe 不支持。
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isHumanTerminal, MiniUnsupportedError, type FilterConfig, type RunResult, type SandboxConfig, type TerminalBackend, type TerminalInfo } from "../backend.js";
import { inferPromptWaitState, peekOverflow } from "../overflow.js";
import { agentShellInvocation } from "../windows-shell.js";

const RING_MAX_CHARS = 200_000;
const MAX_TERMINALS = 200;

type MiniState = "running" | "exited" | "killed" | "interrupted";

interface MiniEntry {
  id: string;
  agentName: string;
  command: string;
  description: string;
  cwd: string;
  state: MiniState;
  exitCode: number | null;
  createdAt: string;
  updatedAt: string;
  lastViewedAt?: string;
  output: string;
  child: ChildProcess | null;
  pid: number | null;
}

function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function shellInvocation(command: string): { program: string; args: string[] } {
  return agentShellInvocation(command);
}

function appendOutput(entry: MiniEntry, chunk: string): void {
  if (!chunk) return;
  entry.output += chunk;
  if (entry.output.length > RING_MAX_CHARS) {
    entry.output = entry.output.slice(entry.output.length - RING_MAX_CHARS);
  }
  entry.updatedAt = nowStamp();
}

function assertOwner(entry: MiniEntry, agentName: string): void {
  if (entry.agentName !== agentName) {
    throw new Error(`终端 ${entry.id} 属于其他 Agent (${entry.agentName})，无权操作`);
  }
}

function killTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

/** 与 Rust PersistedTerminal 对齐，full↔mini 可互读 */
interface PersistedMini {
  id: string;
  agent_name: string;
  command: string;
  description: string;
  cwd: string;
  state: string;
  exit_code: number | null;
  created_at: string;
  updated_at: string;
  last_viewed_at?: string | null;
  ring: string[];
  kind?: string;
}

function toRing(output: string): string[] {
  if (!output) return [];
  return output.split(/(?<=\n)/).filter((s) => s.length > 0);
}

function fromPersisted(raw: Record<string, unknown>): MiniEntry | null {
  const id = String(raw.id ?? "").trim();
  if (!id) return null;
  const stateRaw = String(raw.state ?? "interrupted");
  const state: MiniState =
    stateRaw === "running" || stateRaw === "interrupted"
      ? "interrupted"
      : stateRaw === "killed"
        ? "killed"
        : "exited";
  const ring = Array.isArray(raw.ring) ? (raw.ring as unknown[]).map((x) => String(x)) : [];
  const output = typeof raw.output === "string" ? raw.output : ring.join("");
  return {
    id,
    agentName: String(raw.agentName ?? raw.agent_name ?? ""),
    command: String(raw.command ?? ""),
    description: String(raw.description ?? ""),
    cwd: String(raw.cwd ?? ""),
    state,
    exitCode:
      raw.exitCode === null || raw.exit_code === null
        ? null
        : raw.exitCode != null
          ? Number(raw.exitCode)
          : raw.exit_code != null
            ? Number(raw.exit_code)
            : null,
    createdAt: String(raw.createdAt ?? raw.created_at ?? nowStamp()),
    updatedAt: String(raw.updatedAt ?? raw.updated_at ?? nowStamp()),
    lastViewedAt:
      raw.lastViewedAt != null
        ? String(raw.lastViewedAt)
        : raw.last_viewed_at != null
          ? String(raw.last_viewed_at)
          : undefined,
    output,
    child: null,
    pid: null,
  };
}

export class MiniBackend implements TerminalBackend {
  readonly kind = "mini" as const;
  /** resolve 在 full 降级时置 true，statusPanel / 调用方据此加文案 */
  degradedFromFull = false;
  private terminals = new Map<string, MiniEntry>();
  private persistPath: string | null = null;

  initEngine(_logDir?: string): void {
    /* no-op：会话在内存 + 可选 JSON */
  }

  setPersistPath(path: string): void {
    this.persistPath = path;
    try {
      mkdirSync(dirname(path), { recursive: true });
    } catch {
      /* ignore */
    }
    this.loadPersist();
  }

  async run(
    agentName: string,
    command: string,
    cwd: string,
    description: string,
    timeoutMs?: number,
    resultLimit?: number,
  ): Promise<RunResult> {
    const id = `term_${Date.now()}`;
    const start = Date.now();
    const timeout = timeoutMs && timeoutMs > 0 ? timeoutMs : 120_000;
    const entry = this.spawnEntry(id, agentName, command, cwd, description);
    const exitCode = await this.waitEntry(entry, timeout);
    const limit = resultLimit && resultLimit > 0 ? resultLimit : 5000;
    let output = entry.output;
    if (output.length > limit) output = `...${output.slice(output.length - limit)}`;
    const timedOut = exitCode === null && entry.state === "running";
    this.persist();
    return {
      ok: timedOut ? true : exitCode === 0,
      exitCode: timedOut ? null : exitCode,
      output,
      durationMs: Date.now() - start,
      terminalId: id,
      error: timedOut ? `超时 ${timeout}ms，已转后台` : null,
    };
  }

  async runBackground(
    agentName: string,
    command: string,
    cwd: string,
    description: string,
    id?: string,
  ): Promise<RunResult> {
    const terminalId = id?.trim() || `bg_${Date.now()}`;
    const start = Date.now();
    const existing = this.terminals.get(terminalId);
    if (existing?.state === "running") {
      throw new Error(`终端 ${terminalId} 正在运行，不能重复创建`);
    }
    if (existing) this.terminals.delete(terminalId);
    const entry = this.spawnEntry(terminalId, agentName, command, cwd, description);
    await new Promise((r) => setTimeout(r, 1000));
    const code = entry.exitCode;
    const still = entry.state === "running";
    return {
      ok: true,
      exitCode: still ? null : code,
      output: still ? entry.output.slice(-2000) : entry.output.slice(-5000),
      durationMs: Date.now() - start,
      terminalId,
      error: null,
    };
  }

  async write(_id: string, _agentName: string, _data: string): Promise<void> {
    throw new MiniUnsupportedError("write");
  }

  async stop(id: string, agentName: string): Promise<void> {
    const entry = this.mustGet(id);
    assertOwner(entry, agentName);
    this.killEntry(entry);
  }

  async logs(id: string, agentName: string, lines?: number): Promise<string> {
    const entry = this.mustGet(id);
    assertOwner(entry, agentName);
    entry.lastViewedAt = nowStamp();
    this.persist();
    const n = lines && lines > 0 ? lines : 100;
    const parts = entry.output.split("\n");
    return parts.slice(-n).join("\n");
  }

  list(agentName?: string): TerminalInfo[] {
    const out: TerminalInfo[] = [];
    for (const t of this.terminals.values()) {
      if (agentName && t.agentName !== agentName) continue;
      out.push(this.toInfo(t));
    }
    return out;
  }

  async remove(id: string, agentName: string): Promise<void> {
    const entry = this.mustGet(id);
    assertOwner(entry, agentName);
    if (entry.state === "running") {
      throw new Error(`终端 ${id} 正在运行，请先 stop`);
    }
    this.terminals.delete(id);
    this.persist();
  }

  cleanupAgent(agentName: string): void {
    for (const [id, t] of [...this.terminals.entries()]) {
      if (t.agentName !== agentName) continue;
      if (isHumanTerminal({ id, kind: id.startsWith("human_") ? "human" : "agent" })) continue;
      this.killEntry(t);
      this.terminals.delete(id);
    }
    this.persist();
  }

  shutdown(): void {
    for (const t of this.terminals.values()) this.killEntry(t);
    this.terminals.clear();
    this.persist();
  }

  setFilter(_config: FilterConfig): void {
    /* 安全门在 TS DCG，mini 不另做命令过滤 */
  }

  setSandbox(_config: SandboxConfig): void {
    /* 路径沙箱仍走 tools path-guard */
  }

  statusPanel(agentName: string): string {
    const all = this.list(agentName);
    const terminals = all.filter((t) => !isHumanTerminal(t));
    const humans = all.filter((t) => isHumanTerminal(t));
    const banner = this.degradedFromFull
      ? "terminalBackend=mini (degraded from full)\n"
      : "terminalBackend=mini\n";
    if (terminals.length === 0 && humans.length === 0) {
      return `${banner}📋 Agent ${agentName} 当前没有终端`;
    }
    const lines = [
      banner.trimEnd(),
      `📋 Agent ${agentName} 的终端列表 (共 ${terminals.length} 个)`,
      "| ID | 属主 | 描述 | 状态 | 闲忙 | 溢出 | 退出码 | 创建时间 |",
      "|------|------|------|------|------|------|--------|----------|",
    ];
    for (const t of terminals) {
      const entry = this.terminals.get(t.id);
      const wait = inferPromptWaitState(entry?.output ?? "", t.state);
      const waitLabel = wait === "waiting" ? "等你" : wait === "exited" ? "已结束" : "忙";
      const spill = peekOverflow(t.id) ?? "—";
      const emoji =
        t.state === "running" ? "🟢" : t.state === "killed" ? "🔴" : t.state === "interrupted" ? "⚠️" : "💤";
      const exit = t.exitCode != null ? String(t.exitCode) : "—";
      lines.push(
        `| ${t.id} | ${t.agentName || agentName} | ${t.description} | ${emoji} ${t.state} | ${waitLabel} | ${spill} | ${exit} | ${t.createdAt} |`,
      );
    }
    if (humans.length > 0) {
      lines.push("");
      lines.push(
        `人壳 ${humans.length} 个（输出不注入模型）: ` +
          humans.map((t) => `${t.id} ${t.state} ${t.cwd}`).join("; "),
      );
    }
    return lines.join("\n");
  }

  async resize(_id: string, _cols: number, _rows: number): Promise<void> {
    throw new MiniUnsupportedError("resize");
  }

  openInteractive(): Promise<{ id: string }> {
    return Promise.reject(new MiniUnsupportedError("openInteractive"));
  }

  private mustGet(id: string): MiniEntry {
    const entry = this.terminals.get(id);
    if (!entry) throw new Error(`终端 ${id} 不存在`);
    return entry;
  }

  private toInfo(t: MiniEntry): TerminalInfo {
    return {
      id: t.id,
      agentName: t.agentName,
      command: t.command,
      description: t.description,
      state: t.state,
      exitCode: t.exitCode,
      cwd: t.cwd,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      lastViewedAt: t.lastViewedAt,
      kind: t.id.startsWith("human_") ? "human" : "agent",
    };
  }

  private spawnEntry(
    id: string,
    agentName: string,
    command: string,
    cwd: string,
    description: string,
  ): MiniEntry {
    if (this.terminals.size >= MAX_TERMINALS) {
      throw new Error(`已达到最大并行终端数 (${MAX_TERMINALS})，请先关闭部分终端`);
    }
    const { program, args } = shellInvocation(command);
    const stamp = nowStamp();
    const entry: MiniEntry = {
      id,
      agentName,
      command,
      description,
      cwd,
      state: "running",
      exitCode: null,
      createdAt: stamp,
      updatedAt: stamp,
      output: "",
      child: null,
      pid: null,
    };

    const child = spawn(program, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    entry.child = child;
    entry.pid = child.pid ?? null;
    this.terminals.set(id, entry);
    this.persist();

    const onChunk = (buf: Buffer) => appendOutput(entry, buf.toString("utf8"));
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("error", (err) => {
      appendOutput(entry, `\n${err.message}`);
      entry.state = "exited";
      entry.exitCode = 1;
      entry.child = null;
      this.persist();
    });
    child.on("close", (code) => {
      if (entry.state === "running") {
        entry.state = "exited";
        entry.exitCode = code ?? 1;
      }
      entry.updatedAt = nowStamp();
      entry.child = null;
      this.persist();
    });
    return entry;
  }

  private waitEntry(entry: MiniEntry, timeoutMs: number): Promise<number | null> {
    if (entry.state !== "running") return Promise.resolve(entry.exitCode);
    return new Promise((resolve) => {
      const child = entry.child;
      if (!child) {
        resolve(entry.exitCode);
        return;
      }
      const timer = setTimeout(() => resolve(null), timeoutMs);
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }

  private killEntry(entry: MiniEntry): void {
    if (entry.state !== "running") return;
    if (entry.pid != null) killTree(entry.pid);
    else {
      try {
        entry.child?.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }
    entry.state = "killed";
    entry.updatedAt = nowStamp();
    entry.child = null;
    this.persist();
  }

  private persist(): void {
    const path = this.persistPath;
    if (!path) return;
    const entries: PersistedMini[] = [];
    for (const t of this.terminals.values()) {
      entries.push({
        id: t.id,
        agent_name: t.agentName,
        command: t.command,
        description: t.description,
        cwd: t.cwd,
        state: t.state,
        exit_code: t.exitCode,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
        last_viewed_at: t.lastViewedAt ?? null,
        ring: toRing(t.output),
        kind: t.id.startsWith("human_") ? "human" : "agent",
      });
    }
    try {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(entries, null, 2), "utf8");
      renameSync(tmp, path);
    } catch {
      /* best effort */
    }
  }

  private loadPersist(): void {
    const path = this.persistPath;
    if (!path || !existsSync(path)) return;
    try {
      const raw = readFileSync(path, "utf8").trim();
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (!item || typeof item !== "object") continue;
        const entry = fromPersisted(item as Record<string, unknown>);
        if (!entry) continue;
        const live = this.terminals.get(entry.id);
        if (live?.state === "running") continue;
        this.terminals.set(entry.id, entry);
      }
    } catch {
      /* 坏文件忽略，不挡启动 */
    }
  }
}
