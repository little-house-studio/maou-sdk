/**
 * Agent 层工具预检/失败结果构造（纯函数，与 Runtime 预门共用）。
 * 保证 missing-params / hook-block / execute-throw 与 tools 层 taxonomy 一致。
 */

import {
  toolFail,
  toolFailFromThrown,
  type ToolResponse,
  type ToolErrorInfo,
} from "@little-house-studio/tools";

/**
 * 从工具 schema.required + 调用参数收集缺失必填项。
 * 与 AgentRuntime.collectMissingRequiredParams 同逻辑（权威实现在此，runtime 调用）。
 */
export function collectMissingRequiredParams(
  tool:
    | {
        definition?: {
          parameters?: { required?: unknown };
        };
      }
    | null
    | undefined,
  params: Record<string, unknown> | null | undefined,
): string[] {
  try {
    if (!tool) return [];
    const required = tool.definition?.parameters?.required;
    if (!Array.isArray(required) || required.length === 0) return [];
    const p = params ?? {};
    const missing: string[] = [];
    for (const key of required) {
      if (typeof key !== "string") continue;
      const v = p[key];
      if (v === undefined || v === null || v === "") missing.push(key);
    }
    return missing;
  } catch {
    return [];
  }
}

/** Agent 预检：缺必填参数 → invalid_args / missing_params */
export function missingRequiredToolResponse(
  toolName: string,
  missing: string[],
): ToolResponse {
  return toolFail(
    "invalid_args",
    `❌ 工具 ${toolName} 缺少必填参数: ${missing.join(", ")}\n` +
      `请重新调用并填写上述参数。如果你不想调用任何工具，请直接回复文本，不要生成缺参数的工具调用。`,
    {
      code: "missing_params",
      details: { toolName, missing },
    },
  );
}

/** pre_tool_use 钩子拦截 → policy_denied / hook_blocked */
export function hookBlockedToolResponse(
  toolName: string,
  reason?: string | null,
): ToolResponse {
  return toolFail(
    "policy_denied",
    (reason ?? "").trim() || `工具 ${toolName} 被钩子拦截`,
    {
      code: "hook_blocked",
      details: { toolName },
    },
  );
}

/** execute 抛错 → 归类后的失败响应 */
export function executeThrownToolResponse(
  toolName: string,
  err: unknown,
): ToolResponse {
  return toolFailFromThrown(err, {
    prefix: "工具执行失败",
    fallbackCategory: "execution",
    extras: { details: { toolName } },
  });
}

export type { ToolErrorInfo, ToolResponse };
