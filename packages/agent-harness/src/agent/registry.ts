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

function nowTs(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function atomicWriteJson(filePath: string, data: unknown): void {
  mkdirSync(join(filePath, ".."), { recursive: true });
  const tmp = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, filePath);
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
        const agentFile = join(dir, AGENT_FILE);
        if (!existsSync(agentFile)) continue;
        try {
          const data = JSON.parse(readFileSync(agentFile, "utf-8"));
          if (data && typeof data === "object" && "name" in data) {
            result[data.name] = { ...data, _source: "global" };
          }
        } catch {
          continue;
        }
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
        const agentFile = join(dir, AGENT_FILE);
        if (!existsSync(agentFile)) continue;
        try {
          const data = JSON.parse(readFileSync(agentFile, "utf-8"));
          if (data && typeof data === "object" && "name" in data) {
            result[data.name] = { ...data, _source: "project" };
          }
        } catch {
          continue;
        }
      }
    }

    return result;
  }

  /**
   * 列出所有 agent
   */
  list(): AgentEntry[] {
    return Object.values(this.loadAll());
  }

  /**
   * 获取单个 agent 配置（优先项目级）
   */
  get(name: string): AgentEntry | null {
    // 优先项目级
    if (this.projectAgentsDir) {
      const projectPath = join(this.projectAgentsDir, name, AGENT_FILE);
      if (existsSync(projectPath)) {
        try {
          return { ...JSON.parse(readFileSync(projectPath, "utf-8")), _source: "project" };
        } catch {
          // 继续尝试全局
        }
      }
    }

    // 回退全局
    const globalPath = join(this.agentsDir, name, AGENT_FILE);
    if (!existsSync(globalPath)) return null;
    try {
      return { ...JSON.parse(readFileSync(globalPath, "utf-8")), _source: "global" };
    } catch {
      return null;
    }
  }

  /**
   * 检查 agent 是否存在（检查全局和项目级）
   */
  exists(name: string): boolean {
    if (this.projectAgentsDir && existsSync(join(this.projectAgentsDir, name, AGENT_FILE))) {
      return true;
    }
    return existsSync(join(this.agentsDir, name, AGENT_FILE));
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
}

/**
 * 初始化 main agent（如果不存在则创建默认配置）
 */
export function initMainAgent(maouRoot: string): void {
  const registry = new AgentRegistry(maouRoot);
  if (!registry.exists("main")) {
    registry.create("main", {
      displayName: "Vampire",
      role: "assistant",
      personality: "友好、高效、专业的 AI 助手",
      description: "默认主 agent",
    });
  }
}
