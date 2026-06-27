/**
 * Agent 模板实例化 —— eve 系统的「模板复制创建 agent」能力。
 *
 * 不再硬编码写 SYSTEM.md，而是从 templates/agent/ 复制整套 eve 结构到
 * <maouRoot>/agents/<name>/，并替换占位符（{{name}} / {{display_name}} / {{role}}）、合并配置。
 *
 * eve 目录结构（模板）：
 *   prompt/system/system.md          系统提示词（入口，自动渲染嵌套）
 *   prompt/before_user/before_user.md 用户输入前注入
 *   prompt/compression/compression.md 压缩提示词
 *   prompt/PREVIEW/                    渲染预览产物
 *   memory/ hook/ loop/ triggers/ command/ skill/  各功能目录
 *   agent.json                        配置（工具白名单/重试/loop 上限/终端模式）
 */

import { existsSync, cpSync, readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PromptCompiler } from "@little-house-studio/prompt";

/** 模板目录：相对编译产物 dist/agent/template.js 上溯到包根的 templates/agent。 */
const TEMPLATE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "templates", "agent");

export interface CreateAgentOptions {
  displayName?: string;
  role?: string;
  /** 覆盖默认 system.md 内容（如 coding agent 的编程提示词） */
  systemPrompt?: string;
  /** 覆盖默认 before_user.md */
  beforeUser?: string;
  tools?: readonly string[];
  roundLimit?: number;
  maxRetries?: number;
  terminalMode?: "normal" | "auto" | "yolo";
  reviewerRole?: string;
  /** 已存在时是否强制覆盖（否则幂等跳过） */
  force?: boolean;
}

/**
 * 从模板创建一个 agent 实例到 <maouRoot>/agents/<name>/。
 * 返回 agent 目录路径。幂等：已存在且未 force 时直接返回。
 */
export function createAgentFromTemplate(name: string, maouRoot: string, opts: CreateAgentOptions = {}): string {
  const target = join(maouRoot, "agents", name);
  if (existsSync(join(target, "prompt", "system", "system.md")) && !opts.force) {
    return target;
  }
  if (!existsSync(TEMPLATE_DIR)) {
    throw new Error(`agent 模板缺失: ${TEMPLATE_DIR}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  // 复制模板（保留已有的 memory/tokens/sessions 等运行数据，只覆盖模板文件）
  cpSync(TEMPLATE_DIR, target, { recursive: true });

  const vars: Record<string, string> = {
    name,
    display_name: opts.displayName ?? name,
    role: opts.role ?? "通用助手",
  };
  substitutePlaceholders(target, vars);

  if (opts.systemPrompt) writeFileSync(join(target, "prompt", "system", "system.md"), opts.systemPrompt, "utf-8");
  if (opts.beforeUser) writeFileSync(join(target, "prompt", "before_user", "before_user.md"), opts.beforeUser, "utf-8");

  mergeAgentJson(join(target, "agent.json"), opts);

  // 同步生成一份 PERMISSION.jsonc（工具白名单的强制副本，兼容现有权限读取）
  if (opts.tools) {
    writeFileSync(
      join(target, "PERMISSION.jsonc"),
      JSON.stringify({ permission_preset: "full", tool_whitelist: [...opts.tools] }, null, 2),
      "utf-8",
    );
  }

  // 创建后即渲染一份 PREVIEW（开发调试可直接看最终提示词）
  try { renderAgentPreview(target); } catch { /* 渲染失败不影响创建 */ }
  return target;
}

/**
 * 把 agent 的 system/before_user/compression 三个提示词**渲染后**写入 prompt/PREVIEW/，
 * 方便开发时直接看到最终注入内容（含 {{file}} 内联、{{>>script}} 执行的结果）。
 * 只对 eve 结构（存在 prompt/system/system.md）生效。
 */
export function renderAgentPreview(agentDir: string, projectRoot?: string): void {
  const promptRoot = join(agentDir, "prompt");
  if (!existsSync(join(promptRoot, "system", "system.md"))) return;
  const previewDir = join(promptRoot, "PREVIEW");
  mkdirSync(previewDir, { recursive: true });
  const compiler = new PromptCompiler({ promptRoot, projectRoot: projectRoot ?? process.cwd(), entrypoint: "system/system.md" });
  const stamp = "<!-- 自动渲染产物，请勿手动编辑；改源文件后重新渲染会覆盖。 -->\n\n";
  const targets: Array<[string, string]> = [
    ["system/system.md", "PREVIEW_SYSTEM.md"],
    ["before_user/before_user.md", "PREVIEW_BEFORE_USER.md"],
    ["compression/compression.md", "PREVIEW_COMPRESSION.md"],
  ];
  for (const [src, out] of targets) {
    if (!existsSync(join(promptRoot, src))) continue;
    try {
      const rendered = compiler.compile(src);
      writeFileSync(join(previewDir, out), stamp + rendered, "utf-8");
    } catch (err) {
      writeFileSync(join(previewDir, out), `${stamp}[渲染失败: ${err}]`, "utf-8");
    }
  }
}

/** 递归替换文本文件里的 {{key}} 占位符。 */
function substitutePlaceholders(dir: string, vars: Record<string, string>): void {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) { substitutePlaceholders(p, vars); continue; }
    if (!/\.(md|json|jsonc|ts|txt)$/.test(entry)) continue;
    let content = readFileSync(p, "utf-8");
    let changed = false;
    for (const [k, v] of Object.entries(vars)) {
      const re = new RegExp(`\\{\\{${k}\\}\\}`, "g");
      if (re.test(content)) { content = content.replace(re, v); changed = true; }
    }
    if (changed) writeFileSync(p, content, "utf-8");
  }
}

/** 把 opts 合并进 agent.json。 */
function mergeAgentJson(path: string, opts: CreateAgentOptions): void {
  try {
    const j = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    if (opts.tools) j.tools = [...opts.tools];
    if (typeof opts.roundLimit === "number") j.round_limit = opts.roundLimit;
    if (typeof opts.maxRetries === "number") j.max_retries = opts.maxRetries;
    if (opts.terminalMode) j.terminal_mode = opts.terminalMode;
    if (opts.reviewerRole) j.reviewer_role = opts.reviewerRole;
    if (opts.role) j.role = opts.role;
    if (opts.displayName) j.display_name = opts.displayName;
    const now = new Date().toISOString();
    j.updated_at = now;
    if (!j.created_at) j.created_at = now;
    writeFileSync(path, JSON.stringify(j, null, 2), "utf-8");
  } catch { /* 损坏则保持模板原样 */ }
}
