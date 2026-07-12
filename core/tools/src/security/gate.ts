/**
 * 终端三层安全策略机
 *
 * ┌────────────┬──────────────────────────────────────────────────────────┐
 * │ 致命 fatal │ 完全硬拦。不可 yolo、不可「再执行一次」放行、不可白名单。 │
 * │            │ 来源：DCG critical / 灾难性 high 规则 / maou-hard-deny。  │
 * ├────────────┼──────────────────────────────────────────────────────────┤
 * │ 危险 dang. │ 需确认。normal→用户审批或「相同命令再执行一次」；         │
 * │            │ auto→审核 Agent，拒绝后仍可用二次执行确认；               │
 * │            │ yolo→仍要求二次执行确认（不静默放行危险指令）。           │
 * │            │ 来源：DCG high/medium deny（且未进安全白名单）。           │
 * ├────────────┼──────────────────────────────────────────────────────────┤
 * │ 安全 safe  │ 无顾虑放行（仍可走用户白名单/普通 ask 管未知命令）。       │
 * │            │ 来源：DCG allow / maou 安全白名单 / 未匹配。              │
 * └────────────┴──────────────────────────────────────────────────────────┘
 *
 * 对齐 DCG 官方：
 *   - severity: critical/high/medium/low
 *   - policy mode: deny/warn/log（我们把 warn/log 当 safe 侧放行）
 *   - 默认 core 匹配多为 deny；我们再映射到 fatal/dangerous
 */

import { evaluateWithDcg, formatDcgDenyMessage, type DcgEvalResult } from "./dcg/client.js";
import { checkMaouHardDeny } from "./hard-deny.js";
import { checkLocalSecurityRules } from "./local-rules.js";
import {
  decideCommand,
  normalizeCommand,
  markCommandForRepeatConfirm,
  consumeRepeatConfirm,
  isCommandRepeatConfirm,
  type TerminalMode,
} from "./approval/terminal-policy.js";
import type {
  SecurityAssessment,
  SecurityGateAction,
  SecurityGateResult,
  SecurityTier,
} from "./types.js";

export type {
  SecurityAssessment,
  SecurityGateAction,
  SecurityGateResult,
  SecurityTier,
} from "./types.js";

/**
 * 致命规则：不可二次确认绕过。
 * 注意：DCG 会把 clean-force 等也标 critical，那些应归 dangerous（可二次确认），
 * 故不能「凡 critical 一律 fatal」。
 */
const FATAL_RULE_IDS = new Set([
  "core.git:reset-hard",
  "core.filesystem:rm-rf-root",
  "core.filesystem:rm-rf-root-home",
  "core.filesystem:rm-rf-star",
]);

const FATAL_RULE_PREFIXES = ["system.disk:", "windows.system:", "windows.filesystem:format"];

function normSeverity(s?: string): string {
  return (s || "").toLowerCase().trim();
}

/**
 * 将 DCG deny 映射为 fatal 或 dangerous。
 * - fatal：真正不可恢复 / 系统级（reset --hard、删根、磁盘）
 * - dangerous：其余 deny（含 DCG 标 critical 的 clean-force 等）→ 可二次确认
 */
export function mapDcgDenyToTier(dcg: DcgEvalResult): "fatal" | "dangerous" {
  const rule = dcg.ruleId || "";
  const blob = `${rule} ${dcg.reason || ""} ${dcg.explanation || ""}`;

  if (FATAL_RULE_IDS.has(rule)) return "fatal";
  if (FATAL_RULE_PREFIXES.some((p) => rule.startsWith(p))) return "fatal";
  if (/rm-rf-root|reset-hard|mkfs|wipefs|\bdd\b.*\/dev\/|vssadmin|format-volume/i.test(blob)) {
    return "fatal";
  }
  return "dangerous";
}

/**
 * 评估命令风险分层（不做审批副作用，除读取 repeat 状态外）。
 */
export async function assessCommandSecurity(
  command: string,
  opts?: { skipDcg?: boolean; dcgOverride?: DcgEvalResult },
): Promise<SecurityAssessment> {
  if (process.env.MAOU_DCG_BYPASS === "1" || process.env.DCG_BYPASS === "1") {
    return {
      tier: "safe",
      reason: "DCG_BYPASS/MAOU_DCG_BYPASS=1",
      source: "bypass",
    };
  }

  const hard = checkMaouHardDeny(command);
  if (hard) {
    return {
      tier: "fatal",
      severity: "critical",
      ruleId: hard.id,
      reason: hard.reason,
      source: "maou-hard",
    };
  }

  const dcg =
    opts?.dcgOverride ??
    (opts?.skipDcg
      ? { decision: "allow" as const, command }
      : await evaluateWithDcg(command, { required: true, timeoutMs: 400 }));

  if (dcg.maouSafeAllow) {
    return {
      tier: "safe",
      severity: dcg.severity,
      ruleId: dcg.maouSafeAllow.id,
      reason: dcg.reason || dcg.maouSafeAllow.reason,
      source: "maou-safe",
      dcg,
    };
  }

  if (dcg.decision === "deny") {
    let tier = mapDcgDenyToTier(dcg);
    // 本地规则可能把某些场景抬到 fatal
    const local = checkLocalSecurityRules(command);
    if (local?.tier === "fatal") {
      return {
        tier: "fatal",
        severity: "critical",
        ruleId: local.id,
        reason: local.reason,
        source: "local-rules",
        dcg,
      };
    }
    return {
      tier,
      severity: dcg.severity || (tier === "fatal" ? "critical" : "high"),
      ruleId: dcg.ruleId,
      packId: dcg.packId,
      reason: dcg.reason || "dcg denied",
      source: "dcg",
      dcg,
    };
  }

  // DCG allow：仍检查本地规则（补默认未开的 docker/db/云 等）
  const local = checkLocalSecurityRules(command);
  if (local) {
    return {
      tier: local.tier,
      severity: local.tier === "fatal" ? "critical" : "high",
      ruleId: local.id,
      reason: local.reason,
      source: "local-rules",
      dcg,
    };
  }

  return {
    tier: "safe",
    severity: dcg.severity || "none",
    reason: "dcg allow",
    source: "dcg",
    dcg,
  };
}

/**
 * 完整门禁：分层 + 二次确认 + 对接 terminal-policy（仅 safe 未知命令）。
 *
 * @returns action=allow 时调用方应继续执行；其它 action 应返回错误响应。
 */
export async function gateTerminalCommand(
  command: string,
  agent: string,
  mode: TerminalMode | "yolo" | "normal" | "auto",
): Promise<SecurityGateResult> {
  const assessment = await assessCommandSecurity(command);
  const norm = normalizeCommand(command);

  // ── 致命：永不二次放行 ─────────────────────────────────────
  if (assessment.tier === "fatal") {
    const msg =
      assessment.source === "maou-hard"
        ? `⛔ [致命·硬策略] 命令被永久禁止：\`${command}\`\n规则：${assessment.ruleId}\n原因：${assessment.reason}\n` +
          `此为致命级指令，不可 yolo、不可白名单、不可「再执行一次」绕过。`
        : `⛔ [致命·DCG] ${formatDcgDenyMessage(assessment.dcg || { decision: "deny", command, reason: assessment.reason })}\n` +
          `分级：fatal（severity=${assessment.severity || "critical"}）\n` +
          `此为致命级指令，不可 yolo、不可「再执行一次」绕过。人类须在本机自行执行（若确有必要）。`;

    return {
      assessment,
      action: "deny_fatal",
      message: msg,
      payload: {
        policy: "fatal",
        tier: "fatal",
        command,
        rule_id: assessment.ruleId,
        severity: assessment.severity,
        reason: assessment.reason,
      },
    };
  }

  // ── 危险：二次相同指令确认 / 或走审批 ──────────────────────
  if (assessment.tier === "dangerous") {
    // 已处于确认窗口 → 放行（不永久写入白名单，避免把危险命令固化）
    if (isCommandRepeatConfirm(agent, norm)) {
      consumeRepeatConfirm(agent, norm);
      return {
        assessment,
        action: "allow",
        payload: {
          policy: "dangerous-confirmed",
          tier: "dangerous",
          command,
          rule_id: assessment.ruleId,
          confirmed: true,
        },
      };
    }

    // yolo：仍不静默放行危险指令，要求二次确认
    // auto：可先交审核 Agent；此处统一用「登记 + 拦截」，审核在 tool 层可选叠加
    markCommandForRepeatConfirm(agent, norm);

    const msg =
      `⚠️ [危险·需确认] 命令匹配破坏性模式，已拦截：\`${command}\`\n` +
      `分级：dangerous（severity=${assessment.severity || "high"}）\n` +
      (assessment.ruleId ? `规则：${assessment.ruleId}\n` : "") +
      (assessment.reason ? `原因：${assessment.reason}\n` : "") +
      `放行方式（三选一）：\n` +
      `  1) 在 ${Math.round(10)} 分钟内再执行一次**完全相同**的命令（视为确认）\n` +
      `  2) 由用户在审批 UI 中同意（若环境支持）\n` +
      `  3) 由安全审核 Agent 同意（auto 模式）\n` +
      `致命级指令不会因重复执行而放行；当前为危险级。`;

    return {
      assessment,
      action: "deny_dangerous_pending",
      message: msg,
      payload: {
        policy: "dangerous-pending",
        tier: "dangerous",
        command,
        rule_id: assessment.ruleId,
        severity: assessment.severity,
        reason: assessment.reason,
        confirm_hint: "re-run-identical-command",
      },
    };
  }

  // ── 安全：maou 产物白名单已确认安全 → 直接放行（不再 ask）──
  if (assessment.source === "maou-safe") {
    return {
      assessment,
      action: "allow",
      payload: {
        policy: "safe-artifact",
        tier: "safe",
        command,
        rule_id: assessment.ruleId,
      },
    };
  }

  // ── 安全：交给用户策略（黑名单 / 白名单 / ask / auto / yolo）──
  const effectiveMode: TerminalMode =
    mode === "yolo" || mode === "auto" || mode === "normal" ? mode : "normal";

  // 用 normal 跑一遍名单，确保 yolo 下用户黑名单仍生效
  const listDecision = decideCommand(command, agent, "normal");
  if (listDecision.action === "deny") {
    return {
      assessment: {
        tier: "dangerous",
        reason: listDecision.reason || "blacklist",
        source: "policy",
        ruleId: listDecision.matched,
      },
      action: "deny_dangerous_pending",
      message:
        `⚠️ [危险·用户黑名单] \`${command}\`\n原因：${listDecision.reason}\n` +
        `若需放行：在窗口期内再执行一次相同命令，或调整黑名单。`,
      payload: {
        policy: "blacklist",
        tier: "dangerous",
        command,
        matched: listDecision.matched,
      },
    };
  }
  if (listDecision.action === "allow") {
    return {
      assessment: {
        ...assessment,
        reason: listDecision.reason || assessment.reason,
        source: "policy",
      },
      action: "allow",
      payload: {
        policy: "safe-whitelist",
        tier: "safe",
        command,
        matched: listDecision.matched,
      },
    };
  }

  if (effectiveMode === "yolo") {
    return {
      assessment: {
        ...assessment,
        reason: (assessment.reason || "") + " + yolo",
      },
      action: "allow",
      payload: { policy: "safe-yolo", tier: "safe", command },
    };
  }

  const decision = decideCommand(command, agent, effectiveMode);
  if (decision.action === "allow") {
    return {
      assessment: {
        ...assessment,
        reason: decision.reason || assessment.reason,
        source: "policy",
      },
      action: "allow",
      payload: { policy: "safe-allow", tier: "safe", command, matched: decision.matched },
    };
  }
  if (decision.action === "review") {
    return {
      assessment: { ...assessment, source: "policy", reason: "auto-review" },
      action: "review",
      payload: { policy: "review", tier: "safe", command },
    };
  }
  return {
    assessment: { ...assessment, source: "policy", reason: "need-user-confirm" },
    action: "ask",
    payload: { policy: "ask", tier: "safe", command },
  };
}
