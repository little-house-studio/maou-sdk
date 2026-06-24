/**
 * Prompt 渲染预览
 *
 * 把编译后的 prompt 渲染成可读格式，方便调试时查看最终发给 LLM 的内容。
 * 支持三种输出格式：html / markdown / terminal（带颜色高亮）
 */

import type { CompileResult } from "../compiler/types.js";

// ─── 类型 ──────────────────────────────────────────────────────────────────

export type PreviewFormat = "html" | "markdown" | "terminal";

export interface PreviewOptions {
  /** 输出格式 */
  format: PreviewFormat;
  /** 是否显示元数据（编译耗时、包含文件等） */
  showMetadata?: boolean;
  /** 是否高亮 include 来源 */
  highlightIncludes?: boolean;
}

// ─── 终端颜色（无依赖，自实现 ANSI 转义）────────────────────────────────────

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

// ─── 渲染器 ────────────────────────────────────────────────────────────────

/**
 * 渲染编译结果为可读预览
 */
export function renderPreview(
  content: string,
  result: CompileResult | null,
  options: PreviewOptions,
): string {
  switch (options.format) {
    case "html":
      return renderHtml(content, result, options);
    case "markdown":
      return renderMarkdown(content, result, options);
    case "terminal":
      return renderTerminal(content, result, options);
  }
}

// ─── HTML 渲染 ─────────────────────────────────────────────────────────────

function renderHtml(
  content: string,
  result: CompileResult | null,
  options: PreviewOptions,
): string {
  const escaped = escapeHtml(content);
  const meta = options.showMetadata && result ? renderHtmlMetadata(result) : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>Prompt 预览</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; }
    .metadata { background: #f5f5f5; padding: 1rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.875rem; }
    .metadata h3 { margin: 0 0 0.5rem 0; }
    .metadata ul { margin: 0; padding-left: 1.5rem; }
    .prompt { background: #1e1e1e; color: #d4d4d4; padding: 1.5rem; border-radius: 8px; white-space: pre-wrap; font-family: 'SF Mono', monospace; font-size: 0.875rem; line-height: 1.6; }
    .include { color: #569cd6; }
    .script { color: #ce9178; }
    .warning { color: #f44747; }
  </style>
</head>
<body>
${meta}
<div class="prompt">${highlightHtml(escaped)}</div>
</body>
</html>`;
}

function renderHtmlMetadata(result: CompileResult): string {
  return `<div class="metadata">
  <h3>编译信息</h3>
  <ul>
    <li>入口：${escapeHtml(result.entryPath)}</li>
    <li>耗时：${result.elapsedMs}ms</li>
    <li>包含文件：${result.includedFiles.length} 个</li>
    <li>执行脚本：${result.executedScripts.length} 个</li>
    ${result.warnings.length ? `<li>警告：${result.warnings.length} 条</li>` : ""}
  </ul>
</div>`;
}

function highlightHtml(text: string): string {
  return text
    .replace(/\[文件未找到: [^\]]+\]/g, '<span class="warning">$&</span>')
    .replace(/\[循环引用跳过: [^\]]+\]/g, '<span class="warning">$&</span>')
    .replace(/\[脚本执行不支持: [^\]]+\]/g, '<span class="warning">$&</span>');
}

// ─── Markdown 渲染 ─────────────────────────────────────────────────────────

function renderMarkdown(
  content: string,
  result: CompileResult | null,
  options: PreviewOptions,
): string {
  const meta = options.showMetadata && result ? renderMarkdownMetadata(result) : "";
  return `${meta}\n\`\`\`text\n${content}\n\`\`\`\n`;
}

function renderMarkdownMetadata(result: CompileResult): string {
  const lines = [
    `## 编译信息`,
    `- 入口：\`${result.entryPath}\``,
    `- 耗时：${result.elapsedMs}ms`,
    `- 包含文件：${result.includedFiles.length} 个`,
    `- 执行脚本：${result.executedScripts.length} 个`,
  ];
  if (result.warnings.length) {
    lines.push(`- 警告：${result.warnings.length} 条`);
  }
  return lines.join("\n") + "\n";
}

// ─── 终端渲染 ──────────────────────────────────────────────────────────────

function renderTerminal(
  content: string,
  result: CompileResult | null,
  options: PreviewOptions,
): string {
  const meta = options.showMetadata && result ? renderTerminalMetadata(result) : "";
  const highlighted = highlightTerminal(content);
  return `${meta}\n${highlighted}\n`;
}

function renderTerminalMetadata(result: CompileResult): string {
  const lines = [
    `${ANSI.bold}${ANSI.cyan}== 编译信息 ==${ANSI.reset}`,
    `${ANSI.dim}入口：${ANSI.reset}${result.entryPath}`,
    `${ANSI.dim}耗时：${ANSI.reset}${result.elapsedMs}ms`,
    `${ANSI.dim}包含文件：${ANSI.reset}${result.includedFiles.length} 个`,
    `${ANSI.dim}执行脚本：${ANSI.reset}${result.executedScripts.length} 个`,
  ];
  if (result.warnings.length) {
    lines.push(`${ANSI.red}警告：${result.warnings.length} 条${ANSI.reset}`);
  }
  return lines.join("\n");
}

function highlightTerminal(text: string): string {
  return text
    .replace(/\[文件未找到: [^\]]+\]/g, `${ANSI.red}$&${ANSI.reset}`)
    .replace(/\[循环引用跳过: [^\]]+\]/g, `${ANSI.yellow}$&${ANSI.reset}`)
    .replace(/\[脚本执行不支持: [^\]]+\]/g, `${ANSI.yellow}$&${ANSI.reset}`);
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
