/**
 * 预览当前 agent「渲染后」的 system 提示词（与 Runtime.run 编译路径对齐）。
 * 仅本地调试用，不写 session、不进 LLM 上下文。
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { PromptCompiler } from "@little-house-studio/prompt";
import { AgentRegistry } from "../agent/registry.js";
import { createAgentSkillManager } from "./skills.js";
import type { AgentSkillOptions } from "./skills.js";

export interface PreviewSystemPromptOptions {
  agentName: string;
  projectRoot?: string;
  maouRoot?: string;
  /** 与 Runtime skillOptions 一致；默认含系统 NPM skills */
  skillOptions?: AgentSkillOptions;
  /**
   * 是否注入 skill 列表 bake（默认 true，与 run 时 system 一致）。
   * 动态 board/pending 等与 session 绑定的内容默认不注入。
   */
  includeSkills?: boolean;
  /** 是否附加 <workspace> 块（默认 true） */
  includeWorkspace?: boolean;
  /**
   * 当 registry 解析的 prompt 入口文件不存在时的回退（例如 CLI 传入 coding 模板 path）。
   * entrypoint 默认 system/system.md。
   */
  fallbackPromptRoot?: string;
  fallbackEntrypoint?: string;
}

/** 入口文件是否真实存在 */
function entryExists(promptRoot: string, entrypoint: string): boolean {
  if (!promptRoot || !entrypoint) return false;
  if (existsSync(join(promptRoot, entrypoint))) return true;
  // 兼容：promptRoot 已是 agent 目录、入口在 prompt/ 下
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

/**
 * 编译当前 agent 的 system prompt 快照（同步、只读）。
 */
export function previewAgentSystemPrompt(
  opts: PreviewSystemPromptOptions,
): PreviewSystemPromptResult {
  const agentName = (opts.agentName || "main").trim() || "main";
  const projectRoot = opts.projectRoot ?? process.cwd();
  const maouRoot = opts.maouRoot ?? join(homedir(), ".maou");
  const includeSkills = opts.includeSkills !== false;
  const includeWorkspace = opts.includeWorkspace !== false;

  let promptRoot = "";
  let entrypoint = "system/system.md";
  let text = "";
  let skillCount = 0;

  try {
    const registry = new AgentRegistry(maouRoot, projectRoot);
    // 1) 项目+全局 registry
    try {
      promptRoot = registry.getPromptRoot(agentName);
      entrypoint = registry.getPromptEntrypoint(agentName);
    } catch {
      /* 下面走回退 */
    }

    // 2) 全局-only registry（项目级只有 raw/ 空壳时）
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

    // 3) 调用方提供的模板回退（CLI coding 模板）
    if (!entryExists(promptRoot, entrypoint) && opts.fallbackPromptRoot) {
      const fr = opts.fallbackPromptRoot;
      const fe = opts.fallbackEntrypoint ?? "system/system.md";
      if (entryExists(fr, fe)) {
        promptRoot = fr;
        entrypoint = fe;
      }
    }

    if (!promptRoot || !existsSync(promptRoot) || !entryExists(promptRoot, entrypoint)) {
      return {
        ok: false,
        text: "",
        agentName,
        promptRoot,
        entrypoint,
        projectRoot,
        maouRoot,
        charCount: 0,
        lineCount: 0,
        skillCount: 0,
        error:
          `无法找到 agent「${agentName}」的 system 提示词入口。` +
          ` 已查: 项目 .maou/agents、全局 ~/.maou/agents` +
          (opts.fallbackPromptRoot ? `、fallback ${opts.fallbackPromptRoot}` : "") +
          `。可先启动一次 agent 完成物化，或检查 ROLE/prompt 目录。`,
      };
    }

    // PromptCompiler 的 promptRoot：若入口在 prompt/ 子树，保持 registry 返回值
    let compileRoot = promptRoot;
    if (
      !existsSync(join(promptRoot, entrypoint)) &&
      existsSync(join(promptRoot, "prompt", entrypoint))
    ) {
      compileRoot = join(promptRoot, "prompt");
    }

    const compiler = new PromptCompiler({
      promptRoot: compileRoot,
      projectRoot,
      entrypoint,
    });
    text = compiler.compile();

    // 工作目录块（与 AgentRuntime.run 一致）
    if (includeWorkspace) {
      text = `${text}\n\n<workspace>\n你当前的工作目录（所有文件读写、终端命令、相对路径均以此为根）：${projectRoot}\n</workspace>`;
    }

    // skill 列表 bake（与 run 首轮 system 注入一致）
    if (includeSkills) {
      try {
        const mgr = createAgentSkillManager(
          agentName,
          projectRoot,
          maouRoot,
          opts.skillOptions,
        );
        const baked = mgr.compile().bakedContent;
        skillCount = mgr.listAvailableSkills().length;
        if (baked) {
          text = `${text}\n\n${baked}`;
        }
      } catch {
        /* skill 失败不阻断预览 */
      }
    }

    return {
      ok: true,
      text,
      agentName,
      promptRoot,
      entrypoint,
      projectRoot,
      maouRoot,
      charCount: text.length,
      lineCount: text.length === 0 ? 0 : text.split("\n").length,
      skillCount,
    };
  } catch (err) {
    return {
      ok: false,
      text: "",
      agentName,
      promptRoot,
      entrypoint,
      projectRoot,
      maouRoot,
      charCount: 0,
      lineCount: 0,
      skillCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
