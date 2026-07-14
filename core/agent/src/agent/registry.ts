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
import { getTemplateRef } from "./template-ref.js";
import { resolvePromptRoot, resolveAgentConfig } from "./template.js";

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
  /** 辅助模型配置（可选）—— 用于压缩/loop判定/路由等辅助调用。
   * 字符串匹配 preset name 或 model id；未配置时回退主模型。
   * 优先级：agent.json helperModel > 全局 helperPreset > 主模型 preset
   */
  helperModel?: string;
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

/**
 * 项目级 Agent 模板 —— ensureProjectAgent() 用来物化到 <projectRoot>/.maou/agents/<name>/
 * 当项目级 agent 不存在时，按此模板创建一份 Eve 风格的可编辑骨架。
 */
export interface ProjectAgentTemplate {
  /** 系统提示词正文（写入 ROLE/SYSTEM.md） */
  systemPrompt: string;
  /** 工具白名单（写入 PERMISSION.jsonc.tool_whitelist + agent.json.tools） */
  toolWhitelist: string[];
  /** agent.json 中的 role 字段（如 "coding" / "default"）。默认 "default"。 */
  role?: string;
  /** agent.json 中的 display_name。默认取 name 首字母大写。 */
  displayName?: string;
  /** agent.json 中的 description。默认空字符串。 */
  description?: string;
  /** 轮次上限（写入 agent.json.round_limit）。默认 50。 */
  roundLimit?: number;
  /** 工具输出压缩级别（写入 agent.json.tool_compression）。默认 "normal"。 */
  toolCompression?: "off" | "normal" | "aggressive";
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────

const AGENT_FILE = "agent.json";
const AGENT_TS_FILE = "agent.ts";
const INSTRUCTIONS_FILE = "instructions.md";

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

/**
 * 内置默认项目级 Agent 模板（coding 风格）。
 * 当全局同名 agent 不完整（无 prompt 内容）时，用此模板物化到项目级目录。
 * 内容参考 ~/.maou/agents/coding/ 的 coding agent 配置。
 */
const DEFAULT_PROJECT_AGENT_TEMPLATE: ProjectAgentTemplate = {
  role: "coding",
  displayName: "Coding Agent",
  description: "项目级编码助手（自动物化）",
  roundLimit: 50,
  toolCompression: "normal",
  toolWhitelist: [
    "reader",
    "write_file",
    "edit_file",
    "glob",
    "grep",
    "find_code",
    "use_terminal",
    "search_internet",
    "use_skill",
    "find_skill",
    "todo_manage",
    "todo_finish",
  ],
  systemPrompt: `# 编程 Agent

你是一个驻扎在项目目录里的编程 agent，擅长阅读代码库、实现需求、修复缺陷、重构与验证。

## 工作方式
- **先理解再动手**：改动前先摸清相关文件与现有约定，模仿周边代码风格，不要凭空假设。
- **小步可验证**：优先做最小可用改动，改完即用终端/测试验证，失败如实报告，不谎报成功。
- **绑定项目根**：你驻扎在当前项目目录，所有路径以项目根为基准。

## 工具纪律
- 只使用授权工具（见工具白名单）。
- **查代码结构**（函数/类/调用关系/谁调用了 X）优先用 \`find_code\`（action=search/callers/callees/…），不是 grep。
- 文本检索用 grep；按文件名找路径用 glob；读内容用 reader。
- 跑命令用 use_terminal。破坏性或对外操作（删除、覆盖、推送）先确认，除非已被明确授权。
- 多步骤复杂需求先用 todo_manage 建清单；每完成一项调用 todo_finish；全部完成后回复用户。

## 输出
- 用简洁中文说明你做了什么、为什么、验证结果。引用代码用 file_path:line 形式。
`,
};

// ─── AgentRegistry ─────────────────────────────────────────────────────────

export class AgentRegistry {
  readonly agentsDir: string;
  /** 项目级 agent 目录（可选，优先级高于全局） */
  readonly projectAgentsDir?: string;
  /** 项目根路径（用于物化时自动填写 working_dir） */
  readonly projectRoot?: string;

  constructor(maouRoot: string, projectRoot?: string) {
    this.agentsDir = join(maouRoot, "agents");
    this.projectRoot = projectRoot;
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
   * 解析 agent 实例目录：项目级优先（若存在），回退全局。
   * 与 get() 的优先级一致，供 getPromptRoot/getPromptEntrypoint 等使用。
   * public 供 runtime 加载模板脚本（loop.ts/hook 等）使用。
   */
  resolveAgentDir(name: string): string {
    if (this.projectAgentsDir) {
      const projectDir = join(this.projectAgentsDir, name);
      if (existsSync(projectDir)) return projectDir;
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
   * - 无 agent.json 但有 instructions.md → 自动推断 AgentEntry
   * - 都没有 → 跳过（不是合法 Agent 目录）
   */
  private scanConvention(dir: string, dirName: string, source: string): AgentEntry | null {
    const agentFile = join(dir, AGENT_FILE);
    const agentTsFile = join(dir, AGENT_TS_FILE);
    const instructionsFile = join(dir, INSTRUCTIONS_FILE);

    // 0. 引用模式：有 .agent.ref → 读模板 agent.json 作基础，合并实例 agent.custom.json
    //    实例目录通常没有自己的 agent.json，只有 .agent.ref + agent.custom.json。
    const refPath = join(dir, ".agent.ref");
    if (existsSync(refPath)) {
      const templateDir = getTemplateRef(dir);
      if (templateDir) {
        const templateAgentJson = join(templateDir, AGENT_FILE);
        if (existsSync(templateAgentJson)) {
          try {
            const data = JSON.parse(readFileSync(templateAgentJson, "utf-8"));
            if (data && typeof data === "object") {
              // 合并 custom 覆盖；custom 里没有的字段保持模板值
              const custom = resolveAgentConfig(dir);
              return { ...data, ...custom, name: dirName, _source: source };
            }
          } catch {
            // 模板 agent.json 解析失败，继续尝试其它约定
          }
        }
      }
    }

    // 1. 优先读 agent.json（现有逻辑不变）
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
    //    注意：agent.ts 的实际 import 在运行时做，这里先标记
    if (existsSync(agentTsFile)) {
      const now = nowTs();
      let displayName = dirName;

      // 尝试从 instructions.md 提取标题
      if (existsSync(instructionsFile)) {
        try {
          const content = readFileSync(instructionsFile, "utf-8");
          const titleMatch = content.match(/^#\s+(.+)/m);
          if (titleMatch) displayName = titleMatch[1].trim();
        } catch { /* ignore */ }
      }

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

    // 3. 无 agent.json 和 agent.ts，但有 instructions.md → 从目录约定推断
    if (existsSync(instructionsFile)) {
      const now = nowTs();
      let displayName = dirName;
      try {
        const content = readFileSync(instructionsFile, "utf-8");
        const titleMatch = content.match(/^#\s+(.+)/m);
        if (titleMatch) displayName = titleMatch[1].trim();
      } catch { /* ignore */ }

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
      };
    }

    // 都没有 → 不是 Agent 目录
    return null;
  }

  /**
   * 列出所有 agent
   */
  list(): AgentEntry[] {
    return Object.values(this.loadAll());
  }

  /**
   * 获取单个 agent 配置（优先项目级）
   * 支持约定扫描：无 agent.json 但有 instructions.md 也能发现
   */
  get(name: string): AgentEntry | null {
    // 优先项目级
    if (this.projectAgentsDir) {
      const projectDir = join(this.projectAgentsDir, name);
      if (existsSync(projectDir)) {
        // 引用模式：有 .agent.ref → 用 resolveAgentConfig 合并模板+custom
        if (existsSync(join(projectDir, ".agent.ref"))) {
          const config = resolveAgentConfig(projectDir);
          if (config && typeof config === "object" && "name" in config) {
            return { ...config, _source: "project" } as unknown as AgentEntry;
          }
          return { name, _source: "project", ...config } as unknown as AgentEntry;
        }
        // 先尝试 agent.json
        const projectPath = join(projectDir, AGENT_FILE);
        if (existsSync(projectPath)) {
          try {
            const entry = { ...JSON.parse(readFileSync(projectPath, "utf-8")), _source: "project" };
            // 合并 agent.custom.json 覆盖
            const customPath = join(projectDir, "agent.custom.json");
            if (existsSync(customPath)) {
              try {
                const custom = JSON.parse(readFileSync(customPath, "utf-8"));
                return { ...entry, ...custom, _source: "project" };
              } catch { /* ignore */ }
            }
            return entry;
          } catch { /* 继续 */ }
        }
        // 约定扫描
        const agent = this.scanConvention(projectDir, name, "project");
        if (agent) return agent;
      }
    }

    // 回退全局
    const globalDir = join(this.agentsDir, name);
    if (!existsSync(globalDir)) return null;

    // 引用模式：全局 agent 也可以有 .agent.ref
    if (existsSync(join(globalDir, ".agent.ref"))) {
      const config = resolveAgentConfig(globalDir);
      if (config && typeof config === "object" && "name" in config) {
        return { ...config, _source: "global" } as unknown as AgentEntry;
      }
      return { name, _source: "global", ...config } as unknown as AgentEntry;
    }

    // 先尝试 agent.json
    const globalPath = join(globalDir, AGENT_FILE);
    if (existsSync(globalPath)) {
      try {
        const entry = { ...JSON.parse(readFileSync(globalPath, "utf-8")), _source: "global" };
        // 合并 agent.custom.json 覆盖
        const customPath = join(globalDir, "agent.custom.json");
        if (existsSync(customPath)) {
          try {
            const custom = JSON.parse(readFileSync(customPath, "utf-8"));
            return { ...entry, ...custom, _source: "global" };
          } catch { /* ignore */ }
        }
        return entry;
      } catch { /* 继续 */ }
    }

    // 约定扫描
    return this.scanConvention(globalDir, name, "global");
  }

  /**
   * 检查 agent 是否存在（检查全局和项目级）
   * 支持约定扫描：有 instructions.md 也算存在
   */
  exists(name: string): boolean {
    // 检查项目级
    if (this.projectAgentsDir) {
      const projectDir = join(this.projectAgentsDir, name);
      if (existsSync(projectDir)) {
        if (existsSync(join(projectDir, ".agent.ref"))) return true;
        if (existsSync(join(projectDir, AGENT_FILE))) return true;
        if (existsSync(join(projectDir, INSTRUCTIONS_FILE))) return true;
      }
    }
    // 检查全局
    const globalDir = join(this.agentsDir, name);
    if (!existsSync(globalDir)) return false;
    if (existsSync(join(globalDir, ".agent.ref"))) return true;
    return existsSync(join(globalDir, AGENT_FILE)) || existsSync(join(globalDir, INSTRUCTIONS_FILE));
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
   * 读取 agent 的 instructions.md（系统提示词）
   * 如果不存在，回退到 ROLE/SYSTEM.md
   */
  loadInstructions(name: string): string | null {
    const dir = this.agentDir(name);

    // 优先 instructions.md
    const instructionsFile = join(dir, INSTRUCTIONS_FILE);
    if (existsSync(instructionsFile)) {
      try {
        return readFileSync(instructionsFile, "utf-8");
      } catch { /* continue */ }
    }

    // 回退 ROLE/SYSTEM.md
    const systemFile = join(dir, "ROLE", "SYSTEM.md");
    if (existsSync(systemFile)) {
      try {
        return readFileSync(systemFile, "utf-8");
      } catch { /* continue */ }
    }

    return null;
  }

  /**
   * 获取 agent 的 prompt 根目录（用于 PromptCompiler）
   * 优先 ROLE/（现有逻辑），如果不存在则回退到 agent 目录本身
   * （instructions.md 在 agent 根目录下时，promptRoot 就是 agent 目录）
   */
  getPromptRoot(name: string): string {
    const dir = this.resolveAgentDir(name);
    // 引用模式：优先用 resolvePromptRoot（处理 .agent.ref + 实例覆盖）
    const refPath = join(dir, ".agent.ref");
    if (existsSync(refPath)) {
      return resolvePromptRoot(dir).promptRoot;
    }
    // 旧模式兼容
    if (existsSync(join(dir, "prompt", "system", "system.md"))) {
      return join(dir, "prompt");
    }
    const roleDir = join(dir, "ROLE");
    if (existsSync(roleDir) && existsSync(join(roleDir, "SYSTEM.md"))) {
      return roleDir;
    }
    if (existsSync(join(dir, INSTRUCTIONS_FILE))) {
      return dir;
    }
    return roleDir;
  }

  /**
   * 获取 agent 的 prompt 入口文件名
   */
  getPromptEntrypoint(name: string): string {
    const dir = this.resolveAgentDir(name);
    // 引用模式
    const refPath = join(dir, ".agent.ref");
    if (existsSync(refPath)) {
      return resolvePromptRoot(dir).entrypoint;
    }
    // 旧模式兼容
    if (existsSync(join(dir, "prompt", "system", "system.md"))) {
      return "system/system.md";
    }
    if (existsSync(join(dir, INSTRUCTIONS_FILE))) {
      if (!existsSync(join(dir, "ROLE", "SYSTEM.md"))) {
        return INSTRUCTIONS_FILE;
      }
    }
    return "SYSTEM.md";
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

  // ── 项目级 Agent 自动物化（Eve 风格）──

  /**
   * 确保项目级 agent 存在；不存在则物化一份 Eve 风格骨架到
   * `<projectRoot>/.maou/agents/<name>/`（agent.json + prompt/system/system.md + PERMISSION.jsonc）。
   *
   * 幂等：已存在（agent.json 在）则跳过，绝不覆盖用户已编辑的内容。
   *
   * 物化策略（优先级从高到低，引用模式）：
   * 1. 调用方传入 `template` 参数 → 用 _writeProjectAgent 写 eve 骨架（独立实例，无 ref）
   * 2. 全局 `~/.maou/agents/<name>/` 存在 → 写 .agent.ref 引用全局模板
   * 3. 全局 `<name>` 不存在但 `main` 存在 → 写 .agent.ref 引用 main 模板
   * 4. 都没有 → 用内置 DEFAULT_PROJECT_AGENT_TEMPLATE 写最小骨架
   *
   * 引用模式下：实例只存 .agent.ref + agent.custom.json，运行时读模板的 prompt/loop/hook，
   * 改模板即时生效。working_dir 写进 agent.custom.json。
   *
   * 注意：仅当 registry 构造时传入了 projectRoot 才生效，否则 no-op。
   *
   * @param name agent 名，默认 "main"
   * @param template 可选模板（直接写独立实例，不引用）
   * @returns 物化结果：{created: true, dir} 或 {created: false, reason}
   */
  ensureProjectAgent(
    name: string = "main",
    template?: ProjectAgentTemplate,
  ): { created: boolean; dir: string; reason: string } {
    if (!this.projectAgentsDir) {
      return { created: false, dir: "", reason: "registry 未配置 projectRoot" };
    }
    const projectDir = join(this.projectAgentsDir, name);
    const projectAgentJson = join(projectDir, AGENT_FILE);
    const projectRef = join(projectDir, ".agent.ref");

    // 幂等：已有 .agent.ref 或 agent.json → 跳过（绝不覆盖用户已编辑的内容）
    if (existsSync(projectRef) || existsSync(projectAgentJson)) {
      return { created: false, dir: projectDir, reason: "项目级 agent 已存在" };
    }

    mkdirSync(projectDir, { recursive: true });

    // 1. 调用方传入模板 → 写独立 eve 骨架（不引用，无 .agent.ref）
    if (template) {
      this._writeProjectAgent(projectDir, name, template);
      return { created: true, dir: projectDir, reason: "自定义模板" };
    }

    // 引用模板辅助：写 .agent.ref + agent.custom.json
    const writeRef = (templateDir: string, reason: string, custom: Record<string, unknown> = {}): { created: boolean; dir: string; reason: string } => {
      writeFileSync(projectRef, templateDir, "utf-8");
      writeFileSync(
        join(projectDir, "agent.custom.json"),
        JSON.stringify({ working_dir: this.projectRoot, ...custom }, null, 2),
        "utf-8",
      );
      return { created: true, dir: projectDir, reason };
    };

    // 2. 全局同名 agent 存在（agent.json 或自身 .agent.ref）→ 引用
    const globalDir = join(this.agentsDir, name);
    if (existsSync(join(globalDir, AGENT_FILE)) || existsSync(join(globalDir, ".agent.ref"))) {
      return writeRef(globalDir, "引用全局模板");
    }

    // 3. 全局 <name> 不存在但 main 存在 → 引用 main
    if (name !== "main") {
      const mainDir = join(this.agentsDir, "main");
      if (existsSync(join(mainDir, AGENT_FILE)) || existsSync(join(mainDir, ".agent.ref"))) {
        return writeRef(mainDir, "引用全局 main 模板", { display_name: name });
      }
    }

    // 4. 都没有 → 用内置默认模板写骨架（独立实例）
    this._writeProjectAgent(projectDir, name, DEFAULT_PROJECT_AGENT_TEMPLATE);
    return { created: true, dir: projectDir, reason: "内置默认模板" };
  }

  /**
   * 物化项目级 agent 到指定目录（Eve 风格骨架）。
   * 写入文件：
   * - agent.json               元数据 + 工具白名单 + round_limit + working_dir
   * - prompt/system/system.md  系统提示词（PromotCompiler eve 结构入口）
   * - PERMISSION.jsonc         工具白名单（强制）
   */
  private _writeProjectAgent(projectDir: string, name: string, template: ProjectAgentTemplate): void {
    const promptSystemDir = join(projectDir, "prompt", "system");
    mkdirSync(promptSystemDir, { recursive: true });

    const now = new Date().toISOString();
    const displayName = template.displayName ?? (name.charAt(0).toUpperCase() + name.slice(1));
    const role = template.role ?? "default";
    const description = template.description ?? "";
    const roundLimit = template.roundLimit ?? 50;
    const toolCompression = template.toolCompression ?? "normal";

    const agentEntry = {
      name,
      display_name: displayName,
      status: "idle",
      role,
      team: "",
      parent: "",
      personality: "",
      scope: "project",
      description,
      notes: "由 ensureProjectAgent() 自动物化；可自由编辑，不会被覆盖。",
      round_limit: roundLimit,
      tools: [...template.toolWhitelist],
      tool_compression: toolCompression,
      working_dir: this.projectRoot,
      created_at: now,
      updated_at: now,
    };
    writeFileSync(join(projectDir, AGENT_FILE), JSON.stringify(agentEntry, null, 2), "utf-8");

    // prompt/system/system.md —— PromotCompiler eve 结构入口（promptRoot=prompt/，entrypoint=system/system.md）
    writeFileSync(join(promptSystemDir, "system.md"), template.systemPrompt, "utf-8");

    // PERMISSION.jsonc —— 工具白名单（强制）
    const permission = {
      permission_preset: "full",
      tool_whitelist: [...template.toolWhitelist],
    };
    writeFileSync(join(projectDir, "PERMISSION.jsonc"), JSON.stringify(permission, null, 2), "utf-8");
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
