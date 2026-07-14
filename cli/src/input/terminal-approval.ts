/**
 * CLI 终端命令交互审批 —— 注入 tools 的 setTerminalApprover。
 *
 * normal 模式下 use_terminal 遇到 ask / 危险待确认时会 await 本模块：
 * 弹出底部审批条，用户选允许/拒绝后 Promise resolve，agent loop 才继续。
 * 未注入时（旧行为）工具立刻返回拦截文案，模型只会换姿势重试，永远停不下来。
 */

import {
  setTerminalApprover,
  setTerminalPolicyRoot,
  type TerminalApprover,
} from "@little-house-studio/tools";
import { useStore } from "../state/store.js";
import { userMaouRoot } from "../config/paths.js";
import {
  DEFAULT_AGENT_NAME,
  APPROVAL_AGENT_FALLBACK,
  resolveAgentName,
} from "../config/defaults.js";

export type TerminalApprovalChoice =
  | "once"       // 允许这一次
  | "always"     // 允许并加入白名单（按命令前缀）
  | "deny"       // 拒绝这一次
  | "blacklist"; // 拒绝并加入黑名单

export interface TerminalApprovalRequest {
  id: string;
  command: string;
  agentName: string;
  cwd?: string;
  /** 展示用提示（危险 / 普通） */
  hint?: string;
}

type Pending = {
  resolve: (v: { approve: boolean; persist?: "whitelist" | "blacklist" | "none" }) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

const pending = new Map<string, Pending>();

/** 默认等待 10 分钟；超时视为取消（与工具层 catch 文案一致） */
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

function genId(): string {
  return `ta_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 用户作出选择（UI / 快捷键调用）。
 */
export function answerTerminalApproval(
  id: string,
  choice: TerminalApprovalChoice,
): void {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (p.timer) clearTimeout(p.timer);

  const store = useStore.getState();
  if (store.terminalApproval?.id === id) {
    store.setTerminalApproval(null);
  }

  switch (choice) {
    case "once":
      p.resolve({ approve: true, persist: "none" });
      break;
    case "always":
      p.resolve({ approve: true, persist: "whitelist" });
      break;
    case "blacklist":
      p.resolve({ approve: false, persist: "blacklist" });
      break;
    case "deny":
    default:
      p.resolve({ approve: false, persist: "none" });
      break;
  }
}

/** 取消当前（及队列中全部）审批 —— abort / 退出时调用 */
export function cancelAllTerminalApprovals(reason = "cancelled"): void {
  for (const [id, p] of pending) {
    if (p.timer) clearTimeout(p.timer);
    p.reject(new Error(reason));
    pending.delete(id);
  }
  useStore.getState().setTerminalApproval(null);
}

/**
 * 创建并注册 CLI 审批器（进程内单例）。
 * App 挂载时调用一次即可。
 */
export function installCliTerminalApprover(): void {
  // 策略文件根：userMaouRoot()/agents/<agent>/terminal-policy.json
  try {
    setTerminalPolicyRoot(userMaouRoot());
  } catch { /* ignore */ }

  const approver: TerminalApprover = (command, ctx) =>
    new Promise((resolve, reject) => {
      const id = genId();
      const timer = setTimeout(() => {
        pending.delete(id);
        const s = useStore.getState();
        if (s.terminalApproval?.id === id) s.setTerminalApproval(null);
        reject(new Error("approval timeout"));
      }, APPROVAL_TIMEOUT_MS);

      pending.set(id, { resolve, reject, timer });

      useStore.getState().setTerminalApproval({
        id,
        command,
        agentName: resolveAgentName(ctx.agentName, APPROVAL_AGENT_FALLBACK),
        cwd: ctx.cwd,
      });
      useStore.getState().toastMsg("终端命令待你确认（Y 允许 / N 拒绝）", "warn");
    });

  setTerminalApprover(approver);

  // 把 UI 当前审核模式写进 policy 文件，避免只改了 store 而 tools 仍读旧 mode
  try {
    const s = useStore.getState();
    const mode = s.approvalMode;
    if (mode === "normal" || mode === "auto" || mode === "yolo") {
      void import("@little-house-studio/tools").then((m) => {
        m.setTerminalMode(resolveAgentName(s.agentName, DEFAULT_AGENT_NAME), mode);
      });
    }
  } catch { /* ignore */ }
}

/** 卸载（测试 / 退出） */
export function uninstallCliTerminalApprover(): void {
  cancelAllTerminalApprovals("uninstalled");
  setTerminalApprover(null);
}
