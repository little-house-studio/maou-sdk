/**
 * CliCommandRegistry —— 指令动态注册表。
 *
 * - register / unregister / list / get / resolve
 * - 自动识别 name + aliases
 * - 补全 / 面板 / 本地白名单 同源
 */

import type {
  CliCommandSpec,
  CommandScope,
  PaletteItem,
  ResolvedCliCommand,
  SlashItem,
} from "./types.js";

function normalizeName(name: string): string {
  return name.trim().replace(/^\//, "").toLowerCase();
}

/** 拆分：空白 + 模型 value 的 \\0 */
export function splitSlashTokens(raw: string): string[] {
  return raw
    .trim()
    .split(/[\s\u0000]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export class CliCommandRegistry {
  /** id → spec */
  private byId = new Map<string, CliCommandSpec>();
  /** name|alias → id */
  private nameIndex = new Map<string, string>();

  /** 注册或覆盖（同 id 先卸旧 name/alias 索引） */
  register(spec: CliCommandSpec): void {
    const id = spec.id;
    const prev = this.byId.get(id);
    if (prev) this.dropIndex(prev);

    const next: CliCommandSpec = {
      ...spec,
      source: spec.source ?? "builtin",
    };
    this.byId.set(id, next);

    const names = [next.name, ...(next.aliases ?? [])];
    for (const n of names) {
      const key = normalizeName(n);
      if (!key) continue;
      // 别名冲突：后注册覆盖索引，指向新 id
      this.nameIndex.set(key, id);
    }
  }

  /** 批量注册 */
  registerAll(specs: readonly CliCommandSpec[]): void {
    for (const s of specs) this.register(s);
  }

  unregister(id: string): boolean {
    const prev = this.byId.get(id);
    if (!prev) return false;
    this.dropIndex(prev);
    this.byId.delete(id);
    return true;
  }

  /** 按 source 清空（动态 runtime/skill 刷新用） */
  unregisterBySource(source: CliCommandSpec["source"]): number {
    let n = 0;
    for (const [id, spec] of [...this.byId]) {
      if (spec.source === source) {
        this.unregister(id);
        n++;
      }
    }
    return n;
  }

  get(idOrName: string): CliCommandSpec | undefined {
    const key = normalizeName(idOrName);
    if (this.byId.has(key)) return this.byId.get(key);
    const id = this.nameIndex.get(key);
    return id ? this.byId.get(id) : undefined;
  }

  has(idOrName: string): boolean {
    return this.get(idOrName) != null;
  }

  list(filter?: { scope?: CommandScope | CommandScope[]; source?: string }): CliCommandSpec[] {
    let all = [...this.byId.values()];
    if (filter?.scope) {
      const set = new Set(
        Array.isArray(filter.scope) ? filter.scope : [filter.scope],
      );
      all = all.filter((s) => set.has(s.scope));
    }
    if (filter?.source) {
      all = all.filter((s) => s.source === filter.source);
    }
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** local | both → 本地可处理 */
  isLocal(idOrName: string): boolean {
    const s = this.get(idOrName);
    return !!s && (s.scope === "local" || s.scope === "both");
  }

  /** 已登记（含 runtime/skill），用于「未知指令」判断 */
  isKnown(idOrName: string): boolean {
    const s = this.get(idOrName);
    return !!s && !s.hidden;
  }

  /**
   * 解析用户输入。
   * - 非 / 开头 → null
   * - / 开头但未登记 → null（调用方 toast 未知）
   */
  resolve(input: string): ResolvedCliCommand | null {
    const rawInput = input.trim();
    if (!rawInput.startsWith("/")) return null;

    const tokens = splitSlashTokens(rawInput.slice(1));
    if (tokens.length === 0) return null;

    const matched = normalizeName(tokens[0]!);
    const spec = this.get(matched);
    if (!spec) return null;

    const argTokens = tokens.slice(1);
    const args = argTokens.join(" ");
    return {
      spec,
      matched,
      args,
      tokens: argTokens,
      rawInput,
    };
  }

  /** / 补全条目（动态，勿模块加载时缓存） */
  slashItems(opts?: { scopes?: CommandScope[] }): SlashItem[] {
    const scopes = opts?.scopes;
    return this.list()
      .filter((s) => !s.hidden)
      .filter((s) => !scopes || scopes.includes(s.scope))
      .flatMap((s) => {
        const names = [s.name, ...(s.aliases ?? [])];
        return names.map((n) => ({
          value: `/${normalizeName(n)}`,
          label: `/${normalizeName(n)}`,
          description: s.usage
            ? `${s.description} · ${s.usage}`
            : s.description,
        }));
      });
  }

  /** Ctrl+K 面板 */
  paletteItems(): PaletteItem[] {
    return this.list()
      .filter((s) => s.palette && !s.hidden)
      .map((s) => ({
        value: s.id,
        label: s.label,
        description: s.hotkey
          ? `${s.description} · ${s.hotkey}`
          : s.description,
      }));
  }

  private dropIndex(spec: CliCommandSpec): void {
    const names = [spec.name, ...(spec.aliases ?? [])];
    for (const n of names) {
      const key = normalizeName(n);
      if (this.nameIndex.get(key) === spec.id) {
        this.nameIndex.delete(key);
      }
    }
  }
}

/** 进程级单例 —— CLI 启动即用；runtime/skill 可后续 register */
export const cliCommands = new CliCommandRegistry();
