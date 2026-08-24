/**
 * TUI 侧 Hooks.ui。
 * confirm 打开 Yes/No overlay；无应答或 Esc = 拒绝。
 */

import type { HookUi } from "@little-house-studio/agent";
import { useStore } from "../state/store.js";

type PendingConfirm = {
  title: string;
  message: string;
  resolve: (ok: boolean) => void;
};

let pending: PendingConfirm | null = null;

export function getHookConfirm(): { title: string; message: string } | null {
  return pending ? { title: pending.title, message: pending.message } : null;
}

export function settleHookConfirm(ok: boolean): boolean {
  if (!pending) return false;
  pending.resolve(ok);
  pending = null;
  return true;
}

export function createTuiHookUi(): HookUi {
  return {
    async confirm(title, message) {
      if (pending) pending.resolve(false);
      return new Promise<boolean>((resolve) => {
        pending = { title, message, resolve };
        useStore.getState().setOverlay("confirm");
      });
    },
    notify(message, level = "info") {
      const kind = level === "error" ? "err" : level === "warning" ? "warn" : "info";
      useStore.getState().toastMsg(message, kind);
    },
  };
}
