/**
 * 角色卡导入/导出
 *
 * 支持 SillyTavern V2 格式（JSON）的导入导出。
 */

import type { CharacterCard } from "./types.js";

// ─── 导出 ──────────────────────────────────────────────────────────────────

/**
 * 导出角色卡为 SillyTavern V2 JSON 格式
 */
export function exportCard(card: CharacterCard): string {
  const exported: CharacterCard = {
    ...card,
    spec: "chara_card_v2",
    spec_version: "2.0",
  };
  return JSON.stringify(exported, null, 2);
}

/**
 * 导出多个角色卡为 JSON 数组
 */
export function exportCards(cards: CharacterCard[]): string {
  return JSON.stringify(cards.map((c) => ({ ...c, spec: "chara_card_v2", spec_version: "2.0" })), null, 2);
}

// ─── 导入 ──────────────────────────────────────────────────────────────────

/**
 * 从 JSON 字符串导入角色卡
 *
 * 支持格式：
 * - SillyTavern V2（spec: chara_card_v2）
 * - 简化格式（只有基础字段）
 */
export function importCard(json: string): CharacterCard {
  const data = JSON.parse(json) as Partial<CharacterCard>;
  return normalizeCard(data);
}

/**
 * 从 JSON 数组导入多个角色卡
 */
export function importCards(json: string): CharacterCard[] {
  const data = JSON.parse(json) as Partial<CharacterCard>[];
  return data.map(normalizeCard);
}

/**
 * 归一化角色卡（补全缺失字段）
 */
function normalizeCard(data: Partial<CharacterCard>): CharacterCard {
  if (!data.name) {
    throw new Error("角色卡缺少 name 字段");
  }

  return {
    name: data.name,
    description: data.description ?? "",
    personality: data.personality ?? "",
    scenario: data.scenario ?? "",
    first_mes: data.first_mes ?? "",
    alternate_greetings: data.alternate_greetings ?? [],
    mes_example: data.mes_example ?? "",
    creator_notes: data.creator_notes ?? "",
    system_prompt: data.system_prompt ?? "",
    post_history_instructions: data.post_history_instructions ?? "",
    tags: data.tags ?? [],
    appearance: data.appearance,
    background: data.background,
    relationships: data.relationships,
    speech_style: data.speech_style,
    current_mood: data.current_mood,
    spec: data.spec ?? "chara_card_v2",
    spec_version: data.spec_version ?? "2.0",
    creator: data.creator ?? "",
    character_book: data.character_book,
    extensions: data.extensions ?? {},
  };
}
