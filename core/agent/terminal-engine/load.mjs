/**
 * 跨平台加载 terminal-engine 原生绑定。
 *
 * 兼容 hyphen / underscore 的 .node 文件名。
 * 加载失败不 throw，导出 stub；调用具体 API 时再报错（use_terminal 可降级）。
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dir = dirname(fileURLToPath(import.meta.url));

/** @type {Record<string, unknown> | null} */
let nativeBinding = null;
/** @type {string | null} */
let loadError = null;

function requirePath(relOrAbs) {
  const abs =
    relOrAbs.startsWith("/") || /^[A-Za-z]:[\\/]/.test(relOrAbs)
      ? relOrAbs
      : join(__dir, relOrAbs);
  if (!existsSync(abs)) return null;
  try {
    return require(abs);
  } catch {
    return null;
  }
}

function platformTripleCandidates() {
  const { platform, arch } = process;
  const out = [];
  if (platform === "darwin") {
    if (arch === "arm64") out.push("darwin-arm64");
    if (arch === "x64") out.push("darwin-x64");
    out.push("darwin-universal");
  } else if (platform === "win32") {
    if (arch === "x64") out.push("win32-x64-msvc", "win32-x64-gnu");
    if (arch === "arm64") out.push("win32-arm64-msvc");
    if (arch === "ia32") out.push("win32-ia32-msvc");
  } else if (platform === "linux") {
    if (arch === "x64") out.push("linux-x64-gnu", "linux-x64-musl");
    if (arch === "arm64") out.push("linux-arm64-gnu", "linux-arm64-musl");
  }
  return out;
}

function tryLoad() {
  if (process.env.NAPI_RS_NATIVE_LIBRARY_PATH) {
    const m = requirePath(process.env.NAPI_RS_NATIVE_LIBRARY_PATH);
    if (m) return m;
  }
  for (const triple of platformTripleCandidates()) {
    for (const base of ["terminal-engine", "terminal_engine"]) {
      const m = requirePath(`./${base}.${triple}.node`);
      if (m) return m;
    }
  }
  return null;
}

function rebuildHint() {
  return (
    "node scripts/ensure-terminal-engine.mjs\n" +
    "  （预编译；无需 Rust。若 Release 尚无资产，维护者先跑 GitHub Actions「Native prebuilds」）\n" +
    "  本机构建（需 Rust）: MAOU_BUILD_NATIVE=1 node scripts/ensure-terminal-engine.mjs --build\n" +
    (process.platform === "win32"
      ? "  或: powershell -ExecutionPolicy Bypass -File scripts\\build-native.ps1"
      : "  或: bash scripts/build-native.sh")
  );
}

function unavailable(name) {
  return (..._args) => {
    throw new Error(
      `[terminal-engine] 原生模块未加载，无法调用 ${name}（${process.platform}/${process.arch}）。\n` +
        `  请在 maou-sdk 根目录执行:\n  ${rebuildHint()}\n` +
        (loadError ? `  原因: ${loadError}` : ""),
    );
  };
}

try {
  nativeBinding = tryLoad();
  if (!nativeBinding) {
    loadError = `未找到 .node（试过 terminal-engine.* 与 terminal_engine.*）`;
  }
} catch (e) {
  nativeBinding = null;
  loadError = e instanceof Error ? e.message : String(e);
}

const nb = nativeBinding || {};

export const isNativeAvailable = Boolean(nativeBinding);
export const nativeLoadError = loadError;

export const initEngine =
  nb.initEngine ??
  nb.init_engine ??
  (() => {
    if (!nativeBinding) {
      console.warn(
        `[terminal-engine] 原生模块不可用（${process.platform}/${process.arch}）。` +
          `请运行: node scripts/ensure-terminal-engine.mjs`,
      );
    }
  });

export const setPersistPath = nb.setPersistPath ?? nb.set_persist_path ?? (() => {});
export const run = nb.run ?? unavailable("run");
export const runBackground = nb.runBackground ?? nb.run_background ?? unavailable("runBackground");
export const write = nb.write ?? unavailable("write");
export const stop = nb.stop ?? unavailable("stop");
export const logs = nb.logs ?? unavailable("logs");
export const statusPanel =
  nb.statusPanel ??
  nb.status_panel ??
  (() => (nativeBinding ? "" : "[terminal-engine offline]"));
export const list = nb.list ?? (() => []);
export const cleanupAgent = nb.cleanupAgent ?? nb.cleanup_agent ?? (() => {});
export const remove = nb.remove ?? unavailable("remove");
export const shutdown = nb.shutdown ?? (() => {});
export const setFilter = nb.setFilter ?? nb.set_filter ?? (() => {});
export const setSandbox = nb.setSandbox ?? nb.set_sandbox ?? (() => {});
export const loadFilterFromFile =
  nb.loadFilterFromFile ?? nb.load_filter_from_file ?? (() => {});
export const terminalCount = nb.terminalCount ?? nb.terminal_count ?? (() => 0);

function missingFeature(name) {
  return (..._args) => {
    throw new Error(
      nativeBinding
        ? `[terminal-engine] 当前 .node 不支持 ${name}。请更新预编译：node scripts/ensure-terminal-engine.mjs --force`
        : `[terminal-engine] 原生模块未加载，无法调用 ${name}。\n  ${rebuildHint()}`,
    );
  };
}

export const hasResize = typeof nb.resize === "function";
export const hasSubscribe = typeof nb.subscribe === "function";
export const hasOpenInteractive =
  typeof (nb.openInteractive ?? nb.open_interactive) === "function";
export const hasUnsubscribe =
  typeof (nb.unsubscribe ?? nb.unsubscribe_terminal) === "function";

export const resize = hasResize ? nb.resize : missingFeature("resize");

const nativeSubscribe = nb.subscribe;
const nativeUnsubscribe = nb.unsubscribe ?? nb.unsubscribe_terminal;
export const subscribe = hasSubscribe
  ? (id, onEvent) => {
      const subId = nativeSubscribe(id, (err, ev) => {
        if (typeof onEvent !== "function") return;
        if (err) {
          onEvent({ kind: "error", message: String(err.message ?? err) });
          return;
        }
        if (ev && typeof ev === "object") {
          const kind = ev.kind ?? ev.Kind;
          if (kind === "exit") {
            onEvent({
              kind: "exit",
              exitCode: ev.exitCode ?? ev.exit_code ?? null,
            });
            return;
          }
          onEvent({ kind: "data", data: ev.data ?? "" });
        }
      });
      return () => {
        if (typeof nativeUnsubscribe === "function") {
          try {
            nativeUnsubscribe(id, subId);
          } catch {
            /* ignore */
          }
        }
      };
    }
  : undefined;

export const unsubscribe = hasUnsubscribe ? nativeUnsubscribe : missingFeature("unsubscribe");
export const openInteractive = hasOpenInteractive
  ? (nb.openInteractive ?? nb.open_interactive)
  : missingFeature("openInteractive");

export default nativeBinding || {
  isNativeAvailable: false,
  initEngine,
  setPersistPath,
  run,
  runBackground,
  write,
  list,
  logs,
  stop,
  remove,
  shutdown,
  cleanupAgent,
  setFilter,
  setSandbox,
  loadFilterFromFile,
  statusPanel,
  terminalCount,
  resize,
  subscribe,
  unsubscribe,
  openInteractive,
  hasResize,
  hasSubscribe,
  hasOpenInteractive,
};
