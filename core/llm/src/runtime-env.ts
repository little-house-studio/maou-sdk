/**
 * 跨运行时环境变量读取
 *
 * 统一处理三种运行时差异：
 *   - Node：正常读 process.env
 *   - Bun 编译二进制：已知 bug 下 process.env 可能为空，优先读 Bun.env
 *   - 浏览器 / 边缘运行时：没有 process，安全返回 undefined（不抛错）
 */

/** 读取单个环境变量（Bun.env 优先于 process.env；缺失返回 undefined） */
export function readEnv(name: string): string | undefined {
  const g = globalThis as Record<string, unknown>;

  // Bun：编译二进制时 process.env 可能为空，Bun.env 始终可靠
  const bun = g.Bun as { env?: Record<string, string | undefined> } | undefined;
  if (bun?.env) {
    const v = bun.env[name];
    if (v != null && String(v).length > 0) return String(v);
  }

  if (typeof process !== "undefined" && process.env) {
    const v = process.env[name];
    if (v != null) return v;
  }

  return undefined;
}

/** 当前运行时是否能访问环境变量（浏览器返回 false） */
export function hasEnvAccess(): boolean {
  const g = globalThis as Record<string, unknown>;
  const bun = g.Bun as { env?: unknown } | undefined;
  return !!bun?.env || (typeof process !== "undefined" && !!process.env);
}

/** 是否运行在浏览器/无 process 的环境 */
export function isBrowserLike(): boolean {
  return typeof process === "undefined" || !process.versions?.node;
}
