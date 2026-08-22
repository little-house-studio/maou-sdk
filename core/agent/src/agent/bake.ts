/**
 * 文件缓存区条目注册 —— 预计算稳定前缀块，按策略注入。
 *
 * 旧称「烘培 / BakeSystem」。术语见 core/context/DESIGN.md：
 *   文件缓存区（稳定前缀）→ 缓存断点 → 上下文动态区
 *   改写文件缓存区 = 缓存破坏（随后重新 cache write）
 *   时机 = 缓存重建点（hook `cache_rebuild_point`）
 *
 * 触发策略：
 *   - "always"：每次构建 prompt 都注入
 *   - "on_change"：内容有变更时才注入（变更即缓存破坏）
 *   - "manual"：仅手动触发注入
 */

// ─── 类型 ──────────────────────────────────────────────────────────────────

/** 写入文件缓存区的触发策略 */
export type BakeTrigger = "always" | "on_change" | "manual";

/** 单个文件缓存区条目 */
export interface BakeEntry {
  /** XML 标签名（注入时用 <name>...</name> 包裹） */
  name: string;
  /** 已写入文件缓存区的内容（null 表示尚未计算） */
  content: string | null;
  /** 触发策略 */
  trigger: BakeTrigger;
  /** 内容是否已变更（on_change；true 表示待注入 / 视同缓存破坏后待 write） */
  dirty: boolean;
  /** 上次注入时的内容哈希（用于 on_change 对比） */
  lastHash: string;
  /** 计算要写入文件缓存区的函数 */
  baker: () => string | Promise<string>;
}

/** 文件缓存区注册表配置 */
export interface BakeSystemConfig {
  /** 是否启用 */
  enabled: boolean;
}

// ─── 默认配置 ──────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: BakeSystemConfig = {
  enabled: true,
};

// ─── 工具函数 ──────────────────────────────────────────────────────────────

function simpleHash(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    hash = ((hash << 5) - hash + ch) | 0;
  }
  return hash.toString(36);
}

// ─── BakeSystem（文件缓存区注册表）─────────────────────────────────────────

export class BakeSystem {
  private entries: Map<string, BakeEntry> = new Map();
  private config: BakeSystemConfig;

  constructor(config: Partial<BakeSystemConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 注册一个文件缓存区条目。
   *
   * @param name - XML 标签名
   * @param baker - 返回要写入文件缓存区的字符串
   * @param trigger - 触发策略，默认 "always"
   */
  register(
    name: string,
    baker: () => string | Promise<string>,
    trigger: BakeTrigger = "always",
  ): void {
    this.entries.set(name, {
      name,
      content: null,
      trigger,
      dirty: true,
      lastHash: "",
      baker,
    });
  }

  /**
   * 注销一个文件缓存区条目。
   */
  unregister(name: string): boolean {
    return this.entries.delete(name);
  }

  /**
   * 计算单个条目并写入缓存（on_change 且哈希未变则不视为缓存破坏）。
   */
  async bake(name: string): Promise<string | null> {
    const entry = this.entries.get(name);
    if (!entry) return null;

    try {
      const content = await entry.baker();
      const newHash = content ? simpleHash(content) : "";

      if (entry.trigger === "on_change" && newHash === entry.lastHash) {
        entry.dirty = false;
      } else {
        entry.content = content;
        entry.lastHash = newHash;
        entry.dirty = true;
      }

      return content;
    } catch {
      return entry.content; // 失败则沿用旧内容
    }
  }

  /**
   * 计算所有条目。
   */
  async bakeAll(): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();
    for (const name of this.entries.keys()) {
      results.set(name, await this.bake(name));
    }
    return results;
  }

  /**
   * 取出当前应注入文件缓存区的文本。
   *
   * @param trigger - 仅注入匹配此触发策略的条目（默认 "always"）
   */
  getInjection(trigger?: BakeTrigger): string {
    if (!this.config.enabled) return "";

    const parts: string[] = [];
    for (const entry of this.entries.values()) {
      if (trigger && entry.trigger !== trigger) continue;
      if (entry.trigger === "manual") continue;

      if (entry.content && entry.dirty) {
        parts.push(`<${entry.name}>\n${entry.content}\n</${entry.name}>`);
        entry.dirty = false;
      }
    }

    return parts.join("\n\n");
  }

  /**
   * 获取指定条目已计算的内容（手动触发用）。
   */
  getBaked(name: string): string | null {
    const entry = this.entries.get(name);
    return entry?.content ?? null;
  }

  /**
   * 是否有待注入的变更。
   */
  hasChanges(): boolean {
    for (const entry of this.entries.values()) {
      if (entry.trigger === "manual") continue;
      if (entry.content && entry.dirty) return true;
    }
    return false;
  }

  /**
   * 标记全部 dirty（下次强制重新注入 = 缓存破坏）。
   */
  markAllDirty(): void {
    for (const entry of this.entries.values()) {
      entry.dirty = true;
    }
  }

  /**
   * 已注册条目名称。
   */
  listEntries(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * 清空所有条目。
   */
  clear(): void {
    this.entries.clear();
  }
}
