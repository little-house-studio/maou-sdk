/**
 * Agent 工厂 —— 从预设创建 agent，初始化 eve 目录结构。
 */

import {
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { AgentRegistry } from "./registry.js";

// ─── 类型 ──────────────────────────────────────────────────────────────────

export interface AgentFactoryConfig {
  name: string;
  role: string;
  preset?: string;
  race?: string;
  personality?: string;
  permission?: string;
  team?: string;
  description?: string;
  notes?: string;
  scope?: string;
  customSoul?: string;
}

export interface AgentCreateResult {
  success: boolean;
  agentName: string;
  agentDir: string;
  filesCreated: string[];
  message: string;
}

export interface AgentPreview {
  name: string;
  role: string;
  preset: string;
  race: string;
  personality: string;
  permission: string;
  team: string;
  description: string;
  scope: string;
  agentDir: string;
  filesToCreate: string[];
}

// ─── 预设定义 ──────────────────────────────────────────────────────────────

/** 基础预设映射 */
const PRESETS: Record<string, Record<string, unknown>> = {
  default: {
    race_style: "标准",
    profession_rules: "遵循通用助手规范，保持专业和友好。",
  },
  coder: {
    race_style: "赛博",
    profession_rules:
      "你是资深软件工程师。代码风格简洁、注重可读性。优先使用已有技术栈。",
  },
  writer: {
    race_style: "文雅",
    profession_rules:
      "你是专业写作助手。语言优美、逻辑清晰，善于组织复杂信息。",
  },
  researcher: {
    race_style: "学术",
    profession_rules:
      "你是研究助手。严谨求证，引用来源，区分事实与推测。",
  },
};

// ─── AgentFactory ──────────────────────────────────────────────────────────

export class AgentFactory {
  private maouRoot: string;
  private projectRoot: string;

  constructor(maouRoot: string, projectRoot: string) {
    this.maouRoot = maouRoot;
    this.projectRoot = projectRoot;
  }

  /**
   * 创建 agent：注册到 Registry + 初始化 eve 目录结构
   */
  createAgent(config: AgentFactoryConfig): AgentCreateResult {
    try {
      // 字段归一化：容忍 HTTP 层传入的非字符串（number/undefined 等），统一转 string
      const str = (v: unknown): string | undefined =>
        v === undefined || v === null ? undefined : String(v);
      const normalized: AgentFactoryConfig = {
        name: str(config.name) ?? "",
        role: str(config.role) ?? "",
        preset: str(config.preset),
        race: str(config.race),
        personality: str(config.personality),
        permission: str(config.permission),
        team: str(config.team),
        description: str(config.description),
        notes: str(config.notes),
        scope: str(config.scope),
        customSoul: str(config.customSoul),
      };
      const resolved = this.mergePresets(normalized);
      const agentDir = join(this.maouRoot, "agents", normalized.name);
      mkdirSync(agentDir, { recursive: true });
      const filesCreated: string[] = [];

      // ── eve 结构：prompt/system/system.md + before_user + compression ──

      // prompt/system/system.md — 系统提示词入口
      const promptSystemDir = join(agentDir, "prompt", "system");
      mkdirSync(promptSystemDir, { recursive: true });
      const systemContent = this.buildSystemMd(resolved);
      writeFileSync(join(promptSystemDir, "system.md"), systemContent, "utf-8");
      filesCreated.push("prompt/system/system.md");

      // prompt/before_user/before_user.md
      const beforeUserDir = join(agentDir, "prompt", "before_user");
      mkdirSync(beforeUserDir, { recursive: true });
      const beforeUserContent = this.buildBeforeUserMd();
      writeFileSync(join(beforeUserDir, "before_user.md"), beforeUserContent, "utf-8");
      filesCreated.push("prompt/before_user/before_user.md");

      // prompt/compression/compression.md
      const compressionDir = join(agentDir, "prompt", "compression");
      mkdirSync(compressionDir, { recursive: true });
      writeFileSync(join(compressionDir, "compression.md"), "", "utf-8");
      filesCreated.push("prompt/compression/compression.md");

      // prompt/PREVIEW/
      mkdirSync(join(agentDir, "prompt", "PREVIEW"), { recursive: true });

      // tools/ — 工具目录
      const toolsDir = join(agentDir, "tools");
      mkdirSync(toolsDir, { recursive: true });
      writeFileSync(join(toolsDir, ".gitkeep"), "", "utf-8");
      filesCreated.push("tools/.gitkeep");

      // channels/ — 消息通道目录
      const channelsDir = join(agentDir, "channels");
      mkdirSync(channelsDir, { recursive: true });
      writeFileSync(join(channelsDir, ".gitkeep"), "", "utf-8");
      filesCreated.push("channels/.gitkeep");

      // schedules/ — 定时任务目录
      const schedulesDir = join(agentDir, "schedules");
      mkdirSync(schedulesDir, { recursive: true });
      writeFileSync(join(schedulesDir, ".gitkeep"), "", "utf-8");
      filesCreated.push("schedules/.gitkeep");

      // PERMISSION.jsonc
      const permissionData = this.getPermission(config.permission ?? "full");
      writeFileSync(
        join(agentDir, "PERMISSION.jsonc"),
        JSON.stringify(permissionData, null, 2),
        "utf-8",
      );
      filesCreated.push("PERMISSION.jsonc");

      // OUTPUT.jsonc — 输出格式
      const outputContent = this.buildOutputJsonc(config.preset);
      writeFileSync(join(agentDir, "OUTPUT.jsonc"), outputContent, "utf-8");
      filesCreated.push("OUTPUT.jsonc");

      // README.md
      const readmeContent = this.buildReadmeMd(normalized.name);
      writeFileSync(join(agentDir, "README.md"), readmeContent, "utf-8");
      filesCreated.push("README.md");

      // 注册到 AgentRegistry
      const reg = new AgentRegistry(this.maouRoot);
      const agentOptions = {
        displayName: normalized.name,
        role: normalized.role,
        team: normalized.team ?? "",
        personality: normalized.personality ?? "",
        scope: normalized.scope ?? "project",
        description: normalized.description ?? "",
        notes: normalized.notes ?? "",
      };

      let message: string;
      if (reg.exists(normalized.name)) {
        reg.update(normalized.name, agentOptions);
        message = `Agent '${normalized.name}' 已更新`;
      } else {
        reg.create(normalized.name, agentOptions);
        message = `Agent '${normalized.name}' 已创建`;
      }

      return {
        success: true,
        agentName: config.name,
        agentDir,
        filesCreated,
        message,
      };
    } catch (e) {
      return {
        success: false,
        agentName: config.name,
        agentDir: "",
        filesCreated: [],
        message: String(e),
      };
    }
  }

  /**
   * 列出所有可用预设
   */
  listPresets(): Record<string, Record<string, unknown>> {
    return { ...PRESETS };
  }

  /**
   * 预览 agent 配置（不实际创建）
   */
  previewAgent(config: AgentFactoryConfig): AgentPreview {
    // 字段归一化（与 createAgent 一致，容忍非字符串输入）
    const str = (v: unknown): string | undefined =>
      v === undefined || v === null ? undefined : String(v);
    const normalized: AgentFactoryConfig = {
      name: str(config.name) ?? "",
      role: str(config.role) ?? "",
      preset: str(config.preset),
      race: str(config.race),
      personality: str(config.personality),
      permission: str(config.permission),
      team: str(config.team),
      description: str(config.description),
      notes: str(config.notes),
      scope: str(config.scope),
      customSoul: str(config.customSoul),
    };
    const resolved = this.mergePresets(normalized);
    return {
      name: normalized.name,
      role: normalized.role,
      preset: normalized.preset ?? "default",
      race: normalized.race ?? "human",
      personality: normalized.personality ?? "",
      permission: normalized.permission ?? "full",
      team: normalized.team ?? "",
      description: normalized.description ?? "",
      scope: normalized.scope ?? "project",
      agentDir: join(this.maouRoot, "agents", normalized.name),
      filesToCreate: [
        "prompt/system/system.md",
        "prompt/before_user/before_user.md",
        "prompt/compression/compression.md",
        "tools/.gitkeep",
        "channels/.gitkeep",
        "schedules/.gitkeep",
        "PERMISSION.jsonc",
        "OUTPUT.jsonc",
        "README.md",
      ],
    };
  }

  // ── 内部构建方法 ──

  private mergePresets(config: AgentFactoryConfig): {
    name: string;
    role: string;
    personality: string;
    raceStyle: string;
    team: string;
    description: string;
    notes: string;
    scope: string;
    professionRules: string;
  } {
    const preset = PRESETS[config.preset ?? "default"] ?? PRESETS.default;
    return {
      name: config.name,
      role: config.role,
      personality: config.personality ?? "",
      raceStyle: String(preset.race_style ?? "标准"),
      team: config.team ?? "",
      description: config.description ?? "",
      notes: config.notes ?? "",
      scope: config.scope ?? "project",
      professionRules: String(preset.profession_rules ?? ""),
    };
  }

  private buildSystemMd(resolved: {
    name: string;
    role: string;
    personality: string;
    raceStyle: string;
    team: string;
    description: string;
    professionRules: string;
  }): string {
    const lines = [
      `# ${resolved.name}`,
      "",
      `你是一个${resolved.role}。`,
      "",
    ];
    if (resolved.personality) {
      lines.push(`## 性格`, resolved.personality, "");
    }
    if (resolved.team) {
      lines.push(`## 团队`, resolved.team, "");
    }
    if (resolved.description) {
      lines.push(`## 描述`, resolved.description, "");
    }
    if (resolved.professionRules) {
      lines.push(`## 规则`, resolved.professionRules, "");
    }
    lines.push("", "## 工具使用", "", "根据用户需求，合理使用可用工具完成任务。", "");
    return lines.join("\n");
  }

  private buildBeforeUserMd(): string {
    return [
      "<system_background>",
      "（在此放每次用户输入前要注入的动态背景）",
      "</system_background>",
      "",
    ].join("\n");
  }

  private buildOutputJsonc(preset?: string): string {
    return JSON.stringify(
      {
        format: "structured",
        preset: preset ?? "default",
      },
      null,
      2,
    );
  }

  private getPermission(level: string): Record<string, unknown> {
    const permissions: Record<string, Record<string, unknown>> = {
      full: { permission_preset: "full", tool_whitelist: ["*"] },
      restricted: {
        permission_preset: "restricted",
        tool_whitelist: ["reader", "glob", "grep", "find_code"],
      },
      observer: {
        permission_preset: "observer",
        tool_whitelist: ["reader", "glob", "grep"],
      },
    };
    return permissions[level] ?? permissions.full;
  }

  private buildReadmeMd(name: string): string {
    return [
      `# Agent: ${name}`,
      "",
      "此目录定义了一个 AI Agent，遵循「文件即 Agent」eve 约定。",
      "",
      "## 目录结构",
      "",
      "```",
      `${name}/`,
      "├── prompt/",
      "│   ├── system/system.md      # 系统提示词（Agent 的「大脑」）",
      "│   ├── before_user/           # 用户输入前注入",
      "│   ├── compression/           # 压缩提示词",
      "│   └── PREVIEW/               # 渲染预览产物",
      "├── tools/                  # Agent 专属工具（每个 .ts 文件自动注册为工具）",
      "├── channels/               # 消息通道（每个 .json 文件定义一个通道适配）",
      "├── schedules/              # 定时任务（每个 .json 文件定义一个 cron 触发）",
      "├── agent.json              # 元数据（工具白名单/重试/loop 上限/终端模式）",
      "├── PERMISSION.jsonc         # 工具权限白名单",
      "├── OUTPUT.jsonc             # 输出格式定义",
      "└── README.md               # 本文件",
      "```",
      "",
      "## 约定规则",
      "",
      "- **prompt/system/system.md** 是 Agent 的系统提示词入口，支持 `{{file.md}}` 包含语法",
      "- **tools/** 下的工具文件自动注册为可用工具",
      "- **channels/** 下的文件自动注册为消息通道",
      "- **schedules/** 下的文件自动注册为定时任务",
      "- 添加文件 = 添加能力，删除文件 = 移除能力，重命名文件 = 重命名",
      "",
    ].join("\n");
  }
}
