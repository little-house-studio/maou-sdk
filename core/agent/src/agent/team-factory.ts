/**
 * Team Factory —— 从团队模板一键物化多 Agent 协作团队。
 *
 * 复用已有 SDK 零件（DRY）：
 *   - createAgentFromTemplate()：主 Agent 用引用模式物化（写 .agent.ref）
 *   - 现有 templates/subagents/* 子 Agent 模板：复制到主 Agent 的 subagents/ 目录
 *   - SubagentRegistry：运行时自动扫描 subagents/ 发现 + 注册委托工具
 *
 * 一个团队 = 一个主 Agent + N 个子 Agent（放主 Agent 的 subagents/ 下）。
 * 物化后无需额外注册——AgentRuntime.run() 时 SubagentRegistry.loadForAgent()
 * 自动发现 subagents/，createSubagentDelegateTool 为每个子 Agent 生成 subagent_<name> 工具。
 */

import { readFileSync, existsSync, mkdirSync, cpSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentFromTemplate } from "./template.js";

// ─── 类型 ──────────────────────────────────────────────────────────────────

export interface TeamSubagentSpec {
  name: string;
  /** 相对 templates 根的子 Agent 模板路径（如 "subagents/explore"）。 */
  from_template: string;
  display_name?: string;
  role?: string;
  description?: string;
}

export interface TeamMainSpec {
  name: string;
  display_name?: string;
  role?: string;
  preset?: string;
  /** 主 Agent 用的 agent 模板名（对应 templates/agent 下的子目录，默认用 coding-agent 的 coding 模板）。 */
  template?: string;
}

export interface TeamTemplate {
  name: string;
  description?: string;
  main: TeamMainSpec;
  subagents: TeamSubagentSpec[];
}

export interface CreateTeamResult {
  teamName: string;
  mainAgentDir: string;
  subagentDirs: string[];
  created: boolean;
  message: string;
}

// ─── 模板目录解析 ──────────────────────────────────────────────────────────

/**
 * 解析 agent 包自带的 templates 根目录。
 *
 * dist 结构可能不同（core/agent 编译到 dist/agent/team-factory.js，需回溯 ../../；
 * coding-agent 编译到 dist/index.js，回溯 ../ 即可）。这里两个候选都试，
 * 取实际存在的那个，兼容两种打包布局。
 */
function resolveTemplatesRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "..", "..", "templates"), join(here, "..", "templates")];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // 都不存在时返回默认（调用方 existsSync 会给出友好错误）
  return candidates[0]!;
}

/** 读取团队模板定义（templates/teams/<name>/team.json）。 */
export function loadTeamTemplate(teamName: string): TeamTemplate {
  const teamFile = join(resolveTemplatesRoot(), "teams", teamName, "team.json");
  if (!existsSync(teamFile)) {
    throw new Error(`团队模板不存在: ${teamName}（查找路径: ${teamFile}）`);
  }
  return JSON.parse(readFileSync(teamFile, "utf-8")) as TeamTemplate;
}

/** 列出所有可用团队模板名。 */
export function listTeamTemplates(): string[] {
  const teamsDir = join(resolveTemplatesRoot(), "teams");
  if (!existsSync(teamsDir)) return [];
  return readdirSync(teamsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(join(teamsDir, name, "team.json")));
}

// ─── 一键物化 ──────────────────────────────────────────────────────────────

/**
 * 从团队模板物化整个团队到 <maouRoot>/agents/。
 *
 * - 主 Agent：复用 createAgentFromTemplate（引用模式，不复制模板文件）
 * - 子 Agent：把 templates/<from_template> 整目录复制到 <mainDir>/subagents/<name>/
 *   （SubagentRegistry 要求 subagents/<child>/ 下有 agent.json + ROLE/SYSTEM.md 等）
 *
 * 幂等：已存在则跳过（不覆盖用户编辑）。
 */
export function createTeamFromTemplate(
  teamName: string,
  maouRoot: string,
  opts: { mainTemplateDir?: string } = {},
): CreateTeamResult {
  const team = loadTeamTemplate(teamName);
  const templatesRoot = resolveTemplatesRoot();
  const agentsRoot = join(maouRoot, "agents");
  mkdirSync(agentsRoot, { recursive: true });

  // ── 1. 物化主 Agent（复用 createAgentFromTemplate 引用模式）──
  // 主 Agent 模板目录：优先用 opts.mainTemplateDir，否则回退 templates/agent
  const mainTemplateDir =
    opts.mainTemplateDir ?? join(templatesRoot, "agent");
  const mainAgentDir = createAgentFromTemplate(team.main.name, maouRoot, {
    templateDir: mainTemplateDir,
    displayName: team.main.display_name,
    role: team.main.role,
  });

  // ── 2. 物化子 Agent：复制模板到主 Agent 的 subagents/ 下 ──
  const subagentsDir = join(mainAgentDir, "subagents");
  mkdirSync(subagentsDir, { recursive: true });
  const subagentDirs: string[] = [];

  for (const sub of team.subagents) {
    const subTarget = join(subagentsDir, sub.name);
    const subSource = join(templatesRoot, sub.from_template);
    if (!existsSync(subSource)) {
      throw new Error(`子 Agent 模板不存在: ${sub.from_template}（路径: ${subSource}）`);
    }
    // 幂等：已存在则跳过
    if (existsSync(join(subTarget, "agent.json"))) {
      subagentDirs.push(subTarget);
      continue;
    }
    cpSync(subSource, subTarget, { recursive: true });
    subagentDirs.push(subTarget);
  }

  return {
    teamName: team.name,
    mainAgentDir,
    subagentDirs,
    created: true,
    message:
      `团队「${team.name}」已物化：主 Agent ${team.main.name}` +
      ` + ${subagentDirs.length} 个子 Agent（${team.subagents.map((s) => s.name).join("/")})。\n` +
      `运行时 SubagentRegistry 会自动发现 subagents/ 并注册 subagent_<name> 委托工具。`,
  };
}
