/**
 * useKeybindings —— 命名空间按键路由（global/input/overlay）。
 * 阶段 4 基础版：overlay 开时路由到 overlay 命名空间。
 * 阶段 6 加 JSON 按键表 + 热重载。
 *
 * 当前 app.tsx 的 useCleanInput 已处理全局键，这里提供命名空间判定 helper。
 */

import { useStore } from "../state/store.js";

export type KeyNamespace = "global" | "input" | "overlay";

/** 当前活跃的按键命名空间（overlay 开时为 overlay，否则 global） */
export function useActiveNamespace(): KeyNamespace {
  const overlay = useStore((s) => s.overlay);
  const fullEditor = useStore((s) => s.fullEditorInitial);
  if (fullEditor !== null) return "global"; // 全屏编辑器自己处理
  if (overlay) return "overlay";
  return "global";
}
