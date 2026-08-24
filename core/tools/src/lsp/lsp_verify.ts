/**
 * 写入/编辑后的自我验证链：
 *   1) LSP 诊断（支持的格式默认开启）
 *   2) 无 LSP 时用 sqry 做结构/索引侧检查
 *   3) 再退化为「请用 tsc/eslint 自检」提示词
 *
 * 不使用笔误启发式。MAOU_NO_LSP_VERIFY=1 关闭 LSP 段（仍可走 sqry/提示）。
 */

import { basename, dirname, extname, relative } from "node:path";
import * as lsp from "@little-house-studio/lsp-engine";

const LSP_DISABLED = (() => {
  const v = process.env.MAOU_NO_LSP_VERIFY;
  return v === "1" || v === "true" || v === "yes";
})();

const MAX_LINES = 15;

const CODE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|cs|cpp|c|h|hpp|rb|php|swift|vue|svelte|json|jsonc)$/i;

export function isCodeLikePath(absPath: string): boolean {
  return CODE_EXT.test(absPath);
}

/**
 * 对刚写入/编辑的文件做验证，返回拼进工具结果的文案；
 * 无问题且 LSP 成功 → null；无工具可用 → 提示词（代码文件）。
 */
export async function verifyAfterWrite(
  absPath: string,
  opts?: { projectRoot?: string },
): Promise<string | null> {
  // ── 1) LSP ──────────────────────────────────────────────
  if (!LSP_DISABLED) {
    try {
      if (lsp.isServerAvailable(absPath)) {
        const r = await lsp.diagnostics(absPath, {
          settleMs: 400,
          hardTimeoutMs: 4000,
        });
        // 未收敛：不谎称无错，落到 sqry/提示
        if (!r.settle || r.settle.settled) {
          const diags = (r.diagnostics ?? []).filter(
            (d) => d.severity === "error" || d.severity === "warning",
          );
          if (diags.length === 0) return null; // LSP 干净

          const errors = diags.filter((d) => d.severity === "error").length;
          const warnings = diags.filter((d) => d.severity === "warning").length;
          diags.sort(
            (a, b) =>
              (a.severity === "error" ? 0 : 1) - (b.severity === "error" ? 0 : 1),
          );
          const lines = diags
            .slice(0, MAX_LINES)
            .map(
              (d) =>
                `  ${d.severity} [${d.line + 1}:${d.character + 1}] ${d.message}${d.code ? ` (${d.code})` : ""}`,
            );
          const more =
            diags.length > MAX_LINES
              ? `\n  …还有 ${diags.length - MAX_LINES} 条`
              : "";
          const verb =
            errors > 0 ? "请修复这些错误后再继续" : "建议处理这些警告";
          return `\n\n⚠️ LSP 自动验证：${errors} 个错误、${warnings} 个警告（${verb}）：\n${lines.join("\n")}${more}`;
        }
      }
    } catch {
      /* fall through */
    }
  }

  // ── 2) sqry 结构检查（无可用 LSP 或 LSP 未收敛时）──────
  const sqryNote = await trySqryAfterWrite(absPath, opts?.projectRoot);
  if (sqryNote) return sqryNote;

  // ── 3) 提示词兜底（仅代码类文件）──────────────────────
  if (isCodeLikePath(absPath)) {
    const ext = extname(absPath) || "code";
    return (
      `\n\n💡 未能对「${basename(absPath)}」完成 LSP 诊断` +
      `（未安装对应语言服务器或未收敛），sqry 也未给出结构告警。` +
      `请在继续前用 tsc/eslint/测试 或工具 \`find_code\`/\`lsp check\` 自检 ${ext} 文件。`
    );
  }
  return null;
}

async function trySqryAfterWrite(
  absPath: string,
  projectRoot?: string,
): Promise<string | null> {
  if (!isCodeLikePath(absPath)) return null;
  const root = projectRoot || dirname(absPath);
  try {
    const sqry = await import("@little-house-studio/sqry-engine");
    if (!sqry.isAvailable()) return null;

    // 索引存在则沿用；不存在再构建（失败则提示）
    try {
      await sqry.ensureIndex(root);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `\n\n⚠️ sqry 索引检查失败（${msg.slice(0, 200)}）。请确认语法/路径后重试，或运行 cargo install sqry。`;
    }

    // 用文件名主体做一次结构搜索：能建索引且可查询 → 结构侧大致健康
    const stem = basename(absPath).replace(/\.[^.]+$/, "");
    if (stem.length < 2) return null;
    try {
      const r = await sqry.search(root, stem, { limit: 5, fuzzy: true });
      // 若 stderr 类信息在异常里
      void r;
      return null; // 无硬错误则静默，避免刷屏
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 模糊/未命中不是错误
      if (/ambiguous|not found|no result|未找到/i.test(msg)) return null;
      return `\n\n⚠️ sqry 结构检查：${msg.slice(0, 300)}`;
    }
  } catch {
    return null;
  }
}
