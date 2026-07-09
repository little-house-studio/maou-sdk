/**
 * useExitGuard —— 退出安全网。
 *
 * Ink 退出只做显光标 + 关 raw mode，不写备用屏/鼠标退出序列（它从不开这些）。
 * 旧版只在 waitUntilExit().then() 恢复，crash/SIGKILL/未捕获异常下终端卡死
 * 在备用屏 + 隐光标 + 鼠标开。本 hook 在 render 前注册 process.on 兜底，
 * 任何退出路径都恢复终端状态。
 *
 * 注册一次（模块级），返回 unregister（测试用）。render 前调用。
 */

const RESTORE = "\x1b[?25h\x1b[?1049l\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l";

let installed = false;
const handlers: Array<() => void> = [];

function restore(): void {
  for (const h of handlers) {
    try { h(); } catch { /* 兜底里不能再抛 */ }
  }
  process.stdout.write(RESTORE);
}

export function installExitGuard(): () => void {
  if (installed) return () => {};
  installed = true;

  const onExit = () => restore();
  const onSignal = (sig: NodeJS.Signals) => {
    restore();
    // 直接强退，不等 Ink 的 waitUntilExit resolve——LLM fetch / 定时器可能让它永不 resolve（假退出）。
    // restore 已写终端恢复序列，安全。
    process.exit(sig === "SIGINT" ? 130 : 143);
  };

  process.on("exit", onExit);
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  process.on("SIGHUP", onSignal);
  process.on("uncaughtException", (err) => {
    restore();
    process.stderr.write(`\n[maou] uncaught: ${err?.stack ?? err}\n`);
    process.exit(1);
  });

  return () => {
    process.off("exit", onExit);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    process.off("SIGHUP", onSignal);
    installed = false;
  };
}

/** React hook 形式（app 里用，确保组件挂载时已注册）。 */
export function useExitGuard(): void {
  // 模块级 installExitGuard 已在 index.tsx render 前调用，这里仅占位保证
  // 未来若改在组件内注册时有 hook 锚点。当前 no-op。
  // （Ink 无 useEffect 在 unmount 时可靠跑——crash 路径靠 process.on）
}
