/**
 * 烘培与增量注入系统 —— 预计算上下文注入内容，按触发策略注入到 system prompt。
 *
 * 设计文档: 烘培与增量注入系统
 *
 * 概念：
 * - "烘培"（bake）：预计算一段上下文注入内容，生成 XML 标签包裹的文本块。
 * - "注入"（inject）：在构建 system prompt 时将烘培好的内容块插入。
 * - 触发策略：
 *   - "always"：每次构建 prompt 都注入
 *   - "on_change"：内容有变更时才注入
 *   - "manual"：仅手动触发注入
 */

// ─── 类型 ──────────────────────────────────────────────────────────────────

/** 烘培触发策略 */
export type BakeTrigger = "always" | "on_change" | "manual";

/** 单个烘培条目 */
export interface BakeEntry {
  /** XML 标签名（注入时用 <name>...</name> 包裹） */
  name: string;
  /** 烘培后的内容（null 表示尚未烘培） */
  content: string | null;
  /** 触发策略 */
  trigger: BakeTrigger;
  /** 内容是否已变更（on_change 策略使用） */
  dirty: boolean;
  /** 上次注入时的内容哈希（用于 on_change 对比） */
  lastHash: string;
  /** 烘培函数（返回要注入的内容字符串） */
  baker: () => string | Promise<string>;
}

/** 烘培系统配置 */
export interface BakeSystemConfig {
  /** 是否启用烘培 */
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

// ─── BakeSystem ────────────────────────────────────────────────────────────

export class BakeSystem {
  private entries: Map<string, BakeEntry> = new Map();
  private config: BakeSystemConfig;

  constructor(config: Partial<BakeSystemConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 注册一个烘培条目。
   *
   * @param name - XML 标签名（注入时用 <name>...</name> 包裹）
   * @param baker - 烘培函数，返回要注入的内容字符串
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
   * 注销一个烘培条目。
   */
  unregister(name: string): boolean {
    return this.entries.delete(name);
  }

  /**
   * 烘培单个条目：执行 baker 函数，缓存结果。
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
      return entry.content; // 烘培失败，返回旧内容
    }
  }

  /**
   * 烘培所有条目。
   */
  async bakeAll(): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();
    for (const name of this.entries.keys()) {
      results.set(name, await this.bake(name));
    }
    return results;
  }

  /**
   * 获取当前应注入的上下文文本。
   * 根据触发策略决定哪些条目参与注入。
   *
   * @param trigger - 仅注入匹配此触发策略的条目（默认 "always"）
   */
  getInjection(trigger?: BakeTrigger): string {
    if (!this.config.enabled) return "";

    const parts: string[] = [];
    for (const entry of this.entries.values()) {
      // 如果指定了 trigger，只注入匹配的
      if (trigger && entry.trigger !== trigger) continue;
      // manual 策略不自动注入
      if (entry.trigger === "manual") continue;

      if (entry.content && entry.dirty) {
        parts.push(`<${entry.name}>\n${entry.content}\n</${entry.name}>`);
        entry.dirty = false; // 注入后标记为已消费
      }
    }

    return parts.join("\n\n");
  }

  /**
   * 获取指定条目的烘培内容（手动触发用）。
   */
  getBaked(name: string): string | null {
    const entry = this.entries.get(name);
    return entry?.content ?? null;
  }

  /**
   * 检查是否有待注入的变更内容。
   */
  hasChanges(): boolean {
    for (const entry of this.entries.values()) {
      if (entry.trigger === "manual") continue;
      if (entry.content && entry.dirty) return true;
    }
    return false;
  }

  /**
   * 标记所有条目为脏（强制下次重新注入）。
   */
  markAllDirty(): void {
    for (const entry of this.entries.values()) {
      entry.dirty = true;
    }
  }

  /**
   * 获取所有已注册的条目名称。
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