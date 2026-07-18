/**
 * @deprecated 已移除生产用途。
 * use_terminal 只走 Rust `@little-house-studio/terminal-engine`（默认全平台管道）。
 * 见 `./LEGACY.md`。
 */

function removed(api: string): never {
  throw new Error(
    `[terminal/pty] ${api} 已废弃。请使用 @little-house-studio/terminal-engine（use_terminal）。` +
      ` 可选真 PTY：MAOU_PTY_FORCE=1`,
  );
}

export type IPtyLike = never;

export function buildSafeEnv(_extra?: Record<string, string>): never {
  return removed("buildSafeEnv");
}

export function spawnPty(
  _command: string,
  _args: string[],
  _opts: unknown,
): never {
  return removed("spawnPty");
}
