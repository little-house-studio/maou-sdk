/**
 * 按键命名空间路由（global / input / overlay）。
 */

import { useStore } from "../state/store.js";

export type KeyNamespace = "global" | "input" | "overlay";

/** 当前活跃的按键命名空间 */
export function getActiveNamespace(): KeyNamespace {
  const s = useStore.getState();
  if (s.fullEditorInitial !== null) return "global";
  if (s.overlay) return "overlay";
  return "global";
}

/** @deprecated 用 getActiveNamespace */
export function useActiveNamespace(): KeyNamespace {
  return getActiveNamespace();
}
