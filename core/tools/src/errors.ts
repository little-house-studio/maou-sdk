/**
 * Unified tool-failure taxonomy — single source of truth for:
 * - ToolResponse.error (category / code / retryable)
 * - ToolExecutor / registry / Agent pre-gate failures
 * - Built-in tools + MCP bridge soft-fails
 *
 * Pure helpers only (table-testable, no I/O).
 * Mirrors the LLM errors.ts style without coupling to the model layer.
 */

import type { ToolErrorCategory, ToolErrorInfo, ToolResponse } from "@little-house-studio/types";

export type { ToolErrorCategory, ToolErrorInfo };

/** Closed set of shipped categories (table for docs/tests). */
export const TOOL_ERROR_CATEGORIES: readonly ToolErrorCategory[] = [
  "invalid_args",
  "unknown_tool",
  "not_found",
  "mode_denied",
  "policy_denied",
  "sandbox_denied",
  "user_rejected",
  "timeout",
  "dependency_unavailable",
  "precondition",
  "execution",
  "external",
  "cancelled",
  "unknown",
] as const;

/** One-line situation examples for the category table (docs/evidence). */
export const TOOL_ERROR_CATEGORY_EXAMPLES: Readonly<
  Record<ToolErrorCategory, string>
> = {
  invalid_args: "缺少必填参数 path / schema 校验失败 / 非法 action",
  unknown_tool: "ToolRegistry 未注册 / 拼写错误工具名",
  not_found: "文件不存在 / skill 未找到 / 记录 id 不存在",
  mode_denied: "工具 allowedModes 不含当前 agentMode",
  policy_denied: "终端 DCG/硬拒绝 / 钩子拦截 / 安全策略 deny",
  sandbox_denied: "pathGuard 越界 / 流水线 deny 段 / 越出项目根",
  user_rejected: "用户审批拒绝危险命令 / 人工拒绝",
  timeout: "工具执行超时 / 条件扫描超时",
  dependency_unavailable: "sqry/rg/浏览器引擎/Python 未安装",
  precondition: "old_text 未匹配 / 资源已存在 / 状态冲突",
  execution: "工具内部运行时异常 / 写盘失败",
  external: "URL 抓取失败 / MCP isError / 网络搜索后端失败",
  cancelled: "用户中止 / AbortSignal",
  unknown: "无法归类的失败（兜底）",
};

/** Categories that are reasonable to blind-retry by default. */
const RETRYABLE_BY_DEFAULT: ReadonlySet<ToolErrorCategory> = new Set([
  "timeout",
  "external",
  "dependency_unavailable",
]);

export function isRetryableToolCategory(category: ToolErrorCategory): boolean {
  return RETRYABLE_BY_DEFAULT.has(category);
}

export type ToolErrorExtras = {
  code?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
  /** Forwarded onto ToolResponse (payload / displayEvents / …) */
  payload?: Record<string, unknown>;
  displayEvents?: Record<string, unknown>[];
  background?: boolean;
  images?: { mimeType: string; data: string }[];
  message?: string;
};

/**
 * Build structured ToolErrorInfo with default retryable from category.
 */
export function makeToolError(
  category: ToolErrorCategory,
  extras?: ToolErrorExtras,
): ToolErrorInfo {
  const retryable =
    extras?.retryable !== undefined
      ? extras.retryable
      : isRetryableToolCategory(category);
  const info: ToolErrorInfo = { category, retryable };
  if (extras?.code) info.code = extras.code;
  if (extras?.details && Object.keys(extras.details).length > 0) {
    info.details = extras.details;
  }
  return info;
}

/**
 * Preferred constructor for tool failures: always ok:false + error + message.
 */
export function toolFail(
  category: ToolErrorCategory,
  message: string,
  extras?: ToolErrorExtras,
): ToolResponse {
  const msg = (message ?? "").trim() || TOOL_ERROR_CATEGORY_EXAMPLES[category];
  return {
    ok: false,
    message: msg,
    displayEvents: extras?.displayEvents ?? [],
    payload: extras?.payload ?? {},
    background: extras?.background ?? false,
    images: extras?.images ?? [],
    error: makeToolError(category, extras),
  };
}

/**
 * Classify free-form tool error text into a category (heuristic safety net).
 * Prefer explicit toolFail(category, …) at call sites; this is for choke points
 * and migration of legacy createToolResponse(false, msg).
 */
export function classifyToolErrorMessage(message: string): ToolErrorCategory {
  const t = (message ?? "").trim();
  if (!t) return "unknown";

  // Cancelled / abort
  if (/cancel|aborted|中止|已取消|user.?abort|审批被取消/i.test(t)) {
    return "cancelled";
  }

  // Timeout
  if (/超时|timeout|timed?\s*out|ETIMEDOUT|deadline/i.test(t)) return "timeout";

  // User rejection (approval)
  if (
    /用户拒绝|user\s*denied|user\s*reject|审批拒绝|拒绝了该|确认后仍拒绝|系统拦截.*用户拒绝/i.test(
      t,
    ) ||
    /dangerous-user-denied|user-denied|ask-denied|review-reject-user-denied/i.test(t)
  ) {
    return "user_rejected";
  }

  // Sandbox / path guard
  if (
    /路径越界|pathGuard|越过了项目根|流水线隔离|deny\s*段|sandbox|路径被.*拒绝/i.test(t)
  ) {
    return "sandbox_denied";
  }

  // Mode
  if (/模式下不可用|not available in .+ mode|allowedModes/i.test(t)) {
    return "mode_denied";
  }

  // Unknown tool
  if (
    /不支持的工具|Unknown tool|unknown tool|工具不存在|未注册的工具/i.test(t)
  ) {
    return "unknown_tool";
  }

  // Policy / security / hooks
  if (
    /策略拦截|致命指令|危险指令|硬拒绝|hard.?deny|被钩子拦截|安全层|DCG|blacklist|黑名单|policy|deny_fatal|危险·|审核未通过|审核异常|未配置审核器|系统拦截/i.test(
      t,
    )
  ) {
    return "policy_denied";
  }

  // Invalid args / missing params BEFORE external.
  // Tool help text often embeds example URLs (https://example.com); bare http(s)
  // must not steal classification from 缺少必填 / 请提供 / 操作缺少.
  if (
    /缺少必填|必填参数|参数错误|无效 action|无效 scope|未知的? action|未知 action|未知模式|未知 manage_action|格式错误|不能为空|参数.*必填|invalid\s*arg|schema|call requires|No query provided/i.test(
      t,
    ) ||
    /请提供|需要提供|必须提供|必须传|操作缺少|缺少 id|缺少 data|缺少 sessionId|需求描述太短|需求描述过长|无法解析安装源|不支持的操作|不支持的 action|action 为 .* 时|get 需要|write 需要|add 需要|create 需要|send 需要|repair 需要|rebind 需要|output 需要|fork_mode=|action=submit_plan 时必须|failed 时请在/i.test(
      t,
    )
  ) {
    return "invalid_args";
  }

  // External / network / MCP (before not_found so ENOTFOUND ≠ file missing).
  // Do NOT match bare http(s):// alone — that appears in usage examples.
  if (
    /URL\s*读取失败|HTTP\s*请求失败|网络|fetch\s*fail|ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|\bMCP\b/i.test(
      t,
    ) ||
    /search.*fail|backend.*fail|外部|DNS|getaddrinfo|console 采集失败/i.test(t) ||
    // real fetch/URL failures: protocol + failure wording
    (/https?:\/\//i.test(t) &&
      /失败|error|fail|ECONN|ENOTFOUND|timeout|refused|unable to|cannot fetch/i.test(t))
  ) {
    return "external";
  }

  // Dependency missing / not wired / not enabled / wrong mode context
  if (
    /未安装|不可用|not\s*installed|not\s*found.*(binary|engine|sqry|rg|python|browser)|缺少.*引擎|依赖.*不可用|ensure-sqry|ensure-rg|ensure-dcg|language.?server|没有为该文件类型配置|未注入|未启用|暂未开放|服务端正在接入|yield 未启用|执行器未注入|仅在\s*\/goal|监督模式下可用/i.test(
      t,
    )
  ) {
    return "dependency_unavailable";
  }

  // Not found (file/resource/agent/task) — after dependency
  if (
    /文件不存在|ENOENT|no such file|not\s*found|未找到要替换|未找到 toolCallId|图片文件不存在|路径是目录而非文件|未找到队友|未找到 taskId|未找到项目|未找到 skill|未找到匹配|未找到监督|未提供 skill|安装失败:\s*未找到/i.test(
      t,
    ) ||
    /不存在/.test(t)
  ) {
    return "not_found";
  }

  // Precondition / conflict / wrong state / wrong tool for task
  if (
    /已存在|无需编辑|相同|冲突|conflict|precondition|状态不允许|没有可回退|return_when|条件.*失败|当前状态|只能在|只能从|不能 start|不能 submit|必须先|先 start|先 submit|先 verify|用户确认后|多个定义|不唯一|不是目录|无法访问|新路径无效|占位工具不应|plan 未绑定|绑定记录|请用 agent_manage|管理运行中队友/i.test(
      t,
    )
  ) {
    return "precondition";
  }

  // Execution / runtime (broad *失败* including bare suffix 失败)
  if (
    /执行失败|执行异常|写入文件失败|编辑文件失败|创建失败|回退失败|撤销操作失败|安装失败|搜索失败|发送消息失败|删除项目失败|获取项目失败|获取成员失败|获取项目列表失败|获取成员列表失败|消息投递失败|派任务失败|委托.*失败|fork 失败|fork_layer 失败|调用主 Agent 失败|验收模型|辅助模型|yield 提交失败|启动失败|filter 执行失败|spawn|EACCES|EPERM|runtime|失败[:：]|失败$/i.test(
      t,
    )
  ) {
    return "execution";
  }

  return "unknown";
}

/**
 * Classify a thrown value (path-guard Error, timeout Error, …).
 */
export function classifyToolThrown(err: unknown): {
  category: ToolErrorCategory;
  message: string;
  code?: string;
} {
  const message =
    err instanceof Error
      ? err.message
      : err === null || err === undefined
        ? "unknown error"
        : String(err);
  const name = err instanceof Error ? err.name : "";
  let category = classifyToolErrorMessage(message);

  if (name === "AbortError" || /AbortError/i.test(name)) {
    category = "cancelled";
  }
  if (/TimeoutError|Timeout/i.test(name) && category === "unknown") {
    category = "timeout";
  }

  let code: string | undefined;
  if (err && typeof err === "object" && "code" in err) {
    const c = (err as { code?: unknown }).code;
    if (typeof c === "string" || typeof c === "number") code = String(c);
  }
  // Node errno in message
  if (!code) {
    const m = message.match(/\b(ENOENT|EACCES|EPERM|ETIMEDOUT|ECONNREFUSED|ENOTFOUND)\b/);
    if (m) code = m[1];
  }

  // Path-guard explicit markers
  if (/路径越界|pathGuard|越过了项目根|流水线隔离/.test(message)) {
    category = "sandbox_denied";
    code = code ?? "path_sandbox";
  }

  return { category, message, code };
}

/**
 * toolFail from a thrown error (executor catch / tool catch blocks).
 */
export function toolFailFromThrown(
  err: unknown,
  opts?: {
    /** Prefix e.g. "工具 foo 执行异常" */
    prefix?: string;
    fallbackCategory?: ToolErrorCategory;
    extras?: ToolErrorExtras;
  },
): ToolResponse {
  const c = classifyToolThrown(err);
  const category = opts?.fallbackCategory && c.category === "unknown"
    ? opts.fallbackCategory
    : c.category;
  const message = opts?.prefix
    ? `${opts.prefix}: ${c.message}`
    : c.message;
  return toolFail(category, message, {
    ...opts?.extras,
    code: opts?.extras?.code ?? c.code,
  });
}

/**
 * Ensure a ToolResponse that is ok=false carries structured error.
 * Does not alter success responses.
 */
export function ensureToolError(response: ToolResponse): ToolResponse {
  if (response.ok) {
    if (response.error) {
      const { error: _drop, ...rest } = response;
      return rest as ToolResponse;
    }
    return response;
  }
  if (response.error?.category) {
    // fill retryable default if missing
    if (response.error.retryable === undefined) {
      return {
        ...response,
        error: {
          ...response.error,
          retryable: isRetryableToolCategory(response.error.category),
        },
      };
    }
    return response;
  }
  const category = classifyToolErrorMessage(response.message);
  return {
    ...response,
    error: makeToolError(category, {
      code:
        typeof response.payload?.policy === "string"
          ? String(response.payload.policy)
          : undefined,
      details:
        response.payload && Object.keys(response.payload).length > 0
          ? { payloadKeys: Object.keys(response.payload) }
          : undefined,
    }),
  };
}

/** Stream/session prefix (optional; primary truth is ToolResponse.error). */
export const TOOL_ERROR_PREFIX = "[tool_error]";

/**
 * Format: `[tool_error] category=<c> retryable=<0|1> code=<code> | <message>`
 */
export function formatToolErrorForStream(
  error: ToolErrorInfo,
  message: string,
): string {
  const code = error.code ? error.code.replace(/\s+/g, "_") : "-";
  const retryable =
    error.retryable !== undefined
      ? error.retryable
      : isRetryableToolCategory(error.category);
  const retryBit = retryable ? "1" : "0";
  const msg = (message ?? "").replace(/\r?\n/g, " ").slice(0, 500);
  return `${TOOL_ERROR_PREFIX} category=${error.category} retryable=${retryBit} code=${code} | ${msg}`;
}

export function parseToolErrorFromMessage(
  text: string,
): { category: ToolErrorCategory; retryable: boolean; code?: string; message: string } | null {
  if (!text) return null;
  const idx = text.indexOf(TOOL_ERROR_PREFIX);
  if (idx < 0) return null;
  const rest = text.slice(idx + TOOL_ERROR_PREFIX.length).trim();
  const m = rest.match(
    /^category=(\w+)\s+retryable=([01])\s+code=(\S+)\s*\|\s*([\s\S]*)$/,
  );
  if (!m) return null;
  const category = m[1] as ToolErrorCategory;
  if (!TOOL_ERROR_CATEGORIES.includes(category)) return null;
  return {
    category,
    retryable: m[2] === "1",
    code: m[3] === "-" ? undefined : m[3],
    message: (m[4] ?? "").trim() || text,
  };
}
