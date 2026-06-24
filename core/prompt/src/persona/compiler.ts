/**
 * 角色卡编译器 —— 把 CharacterCard 编译成 system prompt 片段
 *
 * 与 PromptCompiler 协作：
 * - 角色卡字段（人设/性格/外貌等）→ 结构化 prompt 片段
 * - 角色卡可引用模板文件（通过 PromptCompiler 编译）
 */

import type { CharacterCard, Relationship } from "./types.js";

// ─── 编译选项 ──────────────────────────────────────────────────────────────

export interface CompilePersonaOptions {
  /** 是否包含第一条消息（默认 false，由调用方单独处理） */
  includeFirstMessage?: boolean;
  /** 是否包含对话示例（默认 false） */
  includeMesExample?: boolean;
  /** 是否包含角色词典（默认 true） */
  includeCharacterBook?: boolean;
  /** 是否包含关系网（默认 true） */
  includeRelationships?: boolean;
  /** 自定义段落顺序（可选） */
  sectionOrder?: PersonaSection[];
}

export type PersonaSection =
  | "identity"
  | "appearance"
  | "personality"
  | "background"
  | "scenario"
  | "relationships"
  | "speech_style"
  | "mes_example"
  | "character_book"
  | "system_prompt"
  | "post_history_instructions";

// ─── 默认段落顺序 ──────────────────────────────────────────────────────────

const DEFAULT_SECTION_ORDER: PersonaSection[] = [
  "identity",
  "appearance",
  "personality",
  "background",
  "scenario",
  "relationships",
  "speech_style",
  "mes_example",
  "character_book",
  "system_prompt",
];

// ─── 编译器 ────────────────────────────────────────────────────────────────

/**
 * 把 CharacterCard 编译成 system prompt 片段
 *
 * @param card 角色卡
 * @param options 编译选项
 * @returns system prompt 片段字符串
 */
export function compilePersona(
  card: CharacterCard,
  options: CompilePersonaOptions = {},
): string {
  const {
    includeFirstMessage = false,
    includeMesExample = false,
    includeCharacterBook = true,
    includeRelationships = true,
    sectionOrder = DEFAULT_SECTION_ORDER,
  } = options;

  const sections: string[] = [];

  for (const section of sectionOrder) {
    const content = compileSection(card, section, {
      includeMesExample,
      includeCharacterBook,
      includeRelationships,
    });
    if (content) sections.push(content);
  }

  let result = sections.join("\n\n");

  // 第一条消息（可选）
  if (includeFirstMessage && card.first_mes) {
    result += `\n\n<first_message>\n${card.first_mes}\n</first_message>`;
  }

  return result;
}

/**
 * 编译单个段落
 */
function compileSection(
  card: CharacterCard,
  section: PersonaSection,
  options: {
    includeMesExample: boolean;
    includeCharacterBook: boolean;
    includeRelationships: boolean;
  },
): string {
  switch (section) {
    case "identity": {
      const parts: string[] = [`# 角色身份`];
      parts.push(`- 姓名：${card.name}`);
      if (card.creator) parts.push(`- 创建者：${card.creator}`);
      return parts.join("\n");
    }

    case "appearance": {
      if (!card.appearance) return "";
      return `# 外貌\n${card.appearance}`;
    }

    case "personality": {
      if (!card.personality) return "";
      return `# 性格\n${card.personality}`;
    }

    case "background": {
      if (!card.background) return "";
      return `# 背景\n${card.background}`;
    }

    case "scenario": {
      if (!card.scenario) return "";
      return `# 当前场景\n${card.scenario}`;
    }

    case "relationships": {
      if (!options.includeRelationships || !card.relationships?.length) return "";
      const lines = card.relationships.map(formatRelationship);
      return `# 关系网\n${lines.join("\n")}`;
    }

    case "speech_style": {
      if (!card.speech_style) return "";
      return `# 说话风格\n${card.speech_style}`;
    }

    case "mes_example": {
      if (!options.includeMesExample || !card.mes_example) return "";
      return `# 对话示例\n${card.mes_example}`;
    }

    case "character_book": {
      if (!options.includeCharacterBook || !card.character_book?.entries?.length) return "";
      const entries = card.character_book.entries
        .filter((e) => e.enabled)
        .map((e) => `- [${e.keys.join(", ")}] ${e.content}`)
        .join("\n");
      return entries ? `# 角色词典\n${entries}` : "";
    }

    case "system_prompt": {
      if (!card.system_prompt) return "";
      return card.system_prompt;
    }

    case "post_history_instructions": {
      if (!card.post_history_instructions) return "";
      return `# 历史后指令\n${card.post_history_instructions}`;
    }

    default:
      return "";
  }
}

/**
 * 格式化关系条目
 */
function formatRelationship(rel: Relationship): string {
  const typeMap: Record<string, string> = {
    friend: "朋友",
    rival: "对手",
    lover: "恋人",
    family: "家人",
    mentor: "导师",
    student: "学生",
    enemy: "敌人",
    neutral: "中立",
  };
  const typeText = typeMap[rel.type] ?? rel.type;
  const affectionText = rel.affection > 50 ? "（亲密）" : rel.affection < -50 ? "（敌视）" : "";
  const desc = rel.description ? `：${rel.description}` : "";
  return `- ${rel.target}（${typeText}，好感度 ${rel.affection}${affectionText}）${desc}`;
}

/**
 * 编译多个角色卡（群聊场景）
 *
 * @param cards 角色卡列表
 * @param options 编译选项
 * @returns 群聊 system prompt 片段
 */
export function compilePersonas(
  cards: CharacterCard[],
  options: CompilePersonaOptions = {},
): string {
  if (cards.length === 0) return "";
  if (cards.length === 1) return compilePersona(cards[0], options);

  // 群聊：每个角色独立段落 + 关系网交叉引用
  const sections: string[] = ["# 群聊角色"];

  for (const card of cards) {
    sections.push(compilePersona(card, {
      ...options,
      includeRelationships: true, // 群聊必须包含关系网
    }));
  }

  return sections.join("\n\n");
}
