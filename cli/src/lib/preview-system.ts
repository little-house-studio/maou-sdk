/**
 * CLI 侧预览当前 agent system prompt（EventBlock ↑ 估算、/prompt 弹层共用）
 */

import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  previewAgentSystemPrompt,
  type PreviewSystemPromptResult,
} from "@little-house-studio/agent";
import { userMaouRoot } from "../config/paths.js";
import {
  DEFAULT_AGENT_NAME,
  resolveAgentName,
  usesCodingTemplate,
} from "../config/defaults.js";

const require = createRequire(import.meta.url);

function resolveCodingTemplatePromptRoot(): string | undefined {
  const candidates: string[] = [];
  const here = dirname(fileURLToPath(import.meta.url));
  candidates.push(
    join(here, "..", "..", "..", "agent", "coding-agent", "templates", "coding", "prompt"),
    join(here, "..", "..", "..", "..", "agent", "coding-agent", "templates", "coding", "prompt"),
    join(here, "..", "..", "node_modules", "@little-house-studio", "coding-agent", "templates", "coding", "prompt"),
    join(here, "..", "..", "..", "node_modules", "@little-house-studio", "coding-agent", "templates", "coding", "prompt"),
  );
  try {
    const entry = require.resolve("@little-house-studio/coding-agent");
    let dir = dirname(entry);
    for (let i = 0; i < 6; i++) {
      candidates.push(join(dir, "templates", "coding", "prompt"));
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    /* ignore */
  }
  for (const root of candidates) {
    if (existsSync(join(root, "system", "system.md"))) return root;
  }
  return undefined;
}

/** 渲染当前 agent system 提示词（只读，不进上下文） */
export function previewCurrentSystemPrompt(
  agentName: string,
  projectRoot = process.cwd(),
): PreviewSystemPromptResult {
  const name = resolveAgentName(agentName, DEFAULT_AGENT_NAME);
  const codingTpl = resolveCodingTemplatePromptRoot();
  return previewAgentSystemPrompt({
    agentName: name,
    projectRoot,
    maouRoot: userMaouRoot(),
    fallbackPromptRoot: usesCodingTemplate(name) ? codingTpl : undefined,
    fallbackEntrypoint: "system/system.md",
  });
}
