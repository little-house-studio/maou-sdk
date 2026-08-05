/**
 * Agent 身份分类（产品主体 vs 附属服务）
 *
 * 产品可切换主体只有两档模板：
 *   - ops    —— 机器级管家（system / global），居无定所
 *   - coding —— 项目级编程（project only），路径语义隔离
 *
 * 附属 / 服务 agent（奴隶）不得升格为可切换主体（自由人）：
 *   - proactive / proactive-scan：挂靠 coding 的驻扎附属
 *   - helper / list_in_manager=false / stationed=true
 *   - 顶层磁盘上的 coding 血统永远不能 group=system
 */

/** 产品模板：仅此二者是「自由人」主体 */
export type ProductAgentTemplate = "ops" | "coding";

/** 挂靠主体的附属驻扎名（非可切换） */
export const STATIONED_AFFILIATE_AGENT_NAMES = [
  "proactive",
  "proactive-scan",
  "doc-copilot",
] as const;

export type StationedAffiliateAgentName =
  (typeof STATIONED_AFFILIATE_AGENT_NAMES)[number];

export function isStationedAffiliateAgentName(name: string): boolean {
  const n = (name || "").trim().toLowerCase();
  return (STATIONED_AFFILIATE_AGENT_NAMES as readonly string[]).includes(n);
}

/**
 * coding 身份：驻扎项目、管 LSP / 结构树。
 * **永远不能作为 system agent**。
 */
export function isCodingAgentIdentity(
  name: string,
  role?: string,
  displayName?: string,
): boolean {
  const n = (name || "").trim().toLowerCase();
  if (n === "coding") return true;
  const r = (role || "").trim().toLowerCase();
  if (r === "coding" || r.includes("coding")) return true;
  const d = (displayName || "").trim().toLowerCase();
  if (d === "coding agent" || d.includes("coding agent")) return true;
  // 常见历史别名：main + 编程角色
  if ((role || "").includes("编程") && n !== "ops") {
    if (n === "main" || n === "code" || n === "coder") return true;
  }
  return false;
}

/** 产品模板名（磁盘/模板级，不含附属） */
export function isProductAgentTemplateName(name: string): boolean {
  const n = (name || "").trim().toLowerCase();
  return n === "ops" || n === "coding";
}

/**
 * 可作为「系统 / 本机」可切换主体的 agent（ops 管家等）。
 * 绝非 coding、绝非附属驻扎。
 */
export function isAllowedSystemAgent(
  name: string,
  role?: string,
  displayName?: string,
): boolean {
  if (isStationedAffiliateAgentName(name)) return false;
  if (isCodingAgentIdentity(name, role, displayName)) return false;
  return true;
}

/**
 * 磁盘 agent 条目是否允许出现在「可切换主体」列表。
 * 尊重 list_in_manager / stationed / parent / 附属名。
 */
export function isSwitchableSubjectAgent(entry: {
  name?: string;
  role?: string;
  display_name?: string;
  parent?: string;
  list_in_manager?: unknown;
  stationed?: unknown;
  scope?: string;
}): boolean {
  const name = String(entry.name || "").trim();
  if (!name) return false;
  if (isStationedAffiliateAgentName(name)) return false;
  if (entry.list_in_manager === false) return false;
  if (entry.stationed === true) return false;
  // 有 parent 的是 subagent 血缘，不是顶层自由人（列表里可作 children，由调用方决定）
  return true;
}

/** 系统列表：可切换 + 允许 system */
export function isSwitchableSystemAgent(entry: {
  name?: string;
  role?: string;
  display_name?: string;
  parent?: string;
  list_in_manager?: unknown;
  stationed?: unknown;
}): boolean {
  if (!isSwitchableSubjectAgent(entry)) return false;
  const name = String(entry.name || "").trim();
  // 顶层系统主体不应带 parent
  if (entry.parent && String(entry.parent).trim()) return false;
  return isAllowedSystemAgent(
    name,
    String(entry.role || ""),
    String(entry.display_name || ""),
  );
}
