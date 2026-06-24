/**
 * 角色卡注册表
 *
 * 持久化到 ~/.maou/personas/<name>/card.json（全局）
 * 项目级覆盖：<projectRoot>/.maou/personas/<name>/card.json
 *
 * 优先级：项目级 > 全局
 *
 * 与 AgentRegistry 的区别：
 * - AgentRegistry：工具型 agent 元数据（name/role/team/tools/round_limit）
 * - PersonaRegistry：角色扮演型角色卡（人设/性格/外貌/背景/关系/对话示例）
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
import { join, dirname } from "node:path";
import type {
  CharacterCard,
  PersonaStats,
  CreatePersonaOptions,
} from "./types.js";

// ─── 常量 ──────────────────────────────────────────────────────────────────

const CARD_FILE = "card.json";

// ─── 工具函数 ──────────────────────────────────────────────────────────────

function nowTs(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmp = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  renameSync(tmp, filePath);
}

function defaultCard(name: string, options: CreatePersonaOptions = {}): CharacterCard {
  const now = nowTs();
  return {
    name,
    description: options.description ?? "",
    personality: options.personality ?? "",
    scenario: options.scenario ?? "",
    first_mes: options.first_mes ?? "",
    alternate_greetings: [],
    mes_example: "",
    creator_notes: "",
    system_prompt: "",
    post_history_instructions: "",
    tags: options.tags ?? [],
    appearance: options.appearance,
    background: options.background,
    speech_style: options.speech_style,
    extensions: {
      display_name: options.display_name ?? name,
      created_at: now,
      updated_at: now,
      creator: options.creator ?? "",
    },
    spec: "chara_card_v2",
    spec_version: "2.0",
    creator: options.creator ?? "",
  };
}

// ─── PersonaRegistry ───────────────────────────────────────────────────────

export class PersonaRegistry {
  readonly personasDir: string;
  /** 项目级角色卡目录（可选，优先级高于全局） */
  readonly projectPersonasDir?: string;

  constructor(maouRoot: string, projectRoot?: string) {
    this.personasDir = join(maouRoot, "personas");
    if (projectRoot) {
      this.projectPersonasDir = join(projectRoot, ".maou", "personas");
    }
  }

  private cardPath(name: string, useProject?: boolean): string {
    if (useProject && this.projectPersonasDir) {
      return join(this.projectPersonasDir, name, CARD_FILE);
    }
    return join(this.personasDir, name, CARD_FILE);
  }

  private personaDir(name: string, useProject?: boolean): string {
    if (useProject && this.projectPersonasDir) {
      return join(this.projectPersonasDir, name);
    }
    return join(this.personasDir, name);
  }

  /**
   * 加载所有角色卡（合并全局 + 项目级）
   * 项目级覆盖全局同名角色卡
   */
  private loadAll(): Record<string, CharacterCard & { _source: "global" | "project" }> {
    const result: Record<string, CharacterCard & { _source: "global" | "project" }> = {};

    // 1. 加载全局角色卡
    if (existsSync(this.personasDir)) {
      const entries = readdirSync(this.personasDir).sort();
      for (const entry of entries) {
        const dir = join(this.personasDir, entry);
        try {
          if (!statSync(dir).isDirectory()) continue;
        } catch {
          continue;
        }
        const cardFile = join(dir, CARD_FILE);
        if (!existsSync(cardFile)) continue;
        try {
          const data = JSON.parse(readFileSync(cardFile, "utf-8"));
          if (data && typeof data === "object" && "name" in data) {
            result[data.name] = { ...data, _source: "global" };
          }
        } catch {
          continue;
        }
      }
    }

    // 2. 加载项目级角色卡（覆盖全局同名）
    if (this.projectPersonasDir && existsSync(this.projectPersonasDir)) {
      const entries = readdirSync(this.projectPersonasDir).sort();
      for (const entry of entries) {
        const dir = join(this.projectPersonasDir, entry);
        try {
          if (!statSync(dir).isDirectory()) continue;
        } catch {
          continue;
        }
        const cardFile = join(dir, CARD_FILE);
        if (!existsSync(cardFile)) continue;
        try {
          const data = JSON.parse(readFileSync(cardFile, "utf-8"));
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
   * 列出所有角色卡（统计信息）
   */
  list(): PersonaStats[] {
    const all = this.loadAll();
    return Object.values(all).map((card) => ({
      name: card.name,
      display_name: (card.extensions?.display_name as string) ?? card.name,
      description: card.description,
      tags: card.tags ?? [],
      created_at: (card.extensions?.created_at as string) ?? "",
      updated_at: (card.extensions?.updated_at as string) ?? "",
      source: card._source,
    }));
  }

  /**
   * 获取单个角色卡（优先项目级）
   */
  get(name: string): CharacterCard | null {
    // 优先项目级
    if (this.projectPersonasDir) {
      const projectPath = join(this.projectPersonasDir, name, CARD_FILE);
      if (existsSync(projectPath)) {
        try {
          return JSON.parse(readFileSync(projectPath, "utf-8"));
        } catch {
          // 继续尝试全局
        }
      }
    }

    // 回退全局
    const globalPath = join(this.personasDir, name, CARD_FILE);
    if (!existsSync(globalPath)) return null;
    try {
      return JSON.parse(readFileSync(globalPath, "utf-8"));
    } catch {
      return null;
    }
  }

  /**
   * 检查角色卡是否存在
   */
  exists(name: string): boolean {
    if (this.projectPersonasDir && existsSync(join(this.projectPersonasDir, name, CARD_FILE))) {
      return true;
    }
    return existsSync(join(this.personasDir, name, CARD_FILE));
  }

  /**
   * 创建新角色卡
   */
  create(name: string, options: CreatePersonaOptions = {}): CharacterCard {
    if (this.exists(name)) {
      throw new Error(`Persona '${name}' 已存在`);
    }
    const card = defaultCard(name, options);
    atomicWriteJson(join(this.personasDir, name, CARD_FILE), card);
    return card;
  }

  /**
   * 更新角色卡字段
   */
  update(name: string, fields: Partial<CharacterCard>): CharacterCard | null {
    // 优先更新项目级，否则更新全局
    let path: string;
    if (this.projectPersonasDir && existsSync(join(this.projectPersonasDir, name, CARD_FILE))) {
      path = join(this.projectPersonasDir, name, CARD_FILE);
    } else {
      path = join(this.personasDir, name, CARD_FILE);
    }
    if (!existsSync(path)) return null;
    try {
      const data = JSON.parse(readFileSync(path, "utf-8")) as CharacterCard;
      const merged = { ...data, ...fields };
      // 更新 extensions.updated_at
      merged.extensions = {
        ...merged.extensions,
        updated_at: nowTs(),
      };
      atomicWriteJson(path, merged);
      return merged;
    } catch {
      return null;
    }
  }

  /**
   * 删除角色卡（整个目录）
   */
  delete(name: string): boolean {
    const dir = this.personaDir(name);
    if (!existsSync(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  }

  /**
   * 保存完整角色卡（覆盖写入）
   */
  save(name: string, card: CharacterCard): void {
    const path = join(this.personasDir, name, CARD_FILE);
    const data = {
      ...card,
      extensions: {
        ...card.extensions,
        updated_at: nowTs(),
      },
    };
    atomicWriteJson(path, data);
  }
}
