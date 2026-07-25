/**
 * CLI 终端命令交互审批 —— 注入 tools 的 setTerminalApprover。
 *
 * normal：弹出底部审批条，等人点允许/拒绝。
 * auto：绝不弹人手卡；转交小模型审核器（helper），全自动。
 * yolo：直接放行（致命级仍由 tools 门禁硬拦，不会进到本 approver）。
 *
 * 未注入时（旧行为）工具立刻返回拦截文案，模型只会换姿势重试，永远停不下来。
 */

import {
  setTerminalApprover,
  setTerminalPolicyRoot,
  getTerminalReviewer,
  getTerminalMode,
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
  /** @deprecated 用 summary */
  hint?: string;
  risk?: "low" | "high";
  summary?: string;
  label?: string;
  ruleId?: string;
  reason?: string;
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
  try {
    void import("../state/agent-presence.js").then((m) => {
      const st = useStore.getState();
      m.markAgentBlocked(
        m.agentPresenceKey(st.agentName, st.agentProjectRoot),
        false,
      );
    });
  } catch { /* ignore */ }

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
 *
 * 重要：不要用 store 默认 normal 去覆写磁盘 terminal-policy。
 * 用户上次选的 yolo 写在 terminal-policy.json；若 boot 时 store 仍是
 * 默认 normal 却 setTerminalMode(normal)，会把 YOLO 冲掉，下一轮又弹审批。
 */
/**
 * 解析当前应生效的审核模式。
 * 优先 UI store（用户 Shift+Tab 刚切的），再回落磁盘 policy。
 * 这样即便 tool 侧 sandboxMode 丢了/过期，auto 也不会误弹人手卡。
 */
function resolveEffectiveApprovalMode(agentName?: string): "normal" | "auto" | "yolo" {
  const storeMode = useStore.getState().approvalMode;
  if (storeMode === "auto" || storeMode === "yolo" || storeMode === "normal") {
    return storeMode;
  }
  try {
    const agent = resolveAgentName(agentName, DEFAULT_AGENT_NAME);
    const disk = getTerminalMode(agent);
    if (disk === "auto" || disk === "yolo" || disk === "normal") return disk;
  } catch {
    /* ignore */
  }
  return "normal";
}

export function installCliTerminalApprover(): void {
  // 策略文件根：userMaouRoot()/agents/<agent>/terminal-policy.json
  try {
    setTerminalPolicyRoot(userMaouRoot());
  } catch { /* ignore */ }

  const approver: TerminalApprover = async (command, ctx) => {
    const mode = resolveEffectiveApprovalMode(ctx.agentName);

    // ── auto：AI 审核，绝不弹人手卡 ──────────────────────────────
    if (mode === "auto") {
      const reviewer = getTerminalReviewer();
      if (!reviewer) {
        useStore.getState().toastMsg(
          "auto 模式：未配置审核模型，已拒绝命令（不弹审批卡）",
          "warn",
        );
        return { approve: false, persist: "none" };
      }
      try {
        useStore.getState().toastMsg("auto 审核中…", "info");
        const verdict = await reviewer(command, {
          agentName: resolveAgentName(ctx.agentName, APPROVAL_AGENT_FALLBACK),
          cwd: ctx.cwd,
        });
        useStore.getState().toastMsg(
          verdict.approve
            ? `auto 已放行：${(verdict.reason || "").slice(0, 40)}`
            : `auto 已拒绝：${(verdict.reason || "").slice(0, 40)}`,
          verdict.approve ? "ok" : "warn",
        );
        return {
          approve: verdict.approve,
          // AI 放行：按命令类写白名单，减少同类重复审核；拒绝不写黑名单
          // （黑名单由 tools recordReviewReject 负责）
          persist: verdict.approve ? "whitelist" : "none",
        };
      } catch (err) {
        useStore.getState().toastMsg(
          `auto 审核异常：${String(err).slice(0, 40)}`,
          "err",
        );
        return { approve: false, persist: "none" };
      }
    }

    // ── yolo：不问（致命级不会进到 approver）────────────────────
    if (mode === "yolo") {
      return { approve: true, persist: "none" };
    }

    // ── normal：人手审批卡 ──────────────────────────────────────
    return new Promise((resolve, reject) => {
      const id = genId();
      const timer = setTimeout(() => {
        pending.delete(id);
        const s = useStore.getState();
        if (s.terminalApproval?.id === id) s.setTerminalApproval(null);
        reject(new Error("approval timeout"));
      }, APPROVAL_TIMEOUT_MS);

      pending.set(id, { resolve, reject, timer });

      const risk = ctx.risk === "high" ? "high" : "low";
      const summary =
        ctx.summary ||
        (risk === "high"
          ? "高风险命令：请确认你理解影响后再授权。"
          : "终端命令待确认。");
      const label = ctx.label || (risk === "high" ? "高风险" : "需确认");

      useStore.getState().setTerminalApproval({
        id,
        command,
        agentName: resolveAgentName(ctx.agentName, APPROVAL_AGENT_FALLBACK),
        cwd: ctx.cwd,
        risk,
        summary,
        label,
        ruleId: ctx.ruleId,
        reason: ctx.reason,
        // 兼容旧 UI 字段
        hint: summary,
      });
      try {
        // 动态 import 会返回 Promise；此处用同步副作用包装避免把 approver 改成 async 链路
        void import("../state/agent-presence.js").then((m) => {
          const st = useStore.getState();
          m.markAgentBlocked(
            m.agentPresenceKey(st.agentName, st.agentProjectRoot),
            true,
          );
        });
      } catch { /* ignore */ }
      useStore
        .getState()
        .toastMsg(
          risk === "high"
            ? "高风险终端命令待确认（红条 · Y/N）"
            : "终端命令待你确认（黄条 · Y 允许 / N 拒绝）",
          risk === "high" ? "err" : "warn",
        );
    });
  };

  setTerminalApprover(approver);

  // 磁盘 → UI：恢复用户上次审核模式（yolo/auto/normal）
  // 注意：agentName 在 boot 后应已写入；若仍空则回落 DEFAULT。
  try {
    const agent = resolveAgentName(
      useStore.getState().agentName,
      DEFAULT_AGENT_NAME,
    );
    const diskMode = getTerminalMode(agent) as
      | "normal"
      | "auto"
      | "yolo"
      | undefined;
    if (diskMode === "normal" || diskMode === "auto" || diskMode === "yolo") {
      // 只改 UI，不再写回磁盘（避免把 yolo 冲成 normal 再写回）
      useStore.setState({ approvalMode: diskMode });
    }
  } catch {
    /* ignore */
  }
}

/** 卸载（测试 / 退出） */
export function uninstallCliTerminalApprover(): void {
  cancelAllTerminalApprovals("uninstalled");
  setTerminalApprover(null);
}
