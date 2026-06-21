/**
 * Agent 工厂 —— 从预设创建 agent，初始化 ROLE 目录结构。
 * 对应 Python: core/agent_factory/factory.py
 */

import {
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
  readFileSync,
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
  roleDir: string;
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
  roleDir: string;
  filesToCreate: string[];
}

/** 默认需要复制的模板脚本 */
const TEMPLATE_SCRIPTS = [
  "script/get-system.py",
  "script/get-time.py",
  "script/get-weather.py",
];

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
  private defaultRoleDir: string;

  constructor(maouRoot: string, projectRoot: string) {
    this.maouRoot = maouRoot;
    this.projectRoot = projectRoot;
    this.defaultRoleDir = join(projectRoot, "ROLE", "default");
  }

  /**
   * 创建 agent：注册到 Registry + 初始化 ROLE 目录
   */
  createAgent(config: AgentFactoryConfig): AgentCreateResult {
    try {
      const resolved = this.mergePresets(config);
      const roleDir = join(this.maouRoot, "agents", config.name, "ROLE");
      mkdirSync(roleDir, { recursive: true });
      const filesCreated: string[] = [];

      // 复制模板脚本
      for (const script of TEMPLATE_SCRIPTS) {
        const src = join(this.defaultRoleDir, script);
        const dst = join(roleDir, script);
        if (existsSync(src)) {
          mkdirSync(join(dst, ".."), { recursive: true });
          copyFileSync(src, dst);
          filesCreated.push(script);
        }
      }

      // SOUL.md
      const soulContent = config.customSoul ?? this.buildSoulMd(resolved);
      writeFileSync(join(roleDir, "SOUL.md"), soulContent, "utf-8");
      filesCreated.push("SOUL.md");

      // IDENTITY.md
      const identityContent = this.buildIdentityMd(resolved);
      writeFileSync(join(roleDir, "IDENTITY.md"), identityContent, "utf-8");
      filesCreated.push("IDENTITY.md");

      // SYSTEM.md
      const systemContent = this.buildSystemMd();
      writeFileSync(join(roleDir, "SYSTEM.md"), systemContent, "utf-8");
      filesCreated.push("SYSTEM.md");

      // BEFORE_USER.md
      const beforeUserContent = this.buildBeforeUserMd();
      writeFileSync(join(roleDir, "BEFORE_USER.md"), beforeUserContent, "utf-8");
      filesCreated.push("BEFORE_USER.md");

      // RULE.md
      const ruleContent = this.buildRuleMd(resolved.professionRules);
      writeFileSync(join(roleDir, "RULE.md"), ruleContent, "utf-8");
      filesCreated.push("RULE.md");

      // OUTPUT.jsonc
      const outputContent = this.buildOutputJsonc(config.preset);
      writeFileSync(join(roleDir, "OUTPUT.jsonc"), outputContent, "utf-8");
      filesCreated.push("OUTPUT.jsonc");

      // PERMISSION.jsonc
      const permissionData = this.getPermission(config.permission ?? "full");
      writeFileSync(
        join(roleDir, "PERMISSION.jsonc"),
        JSON.stringify(permissionData, null, 2),
        "utf-8",
      );
      filesCreated.push("PERMISSION.jsonc");

      // NOTES.md
      const notesContent = config.notes ?? "（暂无备注）";
      writeFileSync(join(roleDir, "NOTES.md"), notesContent + "\n", "utf-8");
      filesCreated.push("NOTES.md");

      // 注册到 AgentRegistry
      const reg = new AgentRegistry(this.maouRoot);
      const agentOptions = {
        displayName: config.name,
        role: config.role,
        team: config.team ?? "",
        personality: config.personality ?? "",
        scope: config.scope ?? "project",
        description: config.description ?? "",
        notes: config.notes ?? "",
      };

      let message: string;
      if (reg.exists(config.name)) {
        reg.update(config.name, agentOptions);
        message = `Agent '${config.name}' 已更新`;
      } else {
        reg.create(config.name, agentOptions);
        message = `Agent '${config.name}' 已创建`;
      }

      return {
        success: true,
        agentName: config.name,
        roleDir,
        filesCreated,
        message,
      };
    } catch (e) {
      return {
        success: false,
        agentName: config.name,
        roleDir: "",
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
    const resolved = this.mergePresets(config);
    return {
      name: config.name,
      role: config.role,
      preset: config.preset ?? "default",
      race: config.race ?? "human",
      personality: config.personality ?? "",
      permission: config.permission ?? "full",
      team: config.team ?? "",
      description: config.description ?? "",
      scope: config.scope ?? "project",
      roleDir: join(this.maouRoot, "agents", config.name, "ROLE"),
      filesToCreate: [
        "SOUL.md",
        "IDENTITY.md",
        "SYSTEM.md",
        "BEFORE_USER.md",
        "RULE.md",
        "OUTPUT.jsonc",
        "PERMISSION.jsonc",
        "NOTES.md",
        ...TEMPLATE_SCRIPTS,
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

  private buildSoulMd(resolved: {
    name: string;
    role: string;
    personality: string;
    raceStyle: string;
    team: string;
    description: string;
    notes: string;
    scope: string;
  }): string {
    const lines = [
      "# Soul",
      "",
      `## 名称`,
      resolved.name,
      "",
      `## 角色`,
      resolved.role,
      "",
      `## 种族风格`,
      resolved.raceStyle,
      "",
      `## 性格`,
      resolved.personality || "（未指定）",
      "",
    ];
    if (resolved.team) {
      lines.push(`## 团队`, resolved.team, "");
    }
    if (resolved.description) {
      lines.push(`## 描述`, resolved.description, "");
    }
    if (resolved.scope) {
      lines.push(`## 作用域`, resolved.scope, "");
    }
    return lines.join("\n");
  }

  private buildIdentityMd(resolved: {
    name: string;
    role: string;
    description: string;
  }): string {
    return [
      "# Identity",
      "",
      `名称: ${resolved.name}`,
      `角色: ${resolved.role}`,
      resolved.description ? `描述: ${resolved.description}` : "",
      "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private buildSystemMd(): string {
    return [
      "# System Prompt",
      "",
      "{{IDENTITY.md}}",
      "{{SOUL.md}}",
      "{{RULE.md}}",
      "",
    ].join("\n");
  }

  private buildBeforeUserMd(): string {
    return [
      "# Before User Message",
      "",
      "在每次用户发言前，确保理解上下文并保持角色一致性。",
      "",
    ].join("\n");
  }

  private buildRuleMd(professionRules: string): string {
    return ["# Rules", "", professionRules, ""].join("\n");
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
      full: { file_read: true, file_write: true, bash: true, network: true },
      restricted: {
        file_read: true,
        file_write: false,
        bash: false,
        network: false,
      },
      observer: {
        file_read: true,
        file_write: false,
        bash: false,
        network: false,
      },
    };
    return permissions[level] ?? permissions.full;
  }
}
