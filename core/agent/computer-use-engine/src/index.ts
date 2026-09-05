/**
 * @little-house-studio/computer-use-engine
 * 公共 API：自由函数 + 纯数据。工具层只做 ToolResponse 封装。
 */

import {
  AX_HINT,
  MISSING_HELPER,
  SCREEN_HINT,
  UNSUPPORTED_PLATFORM,
  type ActKind,
  type Availability,
  type ComputerPermissions,
  type ComputerUseMode,
  type EngineResult,
  type HelperEnvelope,
  type HelperRequest,
  type ObserveKind,
  type Snapshot,
} from "./types.js";
import { pickRoute, resolveComputerUseMode } from "./policy.js";
import { findElement, parseElementRef, toLocator } from "./refs.js";
import {
  formatApps,
  formatAvailability,
  formatHelp,
  formatPermissions,
  formatSnapshot,
  formatWindows,
} from "./format.js";
import { currentPlatform, findHelperPath, isDarwin, resetHelperPathCache } from "./native.js";
import { hasHelperRunner, runHelper, setHelperRunnerForTest, type HelperRunner } from "./exec.js";
import { newSnapshotId, recallSnapshot, rememberSnapshot, resetSnapshotsForTest } from "./store.js";

export type {
  ActKind,
  Availability,
  ComputerPermissions,
  ComputerUseMode,
  ComputerUseOp,
  ComputerUseRoute,
  DesktopApp,
  DesktopWindow,
  EngineResult,
  HelperEnvelope,
  HelperRequest,
  ObserveKind,
  Snapshot,
  UiElement,
  UiFrame,
  UiLocator,
} from "./types.js";
export {
  ACT_ACTIONS,
  AX_HINT,
  EXECUTE_ONLY_ACTIONS,
  MISSING_HELPER,
  OBSERVE_ACTIONS,
  SCREEN_HINT,
  UNSUPPORTED_PLATFORM,
} from "./types.js";
export {
  parseComputerUseMode,
  pickRoute,
  readConfigComputerUseMode,
  resolveComputerUseMode,
} from "./policy.js";
export type { PickRouteInput, ResolveModeOptions, RouteDecision } from "./policy.js";
export {
  MAX_SNAPSHOT_ELEMENTS,
  assignRefs,
  findElement,
  isInteractiveRole,
  matchLocator,
  parseElementRef,
  pruneInteractive,
  toLocator,
} from "./refs.js";
export { formatApps, formatAvailability, formatHelp, formatPermissions, formatSnapshot, formatWindows } from "./format.js";
export { findHelperPath, isDarwin, resetHelperPathCache } from "./native.js";
export { setHelperRunnerForTest } from "./exec.js";
export { newSnapshotId, recallSnapshot, rememberSnapshot, resetSnapshotsForTest } from "./store.js";

export interface RunOptions {
  mode?: ComputerUseMode;
  agentMode?: string;
  configMode?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  helperPath?: string;
  runner?: HelperRunner;
  includeImage?: boolean;
}

function emptyPerms(): ComputerPermissions {
  return {
    ax: false,
    screen: false,
    input: false,
    axHint: AX_HINT,
    screenHint: SCREEN_HINT,
  };
}

function fail(message: string, payload: Record<string, unknown> = {}): EngineResult {
  return { ok: false, message, payload };
}

function ok(
  message: string,
  payload: Record<string, unknown>,
  extras?: { imageBase64?: string; images?: string[] },
): EngineResult {
  return { ok: true, message, payload, ...extras };
}

export function isAvailable(opts?: RunOptions): Availability {
  const p = currentPlatform();
  const helperPath = findHelperPath(opts?.env);
  const helper = isDarwin(p) && !!helperPath;
  return {
    platform: p,
    helper,
    ...(helperPath ? { helperPath } : {}),
    ax: false,
    screen: false,
    input: false,
  };
}

function resolveMode(opts?: RunOptions): ComputerUseMode {
  return resolveComputerUseMode({
    env: opts?.env,
    agentMode: opts?.mode ?? opts?.agentMode,
    configMode: opts?.configMode,
    configPath: opts?.configPath,
  });
}

function snapshotFromEnvelope(env: HelperEnvelope, fallbackId?: string): Snapshot {
  const snapshotId = env.snapshotId || fallbackId || newSnapshotId();
  const route = env.route === "pixels" ? "pixels" : "ax";
  return rememberSnapshot({
    route,
    snapshotId,
    app: env.app,
    pid: env.pid,
    window: env.window,
    elements: env.elements ?? [],
    imageBase64: env.imageBase64,
    permissions: env.permissions ?? emptyPerms(),
    fallbackReason: env.fallbackReason,
  });
}

async function call(req: HelperRequest, opts?: RunOptions): Promise<HelperEnvelope> {
  return runHelper(req, { helperPath: opts?.helperPath, runner: opts?.runner });
}

function gatePlatform(opts?: RunOptions): EngineResult | null {
  if (!isDarwin()) return fail(UNSUPPORTED_PLATFORM, { platform: currentPlatform() });
  if (!findHelperPath(opts?.env) && !opts?.helperPath && !opts?.runner && !hasHelperRunner()) {
    return fail(MISSING_HELPER, { helper: false });
  }
  return null;
}

export async function permissions(opts?: RunOptions): Promise<EngineResult> {
  const blocked = gatePlatform(opts);
  if (blocked) return blocked;
  const env = await call({ op: "permissions", mode: resolveMode(opts) }, opts);
  if (!env.ok) return fail(env.error || env.message || "permissions 失败", { envelope: env });
  const perms = env.permissions ?? emptyPerms();
  return ok(formatPermissions(perms), { action: "permissions", permissions: perms });
}

export async function apps(opts?: RunOptions): Promise<EngineResult> {
  const blocked = gatePlatform(opts);
  if (blocked) return blocked;
  const env = await call({ op: "apps", mode: resolveMode(opts) }, opts);
  if (!env.ok) return fail(env.error || env.message || "apps 失败", { envelope: env });
  const list = env.apps ?? [];
  return ok(formatApps(list), { action: "apps", apps: list });
}

export async function windows(
  params?: { app?: string; pid?: number },
  opts?: RunOptions,
): Promise<EngineResult> {
  const blocked = gatePlatform(opts);
  if (blocked) return blocked;
  const env = await call(
    { op: "windows", mode: resolveMode(opts), app: params?.app, pid: params?.pid },
    opts,
  );
  if (!env.ok) return fail(env.error || env.message || "windows 失败", { envelope: env });
  const list = env.windows ?? [];
  return ok(formatWindows(list), { action: "windows", windows: list });
}

export async function snapshot(
  params?: { app?: string; window?: string; pid?: number; includeImage?: boolean },
  opts?: RunOptions,
): Promise<EngineResult> {
  const blocked = gatePlatform(opts);
  if (blocked) return blocked;
  const mode = resolveMode(opts);
  const env = await call(
    {
      op: "snapshot",
      mode,
      app: params?.app,
      window: params?.window,
      pid: params?.pid,
      includeImage: params?.includeImage ?? opts?.includeImage,
    },
    opts,
  );
  if (!env.ok) return fail(env.error || env.message || "snapshot 失败", { envelope: env, mode });
  const snap = snapshotFromEnvelope(env);
  return ok(formatSnapshot(snap), {
    action: "snapshot",
    snapshot: snap,
    snapshotId: snap.snapshotId,
    route: snap.route,
    mode,
  }, snap.imageBase64 ? { imageBase64: snap.imageBase64 } : undefined);
}

export async function act(
  params: {
    kind: ActKind;
    target?: string | number;
    snapshotId?: string;
    text?: string;
    keys?: string[];
    amount?: number;
    x?: number;
    y?: number;
    app?: string;
    pid?: number;
  },
  opts?: RunOptions,
): Promise<EngineResult> {
  const blocked = gatePlatform(opts);
  if (blocked) return blocked;
  const mode = resolveMode(opts);
  const ref = parseElementRef(params.target);
  const prev = recallSnapshot(params.snapshotId);
  const el = ref != null && prev ? findElement(prev.elements, ref) : undefined;
  const locator = el ? toLocator(el) : undefined;
  if (ref == null && params.x == null && params.kind !== "hotkey" && params.kind !== "press") {
    return fail("click/type/scroll 需要 target='[N]' 或 x/y 坐标。先 snapshot。", {
      action: params.kind,
    });
  }
  const env = await call(
    {
      op: "act",
      mode,
      kind: params.kind,
      ref: ref ?? undefined,
      locator,
      snapshotId: params.snapshotId ?? prev?.snapshotId,
      text: params.text,
      keys: params.keys,
      amount: params.amount,
      x: params.x,
      y: params.y,
      app: params.app ?? prev?.app,
      pid: params.pid ?? prev?.pid,
    },
    opts,
  );
  if (!env.ok) return fail(env.error || env.message || `${params.kind} 失败`, { envelope: env, mode });
  const snap = env.elements?.length ? snapshotFromEnvelope(env) : undefined;
  const message = [
    env.message || `${params.kind} 完成（route=${env.route ?? mode}）`,
    snap ? formatSnapshot(snap) : "",
  ]
    .filter(Boolean)
    .join("\n");
  return ok(
    message,
    {
      action: params.kind,
      route: env.route,
      mode,
      snapshot: snap,
      snapshotId: snap?.snapshotId ?? params.snapshotId ?? prev?.snapshotId,
    },
    snap?.imageBase64 ? { imageBase64: snap.imageBase64 } : undefined,
  );
}

export async function activateApp(
  params?: { app?: string; pid?: number },
  opts?: RunOptions,
): Promise<EngineResult> {
  const blocked = gatePlatform(opts);
  if (blocked) return blocked;
  const env = await call(
    { op: "activate", mode: resolveMode(opts), app: params?.app, pid: params?.pid },
    opts,
  );
  if (!env.ok) return fail(env.error || env.message || "activate 失败", { envelope: env });
  return ok(env.message || `activated ${env.app ?? params?.app ?? ""}`, {
    action: "activate",
    pid: env.pid,
    app: env.app,
  });
}

export async function observe(
  params: { kind: ObserveKind; durationMs?: number; app?: string; window?: string; pid?: number; path?: string },
  opts?: RunOptions,
): Promise<EngineResult> {
  const blocked = gatePlatform(opts);
  if (blocked) return blocked;
  const mode = resolveMode(opts);
  const env = await call(
    {
      op: "observe",
      mode,
      kind: params.kind,
      durationMs: params.durationMs,
      app: params.app,
      window: params.window,
      pid: params.pid,
      path: params.path,
      includeImage: true,
    },
    opts,
  );
  if (!env.ok) return fail(env.error || env.message || `${params.kind} 失败`, { envelope: env, mode });
  const images = env.frames?.length ? env.frames : env.imageBase64 ? [env.imageBase64] : undefined;
  return ok(env.message || `${params.kind} 完成（route=${env.route ?? "pixels"}）`, {
    action: params.kind,
    route: env.route ?? "pixels",
    mode,
    path: params.path,
    frames: env.frames?.length ?? (env.imageBase64 ? 1 : 0),
  }, {
    imageBase64: env.imageBase64,
    images,
  });
}

export async function run(
  action: string,
  params: Record<string, unknown> = {},
  opts?: RunOptions,
): Promise<EngineResult> {
  const actName = action.trim();
  if (actName === "help") return ok(formatHelp(), { action: "help" });
  if (actName === "available" || actName === "status") {
    const a = isAvailable(opts);
    return ok(formatAvailability(a), { action: "available", availability: a });
  }

  const blocked = gatePlatform(opts);
  if (blocked && actName !== "help") return blocked;

  if (actName === "permissions") return permissions(opts);
  if (actName === "apps") return apps(opts);
  if (actName === "windows") {
    return windows({ app: str(params.app), pid: num(params.pid) }, opts);
  }
  if (actName === "snapshot" || actName === "state") {
    return snapshot(
      {
        app: str(params.app),
        window: str(params.window),
        pid: num(params.pid),
        includeImage: bool(params.include_image ?? params.includeImage),
      },
      opts,
    );
  }
  if (actName === "screenshot") {
    return observe(
      { kind: "screenshot", app: str(params.app), window: str(params.window), pid: num(params.pid), path: str(params.path) },
      opts,
    );
  }
  if (actName === "record") {
    return observe(
      {
        kind: "record",
        durationMs: num(params.duration_ms ?? params.durationMs) ?? 2000,
        app: str(params.app),
        window: str(params.window),
        pid: num(params.pid),
        path: str(params.path),
      },
      opts,
    );
  }
  if (actName === "activate" || actName === "launch") {
    return activateApp({ app: str(params.app), pid: num(params.pid) }, opts);
  }
  if (
    actName === "click"
    || actName === "type"
    || actName === "press"
    || actName === "scroll"
    || actName === "hotkey"
    || actName === "set-value"
    || actName === "set_value"
  ) {
    const keys = Array.isArray(params.keys)
      ? (params.keys as unknown[]).map((k) => String(k))
      : str(params.keys)?.split(/[+\s,]+/).filter(Boolean);
    return act(
      {
        kind: (actName === "set_value" ? "set-value" : actName) as ActKind,
        target: (params.target ?? params.ref) as string | number | undefined,
        snapshotId: str(params.snapshot ?? params.snapshotId),
        text: str(params.text),
        keys,
        amount: num(params.amount),
        x: num(params.x),
        y: num(params.y),
        app: str(params.app),
        pid: num(params.pid),
      },
      opts,
    );
  }
  return fail(
    `未知操作: ${actName}。action=help 查看用法。`,
    { unknown_action: actName },
  );
}

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return undefined;
}

export { resetHelperPathCache as _resetHelperPathCache };
