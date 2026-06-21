/**
 * 记忆提取器 —— 从会话消息中提取结构化记忆。
 * 规则化提取，不调用 LLM。
 */

import type { SessionMessage } from "./session-store.js";
import type { ExtractedMemory } from "./types.js";

export interface ExtractionRule {
  category: string;
  patterns: RegExp[];
  keyTemplate: string;
  valueTemplate: string;
  tagsTemplate: string[];
}

/** 默认提取规则 */
export const DEFAULT_RULES: ExtractionRule[] = [
  // 用户偏好：我喜欢/偏好/习惯/总是...
  {
    category: "user_preference",
    patterns: [
      /我(喜欢|偏好|习惯|总是|prefer|like|always|want)\s*(.+)/gi,
      /(我|I)\s*(prefer|like|want|always)\s*(.+)/gi,
    ],
    keyTemplate: "user_preference_{2}",
    valueTemplate: "用户偏好 {2}",
    tagsTemplate: ["preference"],
  },
  // 项目事实：这个项目用/是基于...
  {
    category: "project_fact",
    patterns: [
      /(这个|本)项目(用|是|基于|uses|is|based on)\s*(.+)/gi,
      /project\s*(uses|is|based on)\s*(.+)/gi,
    ],
    keyTemplate: "project_fact_{3}",
    valueTemplate: "项目 {3}",
    tagsTemplate: ["project", "fact"],
  },
  // 错误模式：经常/总是报...错误
  {
    category: "error_pattern",
    patterns: [
      /经常|frequently|often\s*(.+?)\s*(错误|error|bug)/gi,
      /(总是|always)\s*(.+?)\s*(失败|fail)/gi,
    ],
    keyTemplate: "error_pattern_{1}",
    valueTemplate: "频繁问题: {1}",
    tagsTemplate: ["error"],
  },
  // 重要约定：记住/记住这个/别忘了...
  {
    category: "important_note",
    patterns: [
      /(记住|记得|别忘了|note that|remember)\s*(.+)/gi,
    ],
    keyTemplate: "note_{2}",
    valueTemplate: "重要: {2}",
    tagsTemplate: ["note", "important"],
  },
];

/**
 * 从会话消息中提取记忆
 */
export function extractMemories(
  messages: SessionMessage[],
  rules?: ExtractionRule[],
): ExtractedMemory[] {
  const effectiveRules = rules ?? DEFAULT_RULES;
  const extracted: ExtractedMemory[] = [];
  const seen = new Set<string>();

  for (const msg of messages) {
    // 只从 user 消息提取
    if (msg.role !== "user") continue;

    const content = msg.content ?? "";
    for (const rule of effectiveRules) {
      for (const pattern of rule.patterns) {
        let match: RegExpExecArray | null;
        pattern.lastIndex = 0;  // 重置
        while ((match = pattern.exec(content)) !== null) {
          // 用捕获组替换模板
          let key = rule.keyTemplate;
          let value = rule.valueTemplate;
          const tags = [...rule.tagsTemplate];

          for (let i = 0; i < match.length; i++) {
            const placeholder = `{${i}}`;
            const groupValue = (match[i] ?? "").trim().slice(0, 50);
            key = key.replace(placeholder, groupValue.replace(/\s+/g, "_"));
            value = value.replace(placeholder, groupValue);
          }

          // 去重
          if (seen.has(key)) continue;
          seen.add(key);

          // 清理 key：只保留字母数字下划线
          key = key.replace(/[^a-zA-Z0-9_一-龥]/g, "_").slice(0, 64);

          if (key && value) {
            extracted.push({
              key,
              value: value.slice(0, 200),
              category: rule.category,
              tags,
            });
          }
        }
      }
    }
  }

  return extracted;
}
