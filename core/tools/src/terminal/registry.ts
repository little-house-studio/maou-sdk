/**
 * @deprecated 已移除生产用途。
 * 终端注册表在 Rust terminal-engine 内；TS 侧请用 use_terminal / engine.list。
 * 见 `./LEGACY.md`。
 */

function removed(api: string): never {
  throw new Error(
    `[terminal/registry] ${api} 已废弃。请使用 @little-house-studio/terminal-engine。`,
  );
}

export type TerminalState = "running" | "exited" | "interrupted";

export class Terminal {
  constructor(_opts?: unknown) {
    removed("new Terminal");
  }
}

export class TerminalRegistry {
  createOrReuse(_opts?: unknown): never {
    return removed("TerminalRegistry.createOrReuse");
  }
  list(_agent?: string): never {
    return removed("TerminalRegistry.list");
  }
}

/** @deprecated 始终抛错，勿使用 */
export const TERMINAL_REGISTRY = new Proxy({} as TerminalRegistry, {
  get() {
    return removed("TERMINAL_REGISTRY");
  },
});
