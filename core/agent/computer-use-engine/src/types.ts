/** 控件树优先 / 像素降级 / 自动选择。 */
export type ComputerUseMode = "auto" | "ax" | "pixels";

/** 实际走的观察/动作通道。 */
export type ComputerUseRoute = "ax" | "pixels";

export type ComputerUseOp =
  | "ping"
  | "permissions"
  | "apps"
  | "windows"
  | "snapshot"
  | "act"
  | "observe"
  | "activate";

export type ActKind = "click" | "type" | "press" | "scroll" | "hotkey" | "set-value";

export type ObserveKind = "screenshot" | "record";

export interface UiFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 扁平可交互节点。ref 是当前 snapshot 内的 [N]。 */
export interface UiElement {
  ref: number;
  role: string;
  title?: string;
  value?: string;
  description?: string;
  enabled: boolean;
  focused?: boolean;
  frame?: UiFrame;
  actions?: string[];
}

/** 用来在下一次 helper 进程里重新定位节点（helper 是一次性进程）。 */
export interface UiLocator {
  ref: number;
  role: string;
  title?: string;
  value?: string;
  description?: string;
  frame?: UiFrame;
}

export interface ComputerPermissions {
  ax: boolean;
  screen: boolean;
  input: boolean;
  axHint?: string;
  screenHint?: string;
}

export interface Availability {
  platform: string;
  helper: boolean;
  helperPath?: string;
  ax: boolean;
  screen: boolean;
  input: boolean;
}

export interface DesktopApp {
  name: string;
  bundleId?: string;
  pid: number;
  frontmost?: boolean;
}

export interface DesktopWindow {
  title: string;
  app?: string;
  pid?: number;
  windowId?: number;
  frame?: UiFrame;
}

export interface Snapshot {
  route: ComputerUseRoute;
  snapshotId: string;
  app?: string;
  pid?: number;
  window?: string;
  elements: UiElement[];
  imageBase64?: string;
  permissions: ComputerPermissions;
  fallbackReason?: string;
}

export interface EngineResult {
  ok: boolean;
  message: string;
  payload: Record<string, unknown>;
  imageBase64?: string;
  images?: string[];
}

export interface HelperRequest {
  op: ComputerUseOp;
  mode?: ComputerUseMode;
  app?: string;
  window?: string;
  pid?: number;
  includeImage?: boolean;
  snapshotId?: string;
  ref?: number;
  locator?: UiLocator;
  x?: number;
  y?: number;
  kind?: ActKind | ObserveKind;
  text?: string;
  keys?: string[];
  amount?: number;
  durationMs?: number;
  path?: string;
}

export interface HelperEnvelope {
  ok: boolean;
  op?: string;
  route?: ComputerUseRoute;
  snapshotId?: string;
  message?: string;
  error?: string;
  fallbackReason?: string;
  permissions?: ComputerPermissions;
  apps?: DesktopApp[];
  windows?: DesktopWindow[];
  elements?: UiElement[];
  imageBase64?: string;
  frames?: string[];
  pid?: number;
  app?: string;
  window?: string;
}

export const UNSUPPORTED_PLATFORM =
  "computer-use 目前只支持 macOS。Win/Linux 预留（下一站 UIA / AT-SPI），本期没有实现。";

export const MISSING_HELPER =
  "computer-use helper 不可用。源码树在 macOS 上执行 `pnpm --filter @little-house-studio/computer-use-engine build:helper`；预编译包应自带 vendor/bin/computer-use-helper。";

export const AX_HINT =
  "打开 系统设置 → 隐私与安全性 → 辅助功能，勾选当前进程（maou / maou-app / computer-use-helper 的父进程）。";

export const SCREEN_HINT =
  "打开 系统设置 → 隐私与安全性 → 屏幕录制，勾选当前进程后重试。";

export const ACT_ACTIONS = [
  "click",
  "type",
  "press",
  "scroll",
  "hotkey",
  "set-value",
] as const;

export const OBSERVE_ACTIONS = [
  "snapshot",
  "screenshot",
  "apps",
  "windows",
  "permissions",
  "help",
] as const;

export const EXECUTE_ONLY_ACTIONS = [...ACT_ACTIONS, "record", "activate"] as const;
