/**
 * Agent 注册表 —— 每个 Agent 一个目录
 * 全局: ~/.maou/agents/<name>/agent.json
 * 项目: <project_root>/.maou/agents/<name>/agent.json（覆盖全局）
 *
 * 优先级：项目级 > 全局
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";

// ─── 类型 ──────────────────────────────────────────────────────────────────

/** 消息通道定义（channels/ 目录下的 .json 文件） */
export interface ChannelEntry {
  /** 通道类型：http / feishu / slack / discord / webhook */
  type: string;
  /** 通道名称（文件名去掉扩展名） */
  name: string;
  /** 通道配置 */
  config: Record<string, unknown>;
  /** 来源路径 */
  sourcePath: string;
}

/** 定时任务定义（schedules/ 目录下的 .json 文件） */
export interface ScheduleEntry {
  /** cron 表达式 */
  cron: string;
  /** 任务名称（文件名去掉扩展名） */
  name: string;
  /** 触发时要执行的指令 */
  instruction: string;
  /** 附加配置 */
  config: Record<string, unknown>;
  /** 来源路径 */
  sourcePath: string;
}

/** Agent 目录中自动发现的工具 schema */
export interface AgentToolEntry {
  /** 工具名（从 schema.json 读取或从目录名推断） */
  name: string;
  /** 工具 schema（供 LLM 使用） */
  schema: Record<string, unknown>;
  /** 相对路径（用于白名单匹配） */
  path: string;
}

export interface AgentEntry {
  name: string;
  display_name: string;
  status: string;
  role: string;
  team: string;
  parent: string;
  personality: string;
  scope: string;
  description: string;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** 工具白名单（可选），["*"]或缺省=全部可用 */
  tools?: string[];
  /** agent 轮次上限（可选），0=无限 */
  round_limit?: number;
  /** 模型配置（可选），覆盖 preset 中的 model */
  model?: string;
  removal_request?: {
    reason: string;
    requested_by: string;
    requested_at: string;
    approved: boolean | null;
  };
  [key: string]: unknown;
}

export interface CreateAgentOptions {
  displayName?: string;
  role?: string;
  team?: string;
  parent?: string;
  personality?: string;
  scope?: string;
  description?: string;
  notes?: string;
  createdBy?: string;
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────

const AGENT_FILE = "agent.json";
const AGENT_TS_FILE = "agent.ts";

function nowTs(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function atomicWriteJson(filePath: string, data: unknown): void {
  mkdirSync(join(filePath, ".."), { recursive: true });
  const tmp = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, filePath);
}

/**
 * 去除 JSONC（带注释的 JSON）中的注释，便于 JSON.parse。
 * 支持 `//` 行注释和 `/* ... *\/` 块注释。字符串内部的注释标记不会被误处理。
 */
function stripJsoncComments(text: string): string {
  let result = "";
  let i = 0;
  let inString = false;
  let stringChar = "";
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      result += ch;
      if (ch === "\\") {
        result += next ?? "";
        i += 2;
        continue;
      }
      if (ch === stringChar) inString = false;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      result += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    result += ch;
    i += 1;
  }
  return result;
}

// ─── AgentRegistry ─────────────────────────────────────────────────────────

export class AgentRegistry {
  readonly agentsDir: string;
  /** 项目级 agent 目录（可选，优先级高于全局） */
  readonly projectAgentsDir?: string;

  constructor(maouRoot: string, projectRoot?: string) {
    this.agentsDir = join(maouRoot, "agents");
    if (projectRoot) {
      this.projectAgentsDir = join(projectRoot, ".maou", "agents");
    }
  }

  private agentPath(name: string, useProject?: boolean): string {
    if (useProject && this.projectAgentsDir) {
      return join(this.projectAgentsDir, name, AGENT_FILE);
    }
    return join(this.agentsDir, name, AGENT_FILE);
  }

  private agentDir(name: string, useProject?: boolean): string {
    if (useProject && this.projectAgentsDir) {
      return join(this.projectAgentsDir, name);
    }
    return join(this.agentsDir, name);
  }

  /**
   * 加载所有 agent 配置（合并全局 + 项目级）
   * 项目级覆盖全局同名 agent
   *
   * 约定优先：目录名即 Agent 名。
   * 有 agent.json → 读 JSON（现有逻辑不变）
   * 无 agent.json 但有 instructions.md → 从文件推断 AgentEntry
   */
  private loadAll(): Record<string, AgentEntry> {
    const result: Record<string, AgentEntry> = {};

    // 1. 加载全局 agent
    if (existsSync(this.agentsDir)) {
      const entries = readdirSync(this.agentsDir).sort();
      for (const entry of entries) {
        const dir = join(this.agentsDir, entry);
        try {
          if (!statSync(dir).isDirectory()) continue;
        } catch {
          continue;
        }
        const agent = this.scanConvention(dir, entry, "global");
        if (agent) result[agent.name] = agent;
      }
    }

    // 2. 加载项目级 agent（覆盖全局同名）
    if (this.projectAgentsDir && existsSync(this.projectAgentsDir)) {
      const entries = readdirSync(this.projectAgentsDir).sort();
      for (const entry of entries) {
        const dir = join(this.projectAgentsDir, entry);
        try {
          if (!statSync(dir).isDirectory()) continue;
        } catch {
          continue;
        }
        const agent = this.scanConvention(dir, entry, "project");
        if (agent) result[agent.name] = agent;
      }
    }

    return result;
  }

  /**
   * 约定扫描：从目录结构推断 Agent 定义
   *
   * 规则：
   * - 有 agent.json → 以 JSON 为准（现有逻辑），再用 instructions.md / tools/ 等补充
   * - 有 agent.json → 读取作为 AgentEntry
   * - 有 agent.ts（defineAgent 约定）→ 标记为 defineAgent 模式
   * - 都没有 → 跳过（不是合法 Agent 目录，不降级）
   */
  private scanConvention(dir: string, dirName: string, source: string): AgentEntry | null {
    const agentFile = join(dir, AGENT_FILE);
    const agentTsFile = join(dir, AGENT_TS_FILE);

    // 1. 读 agent.json
    if (existsSync(agentFile)) {
      try {
        const data = JSON.parse(readFileSync(agentFile, "utf-8"));
        if (data && typeof data === "object" && "name" in data) {
          return { ...data, _source: source };
        }
      } catch {
        // JSON 解析失败，继续
      }
    }

    // 2. 有 agent.ts（defineAgent 约定）→ 标记为 defineAgent 模式
    if (existsSync(agentTsFile)) {
      const now = nowTs();
      let displayName = dirName;

      // 读取 agent.json 里可能有的额外字段
      let extraFields: Record<string, unknown> = {};
      if (existsSync(agentFile)) {
        try {
          extraFields = JSON.parse(readFileSync(agentFile, "utf-8"));
        } catch { /* ignore */ }
      }

      return {
        name: dirName,
        display_name: displayName,
        status: "idle",
        role: "",
        team: "",
        parent: "",
        personality: "",
        scope: source,
        description: "",
        notes: "",
        created_by: "",
        created_at: now,
        updated_at: now,
        ...extraFields,
        _source: source,
        _hasAgentTs: true,
      };
    }

    // 都没有 → 不是合法 Agent 目录
    return null;
  }

  /**
   * 列出所有 agent
   */
  list(): AgentEntry[] {
    return Object.values(this.loadAll());
  }

  /**
   * 获取单个 agent 配置（唯一真相源：全局 ~/.maou/agents/<name>/）
   * 不降级到约定扫描，无 agent.json 则返回 null
   */
  get(name: string): AgentEntry | null {
    const globalDir = join(this.agentsDir, name);
    if (!existsSync(globalDir)) return null;
    const globalPath = join(globalDir, AGENT_FILE);
    if (existsSync(globalPath)) {
      try {
        return { ...JSON.parse(readFileSync(globalPath, "utf-8")), _source: "global" };
      } catch { /* JSON 损坏 */ }
    }
    // agent.ts（defineAgent）也合法
    return this.scanConvention(globalDir, name, "global");
  }

  /**
   * 检查 agent 是否存在（全局 ~/.maou/agents/<name>/）
   * 只认 agent.json，不降级
   */
  exists(name: string): boolean {
    const globalDir = join(this.agentsDir, name);
    if (!existsSync(globalDir)) return false;
    return existsSync(join(globalDir, AGENT_FILE));
  }

  /**
   * 创建新 agent
   */
  create(name: string, options: CreateAgentOptions = {}): AgentEntry {
    if (this.exists(name)) {
      throw new Error(`Agent '${name}' 已存在`);
    }
    const now = nowTs();
    const entry: AgentEntry = {
      name,
      display_name: options.displayName ?? name,
      status: "idle",
      role: options.role ?? "",
      team: options.team ?? "",
      parent: options.parent ?? "",
      personality: options.personality ?? "",
      scope: options.scope ?? "project",
      description: options.description ?? "",
      notes: options.notes ?? "",
      created_by: options.createdBy ?? options.parent ?? "",
      created_at: now,
      updated_at: now,
    };
    // 创建到全局目录
    atomicWriteJson(join(this.agentsDir, name, AGENT_FILE), entry);
    return entry;
  }

  /**
   * 更新 agent 字段
   */
  update(name: string, fields: Record<string, unknown>): AgentEntry | null {
    // 优先更新项目级，否则更新全局
    let path: string;
    if (this.projectAgentsDir && existsSync(join(this.projectAgentsDir, name, AGENT_FILE))) {
      path = join(this.projectAgentsDir, name, AGENT_FILE);
    } else {
      path = join(this.agentsDir, name, AGENT_FILE);
    }
    if (!existsSync(path)) return null;
    try {
      const data: Record<string, unknown> = JSON.parse(readFileSync(path, "utf-8"));
      for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined && v !== null) {
          data[k] = v;
        }
      }
      data.updated_at = nowTs();
      atomicWriteJson(path, data);
      return data as unknown as AgentEntry;
    } catch {
      return null;
    }
  }

  /**
   * 设置 agent 状态
   */
  setStatus(name: string, status: string): void {
    this.update(name, { status });
  }

  /**
   * 删除 agent（整个目录）
   */
  delete(name: string): boolean {
    const dir = this.agentDir(name);
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  }

  /**
   * 请求移除 agent
   */
  requestRemoval(name: string, reason: string, requestedBy: string): AgentEntry {
    const path = this.agentPath(name);
    if (!existsSync(path)) {
      throw new Error(`Agent '${name}' 不存在`);
    }
    const data: Record<string, unknown> = JSON.parse(readFileSync(path, "utf-8"));
    data.removal_request = {
      reason,
      requested_by: requestedBy,
      requested_at: nowTs(),
      approved: null,
    };
    data.updated_at = nowTs();
    atomicWriteJson(path, data);
    return data as unknown as AgentEntry;
  }

  /**
   * 审批移除请求
   */
  approveRemoval(name: string): AgentEntry | null {
    const path = this.agentPath(name);
    if (!existsSync(path)) return null;
    try {
      const data: Record<string, unknown> = JSON.parse(readFileSync(path, "utf-8"));
      const req = data.removal_request as Record<string, unknown> | undefined;
      if (!req) return null;
      req.approved = true;
      data.removal_request = req;
      data.updated_at = nowTs();
      atomicWriteJson(path, data);
      return data as unknown as AgentEntry;
    } catch {
      return null;
    }
  }

  // ── 文件即 Agent：channels / schedules / tools 自动发现 ──

  /**
   * 扫描 agent 的 channels/ 目录，发现消息通道配置
   * 每个 .json 文件定义一个通道
   */
  loadChannels(name: string): ChannelEntry[] {
    const dir = this.agentDir(name);
    const channelsDir = join(dir, "channels");
    if (!existsSync(channelsDir)) return [];

    const channels: ChannelEntry[] = [];
    try {
      const entries = readdirSync(channelsDir).sort();
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const fullPath = join(channelsDir, entry);
        try {
          const data = JSON.parse(readFileSync(fullPath, "utf-8"));
          if (data && typeof data === "object" && "type" in data) {
            channels.push({
              type: String(data.type),
              name: entry.replace(/\.json$/, ""),
              config: data,
              sourcePath: fullPath,
            });
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* skip unreadable dir */ }

    return channels;
  }

  /**
   * 扫描 agent 的 schedules/ 目录，发现定时任务配置
   * 每个 .json 文件定义一个定时任务
   */
  loadSchedules(name: string): ScheduleEntry[] {
    const dir = this.agentDir(name);
    const schedulesDir = join(dir, "schedules");
    if (!existsSync(schedulesDir)) return [];

    const schedules: ScheduleEntry[] = [];
    try {
      const entries = readdirSync(schedulesDir).sort();
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const fullPath = join(schedulesDir, entry);
        try {
          const data = JSON.parse(readFileSync(fullPath, "utf-8"));
          if (data && typeof data === "object" && "cron" in data) {
            schedules.push({
              cron: String(data.cron),
              name: entry.replace(/\.json$/, ""),
              instruction: String(data.instruction ?? ""),
              config: data as Record<string, unknown>,
              sourcePath: fullPath,
            });
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* skip unreadable dir */ }

    return schedules;
  }

  /**
   * 扫描 agent 的 tools/ 目录，发现工具 schema
   * 递归扫描 tools/ 下所有 schema.json 文件
   */
  loadAgentTools(name: string): AgentToolEntry[] {
    const dir = this.agentDir(name);
    const toolsDir = join(dir, "tools");
    if (!existsSync(toolsDir)) return [];

    const tools: AgentToolEntry[] = [];
    this._scanToolDir(toolsDir, "", tools);
    return tools;
  }

  /**
   * 读取 agent 的系统提示词（eve 结构 prompt/system/system.md）
   * 缺失则抛错，不降级
   */
  loadInstructions(name: string): string {
    const dir = this.agentDir(name);
    const systemFile = join(dir, "prompt", "system", "system.md");
    if (!existsSync(systemFile)) {
      throw new Error(`agent '${name}' 缺少 eve 提示词结构（prompt/system/system.md 不存在）`);
    }
    try {
      return readFileSync(systemFile, "utf-8");
    } catch (err) {
      throw new Error(`agent '${name}' 读取 system.md 失败: ${err}`);
    }
  }

  /**
   * 获取 agent 的 prompt 根目录（用于 PromptCompiler）
   * 只返回 eve 结构 prompt/（存在 prompt/system/system.md 时）
   * 缺失则抛错，不降级
   */
  getPromptRoot(name: string): string {
    const dir = this.agentDir(name);
    if (existsSync(join(dir, "prompt", "system", "system.md"))) {
      return join(dir, "prompt");
    }
    throw new Error(`agent '${name}' 缺少 eve 提示词结构（prompt/system/system.md 不存在）`);
  }

  /**
   * 获取 agent 的 prompt 入口文件名
   * 只返回 eve 入口 "system/system.md"
   */
  getPromptEntrypoint(name: string): string {
    return "system/system.md";
  }

  /**
   * 加载 agent.ts 中的 defineAgent 配置（运行时调用）
   * 如果目录下有 agent.ts 文件，动态 import 并返回 DefinedAgent 对象
   */
  async loadDefinedAgent(name: string): Promise<import("./define-agent.js").DefinedAgent | null> {
    const dir = this.agentDir(name);
    const agentTsPath = join(dir, AGENT_TS_FILE);
    if (!existsSync(agentTsPath)) return null;

    try {
      const absolutePath = await import("node:path").then((m) => m.resolve(agentTsPath));
      const module = await import(absolutePath);
      const defaultExport = module.default;
      if (defaultExport && defaultExport._type === "defineAgent") {
        return defaultExport as import("./define-agent.js").DefinedAgent;
      }
      return null;
    } catch {
      return null;
    }
  }

  // ── 内部辅助 ──

  private _scanToolDir(dir: string, relPath: string, tools: AgentToolEntry[]): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        const subRelPath = relPath ? `${relPath}/${entry}` : entry;
        this._scanToolDir(fullPath, subRelPath, tools);
      } else if (entry === "schema.json") {
        try {
          const text = readFileSync(fullPath, "utf-8");
          const data = JSON.parse(text);
          const schemaPath = relPath || ".";
          if (Array.isArray(data)) {
            for (const s of data) {
              if (s && typeof s === "object" && "name" in s) {
                tools.push({ name: String(s.name), schema: s, path: schemaPath });
              }
            }
          } else if (data && typeof data === "object" && "name" in data) {
            tools.push({ name: String(data.name), schema: data, path: schemaPath });
          }
        } catch { /* skip malformed */ }
      }
    }
  }

}
