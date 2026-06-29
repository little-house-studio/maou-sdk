/**
 * Agent PREVIEW 渲染 —— 把模板的 system/before_user/compression 提示词
 * 渲染后写入实例的 .cache/PREVIEW/ 目录，方便开发调试。
 */

import { existsSync, writeFileSync, mkdirSync, watch } from "node:fs";
import { join } from "node:path";
import { PromptCompiler } from "@little-house-studio/prompt";
import { getTemplateRef } from "./template-ref.js";

/**
 * 把 agent 的 system/before_user/compression 提示词渲染后写入 .cache/PREVIEW/。
 *
 * @param agentDir 实例目录
 * @param templateDirOrProjectRoot 如果传入，作为 PromptCompiler 的 projectRoot
 */
export function renderAgentPreview(agentDir: string, templateDirOrProjectRoot?: string): void {
  // 确定实际的 promptRoot
  let promptRoot: string;
  const instancePrompt = join(agentDir, "prompt", "system", "system.md");

  if (existsSync(instancePrompt)) {
    // 实例有覆盖的 system.md
    promptRoot = join(agentDir, "prompt");
  } else {
    // 从 .agent.ref 读模板
    const templateDir = getTemplateRef(agentDir);
    if (templateDir && existsSync(join(templateDir, "prompt", "system", "system.md"))) {
      promptRoot = join(templateDir, "prompt");
    } else {
      // 旧模式：实例目录自身有 prompt/
      promptRoot = join(agentDir, "prompt");
      if (!existsSync(join(promptRoot, "system", "system.md"))) return;
    }
  }

  const previewDir = join(agentDir, ".cache", "PREVIEW");
  mkdirSync(previewDir, { recursive: true });

  const compiler = new PromptCompiler({
    promptRoot,
    projectRoot: templateDirOrProjectRoot ?? process.cwd(),
    entrypoint: "system/system.md",
  });

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

/** 已注册 watch 的 agentDir 集合（去重，避免重复监听）。 */
const _watched = new Set<string>();

/**
 * 监听 agent 模板源文件（system/before_user/compression）变化，自动重新渲染 PREVIEW。
 * 设计要求"检测到上面的内容变了，下面就直接渲染到文件内"。
 * 幂等：同一 agentDir 只 watch 一次。返回取消监听函数。
 */
export function watchAgentPreview(agentDir: string, templateDirOrProjectRoot?: string): () => void {
  if (_watched.has(agentDir)) return () => {};
  _watched.add(agentDir);

  // 确定要监听的 promptRoot（与 renderAgentPreview 同逻辑）
  let promptRoot: string;
  const instancePrompt = join(agentDir, "prompt", "system", "system.md");
  if (existsSync(instancePrompt)) {
    promptRoot = join(agentDir, "prompt");
  } else {
    const templateDir = getTemplateRef(agentDir);
    promptRoot = templateDir && existsSync(join(templateDir, "prompt", "system", "system.md"))
      ? join(templateDir, "prompt")
      : join(agentDir, "prompt");
  }

  const sources = [
    join(promptRoot, "system", "system.md"),
    join(promptRoot, "before_user", "before_user.md"),
    join(promptRoot, "compression", "compression.md"),
  ];

  const watchers = sources
    .filter((p) => existsSync(p))
    .map((p) => {
      // 防抖：fs.watch 可能多次触发，500ms 内合并
      let timer: ReturnType<typeof setTimeout> | undefined;
      const w = watch(p, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          try { renderAgentPreview(agentDir, templateDirOrProjectRoot); } catch { /* ignore */ }
        }, 500);
      });
      return w;
    });

  return () => {
    _watched.delete(agentDir);
    for (const w of watchers) w.close();
  };
}
