/**
 * 写入/编辑文件后的 LSP 自我验证 —— 自我验证闭环的核心。
 *
 * 思路（对标 Claude Code「改完即验」）：每次成功写文件后，用 LSP 立刻检查该文件是否无错，
 * 把诊断结果直接拼回工具结果，让模型在下一轮就看到自己引入的错误并自行修复。
 *
 * 约束（绝不拖垮主流程）：
 * - 仅当该文件类型有可用语言服务器时才验证（isServerAvailable，非代码文件零开销返回）。
 * - 时间受限：短静默期 + 硬超时；服务器池保持温热，首次冷启动后续编辑很快。
 * - 全程容错：验证自身任何异常都吞掉，返回 null，绝不影响编辑结果。
 * - 无错时静默（返回 null），只在有 error/warning 时提示，避免每次编辑刷屏。
 * - 可用 MAOU_NO_LSP_VERIFY=1 全局关闭。
 */

import * as lsp from "@little-house-studio/lsp-engine";

const DISABLED = (() => {
  const v = process.env.MAOU_NO_LSP_VERIFY;
  return v === "1" || v === "true" || v === "yes";
})();

const MAX_LINES = 15;

/**
 * 对刚写入的文件做 LSP 验证，返回供拼接到工具结果的诊断摘要文本；
 * 无问题 / 无可用 server / 未稳定 / 关闭 / 异常 → 返回 null（静默）。
 */
export async function verifyAfterWrite(absPath: string): Promise<string | null> {
  if (DISABLED) return null;
  try {
    if (!lsp.isServerAvailable(absPath)) return null;

    const r = await lsp.diagnostics(absPath, { settleMs: 400, hardTimeoutMs: 4000 });

    // 未在时限内收敛 → 不误报「无错」，也不刷屏，交回 null
    if (r.settle && !r.settle.settled) return null;

    const diags = (r.diagnostics ?? []).filter(
      (d) => d.severity === "error" || d.severity === "warning",
    );
    if (diags.length === 0) return null;

    const errors = diags.filter((d) => d.severity === "error").length;
    const warnings = diags.filter((d) => d.severity === "warning").length;

    // 错误优先排前面
    diags.sort((a, b) => (a.severity === "error" ? 0 : 1) - (b.severity === "error" ? 0 : 1));
    const lines = diags
      .slice(0, MAX_LINES)
      .map((d) => `  ${d.severity} [${d.line + 1}:${d.character + 1}] ${d.message}${d.code ? ` (${d.code})` : ""}`);
    const more = diags.length > MAX_LINES ? `\n  …还有 ${diags.length - MAX_LINES} 条` : "";

    const verb = errors > 0
      ? "请修复这些错误后再继续"
      : "建议处理这些警告";
    return `\n\n⚠️ LSP 自动验证：${errors} 个错误、${warnings} 个警告（${verb}）：\n${lines.join("\n")}${more}`;
  } catch {
    return null; // 验证失败绝不影响编辑结果
  }
}
