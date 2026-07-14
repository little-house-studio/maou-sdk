/**
 * 终端 auto 模式 LLM 审核器 —— **helper 类辅助 agent**。
 *
 * 语义对齐四类 subagent 中的 helper：
 *   - 单轮、无 tool（不能同时单轮又开 tool）
 *   - 不进 SubagentExecutor 管理列表（persist=false / ephemeral）
 *   - 走 AuxModelCaller 统一辅助管道（与压缩 / loop 判定同路，独立 token 统计）
 *   - 优先 helper/fast 小模型 preset
 *
 * coding CLI / maou-agent harness 共用，避免两套提示词与解析逻辑。
 */

import {
  setTerminalReviewer,
  setTerminalPolicyRoot,
} from "@little-house-studio/tools";
import type { TerminalReviewer } from "@little-house-studio/tools";
import {
  AuxModelCaller,
  resolveHelperPreset,
} from "@little-house-studio/llm";
import type { APIPreset, LLMClient } from "@little-house-studio/llm";

/** helper 身份：终端安全审核（不物化进管理列表，仅运行时管道） */
export const TERMINAL_AUTO_REVIEW_HELPER = {
  kind: "helper" as const,
  name: "terminal-auto-review",
  /** AuxModelCaller tag，计入 byTag 统计 */
  auxTag: "helper:terminal_auto_review",
  enableLoop: false,
  tools: [] as string[],
  persistContext: false,
  listInManager: false,
  roundLimit: 1,
} as const;

const REVIEWER_SYSTEM =
  "你是严格的终端命令安全审核员（辅助 agent / helper，单轮、无工具）。" +
  "判断给定 shell 命令在一个开发项目里执行是否安全。" +
  "删除大范围文件、写系统目录、下载执行远程脚本、泄露密钥、关机重启等视为不安全。" +
  '只输出一行 JSON：{"approve": true/false, "reason": "简短中文理由"}，不要任何额外文字。';

export interface InstallTerminalReviewerOptions {
  llmClient: LLMClient;
  /**
   * 取审核用 preset（通常为主模型或 helper 小模型）。
   * 返回 null/undefined 时按 onMissingPreset 处理。
   * 若同时提供 getHelperPreset，优先 helper。
   */
  getPreset: () => Record<string, unknown> | undefined | null;
  /**
   * 可选：解析 helper/fast 小模型（agent.json helperModel / roles.helper）。
   * 未提供时用 getPreset 结果。
   */
  getHelperPreset?: () => Record<string, unknown> | undefined | null;
  /**
   * 复用已有 AuxModelCaller（推荐：与 Runtime 共用，统一计费/统计）。
   * 缺省则内部 new AuxModelCaller({ client: llmClient })。
   */
  auxModelCaller?: AuxModelCaller;
  /**
   * 无 preset 时：
   * - approve：CLI 交互不卡死（coding 原行为）
   * - deny：保守（harness 原行为）
   */
  onMissingPreset?: "approve" | "deny";
  /** 同时设置策略根目录（通常为 maouRoot） */
  policyRoot?: string;
}

/**
 * 安装全局终端审核器（tools 单例）。
 * 实现为 helper 辅助 agent：Aux 单轮 JSON，无 tool。
 */
export function installTerminalReviewer(opts: InstallTerminalReviewerOptions): void {
  if (opts.policyRoot) {
    setTerminalPolicyRoot(opts.policyRoot);
  }
  const missing = opts.onMissingPreset ?? "deny";
  const aux =
    opts.auxModelCaller ??
    new AuxModelCaller({ client: opts.llmClient, maxRetries: 1 });

  const reviewer: TerminalReviewer = async (command, ctx) => {
    try {
      const helperP = opts.getHelperPreset?.();
      const mainP = opts.getPreset();
      const preset = (helperP ?? mainP) as APIPreset | undefined | null;
      const hasModel =
        preset &&
        (Boolean((preset as { name?: string }).name) ||
          Boolean((preset as { model?: string }).model));
      if (!preset || !hasModel) {
        return missing === "approve"
          ? { approve: true, reason: "未配置 preset，默认放行（helper 审核跳过）" }
          : { approve: false, reason: "未配置可用 preset，helper 审核无法运行" };
      }

      const cwdHint = ctx.cwd ? `\n工作目录：${ctx.cwd}` : "";
      const agentHint = ctx.agentName ? `\n当前 agent：${ctx.agentName}` : "";
      const userPrompt =
        `【${TERMINAL_AUTO_REVIEW_HELPER.auxTag}】单轮安全审核，禁止调用工具。${agentHint}${cwdHint}\n` +
        `命令：\n${command}`;

      const result = await aux.callJson({
        preset,
        systemPrompt: REVIEWER_SYSTEM,
        userPrompt,
        context: {
          sessionId: `helper:${TERMINAL_AUTO_REVIEW_HELPER.name}`,
          tag: TERMINAL_AUTO_REVIEW_HELPER.auxTag,
        },
      });

      if (!result.ok) {
        return {
          approve: false,
          reason: `helper 审核失败：${(result.error ?? "unknown").slice(0, 80)}`,
        };
      }
      if (!result.json) {
        return {
          approve: false,
          reason: `helper 审核响应无法解析：${result.content.slice(0, 60)}`,
        };
      }
      return {
        approve: result.json.approve === true,
        reason: String(result.json.reason ?? "（无理由）"),
      };
    } catch (err) {
      return {
        approve: false,
        reason: `helper 审核异常：${String(err).slice(0, 60)}`,
      };
    }
  };

  setTerminalReviewer(reviewer);
}

/**
 * 从 config presets 解析 helper preset（供 harness/CLI 装配用）。
 * 优先级：roles.helper > helperPreset 索引 > roles.fast > 主模型。
 */
export function resolveTerminalReviewPreset(
  presets: APIPreset[],
  mainPreset: APIPreset | undefined,
  opts?: {
    helperPresetIdx?: number;
    helperRole?: string | number;
    fastRole?: string | number;
    agentHelperModel?: string;
  },
): APIPreset | undefined {
  if (!mainPreset) return presets[0];
  return resolveHelperPreset(
    opts?.agentHelperModel,
    presets,
    opts?.helperPresetIdx,
    mainPreset,
    opts?.helperRole,
    opts?.fastRole,
  );
}
