/**
 * Agent 首次实例化概述（overview）。
 *
 * 落盘：
 *   <agentDir>/OVERVIEW.md  — 人读
 *   agent.custom.json.overview / agent.json.overview — 机读
 *
 * 首次创建时写模板概述；若注入 LLM 则可异步润色（不阻塞启动）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function overviewPath(agentDir: string): string {
  return join(agentDir, "OVERVIEW.md");
}

export function readAgentOverview(agentDir: string): string | null {
  const md = overviewPath(agentDir);
  if (existsSync(md)) {
    try {
      const text = readFileSync(md, "utf-8").trim();
      // 跳过 # 标题行与 _meta_ 行，取第一段正文
      for (const line of text.split("\n")) {
        const raw = line.trim();
        if (!raw || raw.startsWith("#") || raw.startsWith("_")) continue;
        return raw.slice(0, 120);
      }
    } catch { /* ignore */ }
  }
  for (const name of ["agent.custom.json", "agent.json"]) {
    const p = join(agentDir, name);
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, "utf-8")) as {
        overview?: string;
        description?: string;
        notes?: string;
      };
      const o = (j.overview || j.description || j.notes || "").trim();
      if (o) return o.slice(0, 120);
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * 首次实例化时写入概述。已存在 OVERVIEW.md 则不覆盖（用户/AI 可改）。
 */
export function ensureAgentOverview(
  agentDir: string,
  opts: {
    name: string;
    displayName?: string;
    role?: string;
    scope?: string;
    projectPath?: string;
    /** 已有描述优先 */
    seed?: string;
  },
): string {
  mkdirSync(agentDir, { recursive: true });
  const existing = readAgentOverview(agentDir);
  if (existing) return existing;

  const title = opts.displayName || opts.name;
  const where = opts.projectPath
    ? `项目 ${opts.projectPath}`
    : opts.scope === "global"
      ? "机器级全局"
      : "当前工作区";
  const role = opts.role || "assistant";
  const seed = (opts.seed || "").trim();
  const overview =
    seed ||
    `${title}（${role}）· ${where} · 首次实例化于 ${new Date().toISOString().slice(0, 10)}`;

  const md = [
    `# ${title}`,
    "",
    overview,
    "",
    `_generated on first materialize_`,
    "",
  ].join("\n");
  writeFileSync(overviewPath(agentDir), md, "utf-8");

  // 合并进 agent.custom.json
  try {
    const customPath = join(agentDir, "agent.custom.json");
    let custom: Record<string, unknown> = {};
    if (existsSync(customPath)) {
      custom = JSON.parse(readFileSync(customPath, "utf-8")) as Record<string, unknown>;
    }
    if (!custom.overview) {
      custom.overview = overview;
      custom.updated_at = new Date().toISOString();
      writeFileSync(customPath, JSON.stringify(custom, null, 2), "utf-8");
    }
  } catch { /* ignore */ }

  return overview;
}

/**
 * 用辅助模型润色概述（可选，失败静默保留 seed）。
 */
export async function refineAgentOverviewWithLlm(
  agentDir: string,
  call: (prompt: string) => Promise<string>,
): Promise<string | null> {
  const current = readAgentOverview(agentDir);
  if (!current) return null;
  // 已润色过则跳过
  if (existsSync(join(agentDir, ".overview-refined"))) return current;
  try {
    const refined = (
      await call(
        `用一句中文（≤40字）概括这个 Agent 的职责，不要标点堆砌，不要引号：\n${current}`,
      )
    )
      .trim()
      .replace(/^["「]|["」]$/g, "")
      .slice(0, 80);
    if (!refined) return current;
    writeFileSync(
      overviewPath(agentDir),
      `# Overview\n\n${refined}\n\n_refined_\n`,
      "utf-8",
    );
    writeFileSync(join(agentDir, ".overview-refined"), new Date().toISOString(), "utf-8");
    try {
      const customPath = join(agentDir, "agent.custom.json");
      let custom: Record<string, unknown> = {};
      if (existsSync(customPath)) {
        custom = JSON.parse(readFileSync(customPath, "utf-8")) as Record<string, unknown>;
      }
      custom.overview = refined;
      writeFileSync(customPath, JSON.stringify(custom, null, 2), "utf-8");
    } catch { /* ignore */ }
    return refined;
  } catch {
    return current;
  }
}
