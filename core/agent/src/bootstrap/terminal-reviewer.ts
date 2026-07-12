/**
 * 终端 auto 模式 LLM 审核器 — 通用安装。
 * coding CLI / maou-agent harness 共用，避免两套提示词与解析逻辑。
 */

import {
  setTerminalReviewer,
  setTerminalPolicyRoot,
} from "@little-house-studio/tools";
import type { LLMClient } from "@little-house-studio/llm";

const REVIEWER_SYSTEM =
  '你是严格的终端命令安全审核员。判断给定 shell 命令在一个开发项目里执行是否安全。删除大范围文件、写系统目录、下载执行远程脚本、泄露密钥、关机重启等视为不安全。只输出一行 JSON：{"approve": true/false, "reason": "简短中文理由"}，不要任何额外文字。';

export interface InstallTerminalReviewerOptions {
  llmClient: LLMClient;
  /** 取审核用 preset；返回 null/undefined 时按 onMissingPreset 处理 */
  getPreset: () => Record<string, unknown> | undefined | null;
  /**
   * 无 preset 时：
   * - approve：CLI 交互不卡死（coding 原行为）
   * - deny：保守（harness 原行为）
   */
  onMissingPreset?: "approve" | "deny";
  /** 同时设置策略根目录（通常为 maouRoot） */
  policyRoot?: string;
}

/** 安装全局终端审核器（tools 单例） */
export function installTerminalReviewer(opts: InstallTerminalReviewerOptions): void {
  if (opts.policyRoot) {
    setTerminalPolicyRoot(opts.policyRoot);
  }
  const missing = opts.onMissingPreset ?? "deny";

  setTerminalReviewer(async (command) => {
    try {
      const preset = opts.getPreset();
      if (!preset || !(preset as { name?: string }).name) {
        return missing === "approve"
          ? { approve: true, reason: "未配置 preset，默认放行" }
          : { approve: false, reason: "未配置可用 preset，无法审核" };
      }
      const messages = [
        { role: "system", content: REVIEWER_SYSTEM },
        { role: "user", content: `命令：\n${command}` },
      ];
      const resp = await opts.llmClient.chat({
        preset: preset as never,
        messages: messages as never,
      });
      const text = String((resp as { content?: string }).content ?? "").trim();
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) {
        return { approve: false, reason: `审核响应无法解析：${text.slice(0, 60)}` };
      }
      const parsed = JSON.parse(m[0]) as { approve?: boolean; reason?: string };
      return {
        approve: parsed.approve === true,
        reason: String(parsed.reason ?? "（无理由）"),
      };
    } catch (err) {
      return { approve: false, reason: `审核异常：${String(err).slice(0, 60)}` };
    }
  });
}
