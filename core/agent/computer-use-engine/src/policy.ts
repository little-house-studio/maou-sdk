import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ComputerUseMode, ComputerUseRoute } from "./types.js";

export interface ResolveModeOptions {
  env?: NodeJS.ProcessEnv;
  agentMode?: string;
  configMode?: string;
  configPath?: string;
}

export interface PickRouteInput {
  mode: ComputerUseMode;
  axTrusted: boolean;
  axUsable: boolean;
  screenAllowed: boolean;
}

export type RouteDecision =
  | { route: ComputerUseRoute; reason?: string }
  | { route: null; error: string };

export function parseComputerUseMode(value: unknown): ComputerUseMode | undefined {
  if (typeof value !== "string") return undefined;
  const s = value.trim().toLowerCase();
  if (s === "auto" || s === "ax" || s === "pixels") return s;
  return undefined;
}

function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const llm = env.MAOU_LLM_CONFIG?.trim();
  if (llm) return resolve(llm);
  const home = env.MAOU_HOME?.trim() || join(homedir(), ".maou");
  return join(home, "config.json");
}

export function readConfigComputerUseMode(
  configPath?: string,
  env: NodeJS.ProcessEnv = process.env,
): ComputerUseMode | undefined {
  const p = configPath ?? defaultConfigPath(env);
  if (!existsSync(p)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(p, "utf8")) as {
      computerUse?: { mode?: unknown };
    };
    return parseComputerUseMode(raw.computerUse?.mode);
  } catch {
    return undefined;
  }
}

/** MAOU_COMPUTER_USE → agent.json computerUse.mode → config.json computerUse.mode → auto */
export function resolveComputerUseMode(opts?: ResolveModeOptions): ComputerUseMode {
  const env = opts?.env ?? process.env;
  const fromEnv = parseComputerUseMode(env.MAOU_COMPUTER_USE);
  if (fromEnv) return fromEnv;
  const fromAgent = parseComputerUseMode(opts?.agentMode);
  if (fromAgent) return fromAgent;
  if (opts?.configMode) {
    const pinned = parseComputerUseMode(opts.configMode);
    if (pinned) return pinned;
  }
  return readConfigComputerUseMode(opts?.configPath, env) ?? "auto";
}

export function pickRoute(input: PickRouteInput): RouteDecision {
  const { mode, axTrusted, axUsable, screenAllowed } = input;
  if (mode === "ax") {
    if (!axTrusted) {
      return { route: null, error: "ax 模式需要辅助功能权限，且不允许降级到像素。" };
    }
    if (!axUsable) {
      return { route: null, error: "ax 模式未读到可交互控件，且不允许降级到像素。" };
    }
    return { route: "ax" };
  }
  if (mode === "pixels") {
    if (!screenAllowed) {
      return { route: null, error: "pixels 模式需要屏幕录制权限。" };
    }
    return { route: "pixels" };
  }
  if (axTrusted && axUsable) return { route: "ax" };
  if (screenAllowed) {
    const reason = !axTrusted
      ? "辅助功能未授权，降级到截图/坐标。"
      : "控件树为空或不可用，降级到截图/坐标。";
    return { route: "pixels", reason };
  }
  if (!axTrusted && !screenAllowed) {
    return {
      route: null,
      error: "辅助功能与屏幕录制都未授权，无法观察桌面。",
    };
  }
  return { route: null, error: "auto 模式无法使用控件树，且没有屏幕录制权限可降级。" };
}
