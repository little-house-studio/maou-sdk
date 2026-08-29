/**
 * 权限套餐：隔离 + 审批成对钉在会话上。
 */

import type { CageIsolation } from "./os-cage.js";
import type { TerminalMode } from "./approval/terminal-policy.js";

export type PermissionPresetId = "workspace+ask" | "workspace+auto" | "open+yolo";

export type PermissionPreset = {
  id: PermissionPresetId;
  /** 短名，跟 /approval 的 ask / auto / yolo 对齐 */
  name: "ask" | "auto" | "yolo";
  isolation: CageIsolation;
  approval: TerminalMode;
  /** 注释，跟指令窗口的 label 一列 */
  label: string;
  hint: string;
  /** 选用时要二次确认 */
  confirmRisk?: string;
};

export const DEFAULT_PERMISSION_PRESET: PermissionPresetId = "workspace+ask";

export const PERMISSION_PRESETS: Record<PermissionPresetId, PermissionPreset> = {
  "workspace+ask": {
    id: "workspace+ask",
    name: "ask",
    isolation: "workspace",
    approval: "normal",
    label: "询问",
    hint: "终端写在工作区；非白名单命令询问。",
  },
  "workspace+auto": {
    id: "workspace+auto",
    name: "auto",
    isolation: "workspace",
    approval: "auto",
    label: "审核",
    hint: "终端写在工作区；非白名单先由辅助模型审核。",
  },
  "open+yolo": {
    id: "open+yolo",
    name: "yolo",
    isolation: "open",
    approval: "yolo",
    label: "放开",
    hint: "不收紧写范围，也不再问终端审批。致命 DCG 仍硬拦。",
    confirmRisk: "我已了解风险",
  },
};

export function isPermissionPresetId(value: string | undefined | null): value is PermissionPresetId {
  return value === "workspace+ask" || value === "workspace+auto" || value === "open+yolo";
}

export function resolvePermissionPreset(id?: string | null): PermissionPreset {
  if (id && isPermissionPresetId(id)) return PERMISSION_PRESETS[id];
  return PERMISSION_PRESETS[DEFAULT_PERMISSION_PRESET];
}

export function presetFromApproval(mode: string | undefined): PermissionPreset {
  const raw = String(mode ?? "").trim().toLowerCase();
  if (raw === "yolo") return PERMISSION_PRESETS["open+yolo"];
  if (raw === "auto") return PERMISSION_PRESETS["workspace+auto"];
  return PERMISSION_PRESETS["workspace+ask"];
}

export function listPermissionPresets(): PermissionPreset[] {
  return Object.values(PERMISSION_PRESETS);
}
