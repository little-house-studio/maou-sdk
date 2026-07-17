/**
 * MCP 调用前本地参数校验（轻量 JSON Schema 子集）。
 *
 * 目的：参数填错时不要直接转给 server 等含糊错误，而是立刻回给模型
 * 「缺什么 / 类型不对 / 完整 schema」，便于下一轮重填。
 *
 * 覆盖：type / properties / required / enum / items / additionalProperties。
 * 非完整 JSON Schema 实现；校验不过时 fail-closed（不调 tools/call）。
 */

import type { JsonSchema } from "@little-house-studio/types";
import { createToolResponse } from "@little-house-studio/tools";
import type { ToolResponse } from "@little-house-studio/tools";

export interface McpArgIssue {
  path: string;
  message: string;
}

export interface McpArgValidationResult {
  ok: boolean;
  issues: McpArgIssue[];
}

function pathJoin(base: string, key: string): string {
  if (!base) return key;
  if (key.startsWith("[")) return `${base}${key}`;
  return `${base}.${key}`;
}

function typeOfValue(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

function validateNode(
  schema: Record<string, unknown> | undefined,
  value: unknown,
  path: string,
  issues: McpArgIssue[],
): void {
  if (!schema || typeof schema !== "object") return;

  if (schema.const !== undefined && value !== schema.const) {
    issues.push({
      path: path || "(root)",
      message: `expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`,
    });
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const ok = schema.enum.some((e) => Object.is(e, value) || e === value);
    if (!ok) {
      issues.push({
        path: path || "(root)",
        message: `must be one of ${JSON.stringify(schema.enum)}, got ${JSON.stringify(value)}`,
      });
    }
  }

  const typeField = schema.type;
  if (typeof typeField === "string") {
    if (!matchesType(value, typeField)) {
      issues.push({
        path: path || "(root)",
        message: `expected type ${typeField}, got ${typeOfValue(value)}`,
      });
      return; // 类型不对时不再深挖
    }
  } else if (Array.isArray(typeField)) {
    const ok = typeField.some((t) => typeof t === "string" && matchesType(value, t));
    if (!ok) {
      issues.push({
        path: path || "(root)",
        message: `expected type ${typeField.join("|")}, got ${typeOfValue(value)}`,
      });
      return;
    }
  }

  if (matchesType(value, "object") && value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = Array.isArray(schema.required)
      ? schema.required.filter((x): x is string => typeof x === "string")
      : [];

    for (const key of required) {
      if (!(key in obj) || obj[key] === undefined) {
        issues.push({
          path: pathJoin(path, key),
          message: "required property missing",
        });
      }
    }

    const additional = schema.additionalProperties;
    for (const [key, child] of Object.entries(obj)) {
      if (key in props) {
        validateNode(props[key], child, pathJoin(path, key), issues);
      } else if (additional === false) {
        issues.push({
          path: pathJoin(path, key),
          message: "property not allowed (additionalProperties: false)",
        });
      } else if (additional && typeof additional === "object") {
        validateNode(additional as Record<string, unknown>, child, pathJoin(path, key), issues);
      }
    }
  }

  if (Array.isArray(value) && schema.items && typeof schema.items === "object") {
    const itemSchema = schema.items as Record<string, unknown>;
    value.forEach((item, i) => {
      validateNode(itemSchema, item, pathJoin(path, `[${i}]`), issues);
    });
  }
}

/**
 * 校验 MCP tool arguments 是否符合 inputSchema。
 * schema 为空 / 无 properties+required 时放行（server 可能用宽松 schema）。
 */
export function validateMcpToolArgs(
  schema: JsonSchema | Record<string, unknown> | null | undefined,
  args: Record<string, unknown> | null | undefined,
): McpArgValidationResult {
  const issues: McpArgIssue[] = [];
  const s = (schema && typeof schema === "object" ? schema : {}) as Record<string, unknown>;
  const a = args && typeof args === "object" && !Array.isArray(args) ? args : {};

  // 无约束时不拦
  const hasProps =
    s.properties && typeof s.properties === "object" && Object.keys(s.properties as object).length > 0;
  const hasRequired = Array.isArray(s.required) && s.required.length > 0;
  const hasType = typeof s.type === "string" || Array.isArray(s.type);
  if (!hasProps && !hasRequired && !hasType && s.enum == null && s.const === undefined) {
    return { ok: true, issues: [] };
  }

  // 根必须是 object（MCP tool args 约定）
  const rootSchema: Record<string, unknown> = {
    ...s,
    type: s.type ?? "object",
  };
  validateNode(rootSchema, a, "", issues);

  return { ok: issues.length === 0, issues };
}

function compactSchema(schema: unknown, maxLen = 4000): string {
  try {
    const raw = JSON.stringify(schema, null, 2);
    if (raw.length <= maxLen) return raw;
    return raw.slice(0, maxLen) + "\n…(schema truncated)";
  } catch {
    return String(schema);
  }
}

/**
 * 校验失败 → ToolResponse（ok:false），含 issues + 完整 schema，引导模型重填。
 */
export function formatMcpArgValidationError(opts: {
  toolLabel: string;
  connectionName?: string;
  originalName?: string;
  schema: JsonSchema | Record<string, unknown> | null | undefined;
  args: Record<string, unknown> | null | undefined;
  issues: McpArgIssue[];
  /** gateway 时提示先 schema 再 call */
  viaGateway?: boolean;
}): ToolResponse {
  const lines: string[] = [
    `MCP argument validation failed for ${opts.toolLabel}.`,
    "Do NOT guess — fix arguments using the schema below and call again.",
    "",
    "Issues:",
  ];
  for (const issue of opts.issues) {
    lines.push(`  - ${issue.path}: ${issue.message}`);
  }
  lines.push("");
  lines.push("Your arguments were:");
  try {
    lines.push(JSON.stringify(opts.args ?? {}, null, 2));
  } catch {
    lines.push(String(opts.args));
  }
  lines.push("");
  lines.push("Expected inputSchema (JSON Schema):");
  lines.push(compactSchema(opts.schema ?? { type: "object", properties: {} }));
  if (opts.viaGateway) {
    lines.push("");
    lines.push(
      "Tip: use mcp action=list with name=\"mcp__server__tool\" to re-fetch schema, then action=call with corrected arguments.",
    );
  } else {
    lines.push("");
    lines.push(
      "Tip: re-invoke this tool with corrected parameters matching the schema (required fields and types).",
    );
  }

  return createToolResponse(false, lines.join("\n"), {
    payload: {
      mcp: true,
      mcpValidationError: true,
      mcpConnection: opts.connectionName,
      mcpTool: opts.originalName,
      issues: opts.issues,
      receivedArguments: opts.args ?? {},
      inputSchema: opts.schema ?? null,
    },
    displayEvents: [
      {
        type: "terminal",
        stream: "error",
        text: `[MCP] ${opts.toolLabel}: invalid arguments (${opts.issues.length} issue(s))`,
      },
    ],
  });
}

/**
 * 校验；失败返回 ToolResponse，成功返回 null（继续调用）。
 */
export function rejectIfMcpArgsInvalid(opts: {
  toolLabel: string;
  connectionName?: string;
  originalName?: string;
  schema: JsonSchema | Record<string, unknown> | null | undefined;
  args: Record<string, unknown> | null | undefined;
  viaGateway?: boolean;
}): ToolResponse | null {
  const result = validateMcpToolArgs(opts.schema, opts.args);
  if (result.ok) return null;
  return formatMcpArgValidationError({
    ...opts,
    issues: result.issues,
  });
}
