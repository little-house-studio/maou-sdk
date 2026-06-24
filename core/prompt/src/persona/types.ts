/**
 * 角色卡类型定义
 *
 * 兼容 SillyTavern V2 字段 + 扩展字段。
 * 角色卡是"角色扮演型 persona"的结构化数据，区别于 AgentRegistry 的"工具型 agent 元数据"。
 */

// ─── 基础角色卡 ─────────────────────────────────────────────────────────────

/**
 * 角色关系
 */
export interface Relationship {
  /** 目标角色名 */
  target: string;
  /** 关系类型 */
  type: RelationshipType;
  /** 好感度：-100 ~ 100 */
  affection: number;
  /** 关系描述（可选） */
  description?: string;
}

export type RelationshipType =
  | "friend"
  | "rival"
  | "lover"
  | "family"
  | "mentor"
  | "student"
  | "enemy"
  | "neutral";

/**
 * 角色卡（兼容 SillyTavern V2 + 扩展）
 */
export interface CharacterCard {
  // ── 基础字段（SillyTavern V2 兼容）──
  /** 角色名 */
  name: string;
  /** 人设描述（外貌、身份、背景等） */
  description: string;
  /** 性格特征 */
  personality: string;
  /** 场景设定（当前所处环境、情境） */
  scenario: string;
  /** 第一条消息（开场白） */
  first_mes: string;
  /** 备选问候（可切换的开场白） */
  alternate_greetings: string[];
  /** 对话示例（few-shot 引导） */
  mes_example: string;
  /** 创作者备注 */
  creator_notes: string;
  /** 附加 system prompt（可选） */
  system_prompt: string;
  /** 历史后指令（注入到历史消息之后，可选） */
  post_history_instructions: string;
  /** 标签 */
  tags: string[];

  // ── 扩展字段 ──
  /** 外貌描述（可选，独立于 description） */
  appearance?: string;
  /** 背景故事（可选，独立于 description） */
  background?: string;
  /** 关系网（可选） */
  relationships?: Relationship[];
  /** 说话风格（可选） */
  speech_style?: string;
  /** 当前情绪状态（可选，可动态更新） */
  current_mood?: string;

  // ── 元数据 ──
  /** 卡片规范版本 */
  spec: string;
  /** 卡片版本 */
  spec_version: string;
  /** 创建者 */
  creator: string;
  /** 字符集（语言） */
  character_book?: CharacterBook;
  /** 扩展字段（任意自定义数据） */
  extensions: Record<string, unknown>;
}

/**
 * 角色词典/世界书（SillyTavern 兼容）
 */
export interface CharacterBook {
  /** 词条是否全局启用 */
  global?: boolean;
  /** 词条列表 */
  entries: CharacterBookEntry[];
}

export interface CharacterBookEntry {
  /** 词条主键 */
  keys: string[];
  /** 词条内容 */
  content: string;
  /** 是否启用 */
  enabled: boolean;
  /** 插入顺序 */
  order: number;
  /** 插入位置 */
  position: "before_char" | "after_char";
}

// ─── 角色卡统计信息 ─────────────────────────────────────────────────────────

/**
 * 角色卡统计（用于列表展示）
 */
export interface PersonaStats {
  /** 角色名 */
  name: string;
  /** 显示名 */
  display_name: string;
  /** 简短描述 */
  description: string;
  /** 标签 */
  tags: string[];
  /** 创建时间 */
  created_at: string;
  /** 更新时间 */
  updated_at: string;
  /** 来源（global/project） */
  source: "global" | "project";
}

// ─── 创建/更新选项 ─────────────────────────────────────────────────────────

/**
 * 创建角色卡选项
 */
export interface CreatePersonaOptions {
  /** 显示名（默认同 name） */
  display_name?: string;
  /** 人设描述 */
  description?: string;
  /** 性格 */
  personality?: string;
  /** 场景 */
  scenario?: string;
  /** 第一条消息 */
  first_mes?: string;
  /** 说话风格 */
  speech_style?: string;
  /** 外貌 */
  appearance?: string;
  /** 背景 */
  background?: string;
  /** 标签 */
  tags?: string[];
  /** 创建者 */
  creator?: string;
}
