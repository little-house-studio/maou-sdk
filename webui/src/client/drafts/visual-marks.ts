/**
 * Pure domain → visual-mark mappers for the draft shell.
 * Shape + color keys (never color alone). Used by SVG mark components + tests.
 */

import type { AgentPresenceStatus } from "./agent-tree";
import type { FileIconKind } from "./file-tree";
import { fileIconKind } from "./file-tree";
import type { MessageRole } from "./types";

/** Shared mark vocabulary for scanning type/state without reading full labels. */
export type StatusMarkKind =
  | "idle"
  | "running"
  | "done_unread"
  | "done_read"
  | "blocked"
  | "needs_reply"
  | "queued"
  | "done"
  | "error";

export type RoleMarkKind =
  | "user"
  | "assistant"
  | "system"
  | "tool"
  | "err"
  | "thinking";

export type HierarchyMarkKind = "system_root" | "system_child" | "project_root" | "project_child";

export type ChromeMarkKind =
  | "brand"
  | "mode_chat"
  | "mode_project"
  | "mode_team"
  | "new"
  | "stop"
  | "refresh"
  | "settings"
  | "files"
  | "scenario"
  | "usage"
  | "send"
  | "retry"
  | "copy"
  | "terminal"
  | "agent_info"
  | "diff"
  | "tasks"
  | "session"
  | "folder_group";

export type TaskMarkKind = "running" | "done" | "queued";

export type VisualTone =
  | "neutral"
  | "accent"
  | "ok"
  | "warn"
  | "err"
  | "info"
  | "muted";

export function statusMarkKind(
  status: AgentPresenceStatus | TaskMarkKind | "error",
): StatusMarkKind {
  if (status === "queued") return "queued";
  if (status === "done") return "done";
  if (status === "error") return "error";
  return status;
}

export function statusTone(kind: StatusMarkKind): VisualTone {
  switch (kind) {
    case "running":
      return "accent";
    case "done":
    case "done_read":
    case "done_unread":
      return "ok";
    case "blocked":
    case "queued":
      return "warn";
    case "needs_reply":
    case "error":
      return "err";
    default:
      return "muted";
  }
}

/** Pair shape id with tone — icons use different paths per kind. */
export function statusShape(
  kind: StatusMarkKind,
): "circle" | "ring" | "pulse" | "check" | "diamond" | "slash" {
  switch (kind) {
    case "running":
      return "pulse";
    case "done":
    case "done_read":
      return "check";
    case "done_unread":
      return "ring";
    case "blocked":
      return "diamond";
    case "needs_reply":
    case "error":
      return "slash";
    case "queued":
      return "circle";
    default:
      return "circle";
  }
}

export function roleMarkKind(role: MessageRole): RoleMarkKind {
  return role;
}

export function roleTone(kind: RoleMarkKind): VisualTone {
  switch (kind) {
    case "user":
      return "info";
    case "assistant":
      return "accent";
    case "tool":
      return "accent";
    case "err":
      return "err";
    case "thinking":
      return "warn";
    default:
      return "muted";
  }
}

export function roleLabelZh(kind: RoleMarkKind, tag?: string): string {
  if (tag) return tag;
  switch (kind) {
    case "user":
      return "你";
    case "assistant":
      return "助手";
    case "tool":
      return "工具";
    case "err":
      return "错误";
    case "thinking":
      return "思考";
    default:
      return "系统";
  }
}

export function hierarchyMarkKind(opts: {
  group: "system" | "project";
  isChild: boolean;
}): HierarchyMarkKind {
  if (opts.group === "system") {
    return opts.isChild ? "system_child" : "system_root";
  }
  return opts.isChild ? "project_child" : "project_root";
}

export function hierarchyTone(kind: HierarchyMarkKind): VisualTone {
  switch (kind) {
    case "system_root":
      return "accent";
    case "system_child":
      return "info";
    case "project_root":
      return "warn";
    case "project_child":
      return "muted";
  }
}

export function taskMarkKind(
  status: "running" | "done" | "queued",
): TaskMarkKind {
  return status;
}

export function fileMarkKind(
  name: string,
  isFolder: boolean,
  open?: boolean,
): FileIconKind {
  return fileIconKind(name, isFolder, open);
}

export function fileTone(kind: FileIconKind): VisualTone {
  switch (kind) {
    case "folder":
    case "folder-open":
      return "warn";
    case "ts":
    case "tsx":
      return "info";
    case "js":
    case "jsx":
    case "json":
      return "warn";
    case "md":
      return "info";
    case "html":
      return "err";
    case "css":
      return "accent";
    case "git":
      return "err";
    case "lock":
    case "config":
      return "muted";
    case "img":
      return "accent";
    default:
      return "muted";
  }
}

/** Indent px for hierarchy depth (visual ladder, not only color). */
export function hierarchyIndentPx(depth: number, step = 12, base = 6): number {
  return base + Math.max(0, depth) * step;
}

export function chromeMarkForMode(mode: "chat" | "project" | "team"): ChromeMarkKind {
  if (mode === "project") return "mode_project";
  if (mode === "team") return "mode_team";
  return "mode_chat";
}
