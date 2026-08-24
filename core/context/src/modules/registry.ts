/**
 * 上下文模块注册表。内置行可被同 id 覆盖。
 */

import { legacyContextModule } from "./legacy.js";
import { stagedContextModule } from "./staged.js";
import type { ContextModule } from "./types.js";

export class ContextModuleRegistry {
  private readonly modules = new Map<string, ContextModule>();

  constructor() {
    this.installBuiltins();
  }

  register(mod: ContextModule): void {
    if (!mod.id.trim()) throw new Error("上下文模块 id 不能为空");
    this.modules.set(mod.id, mod);
  }

  unregister(id: string): boolean {
    return this.modules.delete(id);
  }

  get(id: string): ContextModule | undefined {
    return this.modules.get(id);
  }

  resolve(id: string): ContextModule {
    const mod = this.modules.get(id);
    if (!mod) throw new Error(`未知上下文模块: ${id}`);
    return mod;
  }

  list(): string[] {
    return [...this.modules.keys()];
  }

  reset(): void {
    this.modules.clear();
    this.installBuiltins();
  }

  private installBuiltins(): void {
    this.modules.set(legacyContextModule.id, legacyContextModule);
    this.modules.set(stagedContextModule.id, stagedContextModule);
  }
}

export const contextModules = new ContextModuleRegistry();

export function registerContextModule(mod: ContextModule): void {
  contextModules.register(mod);
}

export function resolveContextModule(id: string): ContextModule {
  return contextModules.resolve(id);
}

export function resetContextModulesForTest(): void {
  contextModules.reset();
}
