/**
 * 预览当前 agent「渲染后」发给 AI 的请求材料（调试用）。
 * 与 Runtime.run 编译路径对齐；不写 session、不进 LLM 上下文。
 *
 * 分段：
 *  - system          system/system.md 编译结果
 *  - workspace       <workspace> 块
 *  - skills_bake     skill 列表 bake（可缓存区）
 *  - tool_instructions TOOL.md 注入的 <tool_instructions>
 *  - before_user     before_user/before_user.md（用户轮注入，不在 system 字段）
 *  - compression     compression 模板
 *  - tool_schemas    发给 API 的 tools/function schema 摘要
 *  - assembled_system ≈ 实际 system 消息拼装（system+workspace+bake+tool_instructions）
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { PromptCompiler } from "@little-house-studio/prompt";
import { AgentRegistry } from "../agent/registry.js";
import { createAgentSkillManager } from "./skills.js";
import type { AgentSkillOptions } from "./skills.js";
import { createStandardAgentDeps } from "./runtime-deps.js";

export interface PreviewSystemPromptOptions {
  agentName: string;
  projectRoot?: string;
  maouRoot?: string;
  skillOptions?: AgentSkillOptions;
  includeSkills?: boolean;
  includeWorkspace?: boolean;
  fallbackPromptRoot?: string;
  fallbackEntrypoint?: string;
  /** 是否尝试加载 builtins 工具表（TOOL.md / schemas）；默认 true */
  includeTools?: boolean;
}

/** 入口文件是否真实存在 */
function entryExists(promptRoot: string, entrypoint: string): boolean {
  if (!promptRoot || !entrypoint) return false;
  if (existsSync(join(promptRoot, entrypoint))) return true;
  if (existsSync(join(promptRoot, "prompt", entrypoint))) return true;
  if (existsSync(join(promptRoot, "prompt", "system", "system.md"))) return true;
  if (existsSync(join(promptRoot, "SYSTEM.md"))) return true;
  return false;
}

export interface PreviewSystemPromptResult {
  ok: boolean;
  text: string;
  agentName: string;
  promptRoot: string;
  entrypoint: string;
  projectRoot: string;
  maouRoot: string;
  charCount: number;
  lineCount: number;
  skillCount: number;
  error?: string;
}

/** 请求材料的一个调试分段 */
export interface PreviewRequestSection {
  /** 稳定 id，CLI 切换用 */
  id: string;
  /** 短标题 */
  title: string;
  /** 正文 */
  body: string;
  /** 补充说明（不进 AI） */
  note?: string;
  charCount: number;
  lineCount: number;
}

export interface PreviewRequestBundleResult {
  ok: boolean;
  agentName: string;
  promptRoot: string;
  entrypoint: string;
  projectRoot: string;
  maouRoot: string;
  sections: PreviewRequestSection[];
  /** 全部分段拼成一份可滚动/可复制文档 */
  combined: string;
  /** 兼容旧 /prompt：≈ assembled_system */
  text: string;
  charCount: number;
  lineCount: number;
  skillCount: number;
  toolCount: number;
  error?: string;
}

function stats(body: string): { charCount: number; lineCount: number } {
  return {
    charCount: body.length,
    lineCount: body.length === 0 ? 0 : body.split("\n").length,
  };
}

function section(
  id: string,
  title: string,
  body: string,
  note?: string,
): PreviewRequestSection {
  const s = stats(body);
  return { id, title, body, note, ...s };
}

function resolveCompileRoot(
  opts: PreviewSystemPromptOptions,
): {
  agentName: string;
  projectRoot: string;
  maouRoot: string;
  promptRoot: string;
  entrypoint: string;
  compileRoot: string;
  error?: string;
} {
  const agentName = (opts.agentName || "main").trim() || "main";
  const projectRoot = opts.projectRoot ?? process.cwd();
  const maouRoot = opts.maouRoot ?? join(homedir(), ".maou");
  let promptRoot = "";
  let entrypoint = "system/system.md";

  try {
    const registry = new AgentRegistry(maouRoot, projectRoot);
    try {
      promptRoot = registry.getPromptRoot(agentName);
      entrypoint = registry.getPromptEntrypoint(agentName);
    } catch {
      /* fallthrough */
    }
    if (!entryExists(promptRoot, entrypoint)) {
      try {
        const globalOnly = new AgentRegistry(maouRoot);
        const gr = globalOnly.getPromptRoot(agentName);
        const ge = globalOnly.getPromptEntrypoint(agentName);
        if (entryExists(gr, ge)) {
          promptRoot = gr;
          entrypoint = ge;
        }
      } catch {
        /* ignore */
      }
    }
    if (!entryExists(promptRoot, entrypoint) && opts.fallbackPromptRoot) {
      const fr = opts.fallbackPromptRoot;
      const fe = opts.fallbackEntrypoint ?? "system/system.md";
      if (entryExists(fr, fe)) {
        promptRoot = fr;
        entrypoint = fe;
      }
    }
  } catch (err) {
    return {
      agentName,
      projectRoot,
      maouRoot,
      promptRoot,
      entrypoint,
      compileRoot: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!promptRoot || !existsSync(promptRoot) || !entryExists(promptRoot, entrypoint)) {
    return {
      agentName,
      projectRoot,
      maouRoot,
      promptRoot,
      entrypoint,
      compileRoot: "",
      error:
        `无法找到 agent「${agentName}」的 system 提示词入口。` +
        ` 已查: 项目 .maou/agents、全局 ~/.maou/agents` +
        (opts.fallbackPromptRoot ? `、fallback ${opts.fallbackPromptRoot}` : "") +
        `。可先启动一次 agent 完成物化，或检查 ROLE/prompt 目录。`,
    };
  }

  let compileRoot = promptRoot;
  if (
    !existsSync(join(promptRoot, entrypoint)) &&
    existsSync(join(promptRoot, "prompt", entrypoint))
  ) {
    compileRoot = join(promptRoot, "prompt");
  }

  return { agentName, projectRoot, maouRoot, promptRoot, entrypoint, compileRoot };
}

function tryCompile(
  compileRoot: string,
  projectRoot: string,
  entrypoint: string,
  relPath?: string,
): string {
  const ep = relPath ?? entrypoint;
  if (!existsSync(join(compileRoot, ep))) return "";
  const compiler = new PromptCompiler({
    promptRoot: compileRoot,
    projectRoot,
    entrypoint: ep,
  });
  return compiler.compile(ep === entrypoint ? undefined : ep);
}

function loadToolWhitelist(
  maouRoot: string,
  projectRoot: string,
  agentName: string,
): Set<string> | undefined {
  const candidates = [
    join(projectRoot, ".maou", "agents", agentName, "PERMISSION.jsonc"),
    join(maouRoot, "agents", agentName, "PERMISSION.jsonc"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const raw = readFileSync(p, "utf-8");
      // strip // comments lightly
      const json = raw.replace(/^\s*\/\/.*$/gm, "");
      const data = JSON.parse(json) as { tool_whitelist?: string[] };
      const list = data.tool_whitelist;
      if (Array.isArray(list) && list.length > 0) {
        return new Set(list.map(String));
      }
    } catch {
      /* try next */
    }
  }
  return undefined;
}

/**
 * 编译当前 agent 的 system prompt 快照（同步、只读）。
 * 兼容旧 API：≈ assembled_system（system + workspace + skills bake）。
 */
export function previewAgentSystemPrompt(
  opts: PreviewSystemPromptOptions,
): PreviewSystemPromptResult {
  const bundle = previewAgentRequestBundle({
    ...opts,
    includeTools: false,
  });
  return {
    ok: bundle.ok,
    text: bundle.text,
    agentName: bundle.agentName,
    promptRoot: bundle.promptRoot,
    entrypoint: bundle.entrypoint,
    projectRoot: bundle.projectRoot,
    maouRoot: bundle.maouRoot,
    charCount: bundle.charCount,
    lineCount: bundle.lineCount,
    skillCount: bundle.skillCount,
    error: bundle.error,
  };
}

/**
 * 完整调试包：分段 + 合并文档，对齐 Runtime.run 注入顺序说明。
 */
export function previewAgentRequestBundle(
  opts: PreviewSystemPromptOptions,
): PreviewRequestBundleResult {
  const includeSkills = opts.includeSkills !== false;
  const includeWorkspace = opts.includeWorkspace !== false;
  const includeTools = opts.includeTools !== false;

  const resolved = resolveCompileRoot(opts);
  const empty = (error?: string): PreviewRequestBundleResult => ({
    ok: false,
    agentName: resolved.agentName,
    promptRoot: resolved.promptRoot,
    entrypoint: resolved.entrypoint,
    projectRoot: resolved.projectRoot,
    maouRoot: resolved.maouRoot,
    sections: [],
    combined: "",
    text: "",
    charCount: 0,
    lineCount: 0,
    skillCount: 0,
    toolCount: 0,
    error: error ?? resolved.error ?? "unknown",
  });

  if (resolved.error || !resolved.compileRoot) {
    return empty(resolved.error);
  }

  const { agentName, projectRoot, maouRoot, promptRoot, entrypoint, compileRoot } =
    resolved;

  try {
    // ── 1. system ──
    const systemBody = tryCompile(compileRoot, projectRoot, entrypoint);
    // ── 2. before_user ──
    let beforeUserBody = "";
    try {
      beforeUserBody = tryCompile(
        compileRoot,
        projectRoot,
        entrypoint,
        "before_user/before_user.md",
      );
    } catch (e) {
      beforeUserBody = `[before_user 编译失败: ${e instanceof Error ? e.message : e}]`;
    }
    // ── 3. compression ──
    let compressionBody = "";
    try {
      compressionBody = tryCompile(
        compileRoot,
        projectRoot,
        entrypoint,
        "compression/compression.md",
      );
    } catch (e) {
      compressionBody = `[compression 编译失败: ${e instanceof Error ? e.message : e}]`;
    }

    // ── 4. workspace ──
    const workspaceBody = includeWorkspace
      ? `<workspace>\n你当前的工作目录（所有文件读写、终端命令、相对路径均以此为根）：${projectRoot}\n</workspace>`
      : "";

    // ── 5. skills bake ──
    let skillsBake = "";
    let skillCount = 0;
    if (includeSkills) {
      try {
        const mgr = createAgentSkillManager(
          agentName,
          projectRoot,
          maouRoot,
          opts.skillOptions,
        );
        skillCount = mgr.listAvailableSkills().length;
        skillsBake = mgr.compile().bakedContent ?? "";
      } catch (e) {
        skillsBake = `[skills bake 失败: ${e instanceof Error ? e.message : e}]`;
      }
    }

    // ── 6. tools (TOOL.md + schemas) ──
    let toolInstructions = "";
    let toolSchemasBody = "";
    let toolCount = 0;
    if (includeTools) {
      try {
        const deps = createStandardAgentDeps(projectRoot, maouRoot, {
          installReviewer: false,
          skillOptions: opts.skillOptions,
        });
        const whitelist = loadToolWhitelist(maouRoot, projectRoot, agentName);
        const prompts = deps.toolRegistry.getToolPrompts(whitelist);
        if (prompts.size > 0) {
          let s =
            "<tool_instructions>\n以下是你可使用的工具的补充说明，请在调用对应工具时遵循这些指引：\n";
          for (const [toolName, prompt] of prompts) {
            s += `\n<tool name="${toolName}">\n${prompt}\n</tool>\n`;
          }
          s += "\n</tool_instructions>";
          toolInstructions = s;
        } else {
          toolInstructions =
            "（当前 builtins 白名单下无 TOOL.md 补充说明）";
        }
        const schemas = deps.toolRegistry.nativeToolSchemas(whitelist) ?? [];
        toolCount = schemas.length;
        const lines: string[] = [
          `# Tool schemas 摘要（${toolCount} 个）`,
          `# 实际请求里作为 API tools / functions 数组发送（非 system 文本）`,
          `# 白名单: ${whitelist ? [...whitelist].join(", ") : "*（全量 builtins）"}`,
          `# 注意: MCP mcp__* 工具仅在 Runtime 连接 MCP 后出现，本预览不含 MCP。`,
          "",
        ];
        for (const sch of schemas) {
          const name = String((sch as { name?: string }).name ?? "?");
          const desc = String((sch as { description?: string }).description ?? "").slice(
            0,
            200,
          );
          const params = (sch as { parameters?: unknown }).parameters;
          lines.push(`## ${name}`);
          if (desc) lines.push(desc);
          try {
            lines.push("```json");
            lines.push(JSON.stringify(params ?? {}, null, 2).slice(0, 4000));
            lines.push("```");
          } catch {
            lines.push(String(params));
          }
          lines.push("");
        }
        toolSchemasBody = lines.join("\n");
      } catch (e) {
        toolInstructions = `[工具区加载失败: ${e instanceof Error ? e.message : e}]`;
        toolSchemasBody = toolInstructions;
      }
    }

    // ── assembled system（接近 Runtime 的 system 字段）──
    const assembledParts = [systemBody];
    if (workspaceBody) assembledParts.push(workspaceBody);
    if (skillsBake) assembledParts.push(skillsBake);
    if (toolInstructions && !toolInstructions.startsWith("[") && !toolInstructions.startsWith("（")) {
      assembledParts.push(toolInstructions);
    }
    const assembledSystem = assembledParts.filter(Boolean).join("\n\n");

    const sections: PreviewRequestSection[] = [
      section(
        "toc",
        "目录 / 说明",
        [
          "本预览模拟「最终发给 AI 的请求材料」，不进入会话上下文。",
          "",
          "Runtime.run 大致结构：",
          "  messages[0]  role=system   ← assembled_system",
          "               = system.md + workspace + skills_bake + tool_instructions",
          "               +（运行时）MCP catalog",
          "  messages[…]  历史轮次",
          "  messages[n]  role=user     ← 用户输入前可拼 before_user + 增量 skill/file notice",
          "  tools: [...]               ← tool_schemas（API 级 function calling，不是 system 文本）",
          "",
          "按键切换分段（CLI）：1–8 或 [ / ] · Tab",
          "",
          `agent: ${agentName}`,
          `promptRoot: ${promptRoot}`,
          `entrypoint: ${entrypoint}`,
          `projectRoot: ${projectRoot}`,
          `skills: ${skillCount} · tools(schema): ${toolCount}`,
        ].join("\n"),
        "仅调试说明，不会发给模型",
      ),
      section(
        "system",
        "1 · SYSTEM（system.md 编译）",
        systemBody || "（空）",
        "PromptCompiler 渲染 system 入口",
      ),
      section(
        "workspace",
        "2 · WORKSPACE",
        workspaceBody || "（未包含）",
        "拼进 system 的工作目录块",
      ),
      section(
        "skills_bake",
        "3 · SKILLS BAKE（烘焙区）",
        skillsBake || "（无 bake 内容）",
        "首轮写入 system、可缓存的 skill 列表",
      ),
      section(
        "tool_instructions",
        "4 · TOOL 区（TOOL.md → system）",
        toolInstructions || "（未加载）",
        "白名单工具的 TOOL.md 合成 <tool_instructions>",
      ),
      section(
        "before_user",
        "5 · BEFORE_USER",
        beforeUserBody || "（无 before_user/before_user.md）",
        "用户新消息轮注入 user 侧，不在 system 字段",
      ),
      section(
        "tool_schemas",
        "6 · TOOL SCHEMAS（API tools）",
        toolSchemasBody || "（未加载）",
        "nativeToolSchemas → 请求 tools 数组",
      ),
      section(
        "compression",
        "7 · COMPRESSION",
        compressionBody || "（无 compression 模板）",
        "上下文压缩用，非每轮 system",
      ),
      section(
        "assembled_system",
        "8 · ASSEMBLED SYSTEM（≈ 实际 system）",
        assembledSystem || "（空）",
        "system + workspace + bake + tool_instructions（不含 before_user / MCP catalog）",
      ),
    ];

    const combined = sections
      .map((s) => {
        const bar = "═".repeat(72);
        const note = s.note ? `\n<!-- ${s.note} -->` : "";
        return `${bar}\n# ${s.title}  (${s.charCount} 字 · ${s.lineCount} 行)${note}\n${bar}\n\n${s.body}\n`;
      })
      .join("\n");

    const text = assembledSystem;
    const tstat = stats(text);

    return {
      ok: true,
      agentName,
      promptRoot,
      entrypoint,
      projectRoot,
      maouRoot,
      sections,
      combined,
      text,
      charCount: tstat.charCount,
      lineCount: tstat.lineCount,
      skillCount,
      toolCount,
    };
  } catch (err) {
    return empty(err instanceof Error ? err.message : String(err));
  }
}
