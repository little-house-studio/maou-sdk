/**
 * allowedModes 门控。plan 与 execute 同一套工具。
 */

export function toolAllowedInAgentMode(
  allowed: string[] | null,
  agentMode: string,
): boolean {
  if (allowed == null) return true;
  if (agentMode === "plan" || agentMode === "execute") {
    return allowed.includes("plan") || allowed.includes("execute");
  }
  return allowed.includes(agentMode);
}
