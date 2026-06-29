/**
 * Agent PREVIEW 渲染 —— 把模板的 system/before_user/compression 提示词
 * 渲染后写入实例的 .cache/PREVIEW/ 目录，方便开发调试。
 */

import { existsSync, writeFileSync, mkdirSync } from "node:fs";
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
