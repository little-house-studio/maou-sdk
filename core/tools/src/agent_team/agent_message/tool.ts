/**
 * Subagent 工具 — 创建克隆子 Agent
 *
 * 创建克隆子 Agent 处理独立任务。继承 ROLE 模板，注册为项目专属 Agent。
 */

import { Tool, toolDir, resolveToolRuntimePorts } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";
import type { ForkOptions } from "@little-house-studio/types";
import { loadSubagentKindOptionsFromCtx } from "../subagent-kind-options.js";

export class SubagentTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "agent_message",
    aliases: ["subagent_creat", "subagent-create", "clone-agent"],
    description:
      "fork 子 Agent 执行独立任务。子 Agent 是主 Agent 的轻量克隆，或 context_and_config 指向已有 agent/模板。" +
      "适用：代码探索(explore)、网络调研(research)、测试(tester) 等。" +
      "与运行中子 agent 再通信请用 agent_send（派活/插话/中断/停止）。" +
      "todo 并行层由 harness 自动调度，不要用本工具开并行层。" +
      "detached=true 后台跑，可用 agent_manage list 查进度。依赖 runtime.setSubagentExecutor()。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["fork", "create"],
          description: "fork/create: fork 单个子 Agent（同义）",
        },
        name: { type: "string", description: "子 Agent 唯一名称（fork 时作为 taskId，可省略自动生成）" },
        task: { type: "string", description: "分配给子 Agent 的任务描述（fork 必填）" },
        description: { type: "string", description: "子 Agent 角色说明（可选）" },
        fork_mode: {
          type: "string",
          enum: ["context_only", "context_and_config"],
          description:
            "fork 模式（默认 context_only）：" +
            "context_only = 子 Agent 继承主 Agent 配置（仅 session 独立）；" +
            "context_and_config = 子 Agent 用独立 agent 配置（需同时指定 agent_name）",
        },
        agent_name: {
          type: "string",
          description:
            "fork_mode='context_and_config' 时必填：子 Agent 使用的 agent 名（必须是 AgentRegistry 中已存在的 agent）",
        },
        // ── ForkOptions 透出（engine 已支持，工具层补暴露） ──
        max_recursion_depth: {
          type: "number",
          description:
            "子 Agent 再 fork 子 Agent 的层数上限（默认 2）。0 = 禁止任何 fork。" +
            "控制嵌套深度防失控；一般无需调高。",
        },
        timeout_ms: {
          type: "number",
          description:
            "子 Agent 执行的 wall-clock 超时（毫秒）。超时后触发 wrap-up 提示让子 Agent 收尾，" +
            "再超 1.5x 强制 abort。建议长任务设 60000-300000。",
        },
        soft_budget: {
          type: "number",
          description:
            "软请求预算（LLM 请求次数）。超过后注入 wrap-up 提示，超过 1.5x 强制 abort。" +
            "防止子 Agent 死循环烧 token。",
        },
        output_schema: {
          type: "object",
          description:
            "校验子 Agent yield 提交结果的 JSON Schema（P2-1）。" +
            "设置后：yield 的 result 会按此 schema 校验，失败则注入反馈让子 Agent 重试（最多若干次）。" +
            "用于强制子 Agent 返回结构化数据。detached=true 时无效（结果异步到达）。",
        },
        detached: {
          type: "boolean",
          description:
            "是否后台 detached 运行（默认 false）。true = 立即返回不阻塞，子 Agent 后台跑，" +
            "结果通过 lifecycle 事件总线异步上报，可用 agent_manage list 或事件流查进度。" +
            "适合 fire-and-forget 的长任务。仅对 action=fork 有效。",
        },
        isolated: {
          type: "boolean",
          description:
            "是否在 git worktree 隔离环境运行（默认 false）。true = 子 Agent 改动与主工作区完全隔离，" +
            "结束后按 merge_back/patch_back 回收。仅 fork_mode='context_only' 且 git 仓库有效。",
        },
        merge_back: {
          type: "boolean",
          description: "isolated=true 结束后是否 merge 回主分支（默认 false）。仅 isolated=true 生效。",
        },
        patch_back: {
          type: "boolean",
          description: "isolated=true 结束后是否生成 patch 文件（默认 false）。仅 isolated=true 且 merge_back=false 生效。",
        },
        inherit_mcp: {
          type: "boolean",
          description: "是否继承父 Agent 的 MCP 工具（默认 true）。false = 子 Agent 不继承父 MCP（自建连或无）。",
        },
        config_overrides: {
          type: "object",
          description:
            "临时覆盖 agent.json 字段（如 system prompt / tool 白名单 / model）。" +
            "仅 fork_mode='context_and_config' 生效，会创建临时 agent 文件，子 session 结束清理。",
        },
        // ── 四类 subagent kind ──
        kind: {
          type: "string",
          enum: ["fork", "helper", "task", "project"],
          description:
            "子 Agent 类型（默认 fork）：" +
            "fork=完整复制母上下文；helper=单轮无 tool（非持久走 Aux）；" +
            "task=专业子任务+预设白名单；project=路径驻扎小型 coding agent。",
        },
        tool_preset: {
          type: "string",
          enum: ["explore", "web_search", "report", "file_search", "coding_scoped", "none"],
          description: "task/project 工具白名单预设。",
        },
        persist_context: {
          type: "boolean",
          description:
            "是否持久化（helper 默认 false；仅 true 时进管理列表与 Executor）。",
        },
        path: {
          type: "string",
          description: "project 驻扎路径（project 建议必填）。硬约束由 PathGuard 执行。",
        },
        audit_paths: {
          type: "array",
          items: { type: "string" },
          description: "project 域外审核路径列表（audit 模式可读写但标记 needsAudit）。",
        },
        enable_loop: {
          type: "boolean",
          description: "是否 multi-round loop（helper 默认 false）。",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const action = String(params.action ?? "").trim().toLowerCase();
    const name = String(params.name ?? "").trim();
    const task = String(params.task ?? "").trim();
    // detail=角色说明；description=调用任务简介（CLI 折叠标题）
    const roleDetail = String(params.detail ?? "").trim();
    // fork 选项
    const forkMode = params.fork_mode === "context_and_config" ? "context_and_config" : "context_only";
    const agentName = String(params.agent_name ?? "").trim() || undefined;
    // forkMode='context_and_config' 必须传 agent_name
    if (forkMode === "context_and_config" && !agentName) {
      return createToolResponse(false, "fork_mode='context_and_config' 时必须传 agent_name（指定子 Agent 使用的 agent 配置）。");
    }
    // 组装完整 ForkOptions；若指定了 agent_name 且未显式 kind，从 agent.json 继承策略
    const forkOptions = this.buildForkOptions(params, forkMode, agentName, ctx);

    // fork：真并行执行子 Agent（依赖 ctx.subagentExecutor 由 runtime 注入）
    if (action === "fork" || action === "create") {
      return this.doFork(name || undefined, task, roleDetail, ctx, forkOptions);
    }

    if (action === "fork_layer") {
      return createToolResponse(
        false,
        "fork_layer 不是工具。todo 并行层由 harness 自动调度，不要由模型调用。",
      );
    }

    return createToolResponse(
      false,
      `不支持的操作: ${action}。支持: fork / create（同义，fork 单个子 Agent）。` +
        `\n结果：非 detached 的 fork 返回值里已有「── 输出 ──」；后台任务用 agent_manage list 看进度；` +
        `再说话/停止用 agent_send。`,
    );
  }

  /**
   * fork 单个子 Agent 执行独立任务（真并行）。
   * 依赖 ctx.subagentExecutor —— 由 AgentRuntime 注入 SubagentExecutor 实例。
   */
  private async doFork(
    name: string | undefined,
    task: string,
    _description: string,
    ctx: ToolContext,
    forkOptions: ForkOptions,
  ): Promise<ToolResponse> {
    if (!task) return createToolResponse(false, "请提供 task（分配给子 Agent 的任务描述）。");
    const ports = resolveToolRuntimePorts(ctx);
    if (!ports.subagentExecutor) {
      return createToolResponse(
        false,
        "子 Agent 执行器未注入。harness 需通过 runtime.setSubagentExecutor() 注入。" +
          "如未配置，请改用 todo_manage + todo_finish 串行执行。",
      );
    }

    const taskId = name || `task-${Date.now().toString(36)}`;
    const detached = forkOptions.detached === true;
    try {
      const result = await ports.subagentExecutor.fork(taskId, task, forkOptions);
      const status = result.ok ? "✅" : "❌";
      const lines = [
        detached
          ? `${status} 子 Agent 已后台启动（detached，结果异步到达）`
          : `${status} 子 Agent 执行完成（${result.elapsedMs}ms）`,
        `taskId: ${result.taskId}`,
        `subSessionId: ${result.subSessionId}`,
        `forkMode: ${forkOptions.forkMode ?? "context_only"}${forkOptions.agentName ? ` (agent=${forkOptions.agentName})` : ""}`,
        detached ? `（后台运行中，可用 agent_manage list 或事件流查进度）` : "",
        result.error ? `error: ${result.error}` : "",
        "── 输出 ──",
        result.output || "(无输出)",
      ].filter(Boolean);
      return createToolResponse(result.ok, lines.join("\n"), {
        payload: { result },
        displayEvents: [{ type: "terminal", stream: "info", text: `[子 Agent] ${taskId}${detached ? " 已后台启动" : " 完成"}: ok=${result.ok}` }],
      });
    } catch (err) {
      return createToolResponse(false, `fork 失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 把 LLM 传入的 snake_case 参数组装成完整 ForkOptions（camelCase）。
   * engine 已支持全部字段，这里只做映射，不重写逻辑（DRY）。
   * 未传的字段保持 undefined，由 engine 用默认值。
   */
  private buildForkOptions(
    params: Record<string, unknown>,
    forkMode: "context_only" | "context_and_config",
    agentName?: string,
    ctx?: ToolContext,
  ): ForkOptions {
    // 1) 磁盘策略（指定 agent_name 时）
    const fromDisk =
      agentName && ctx
        ? loadSubagentKindOptionsFromCtx(ctx, agentName, "task")
        : {};

    // 2) kind：显式 > 磁盘 > 默认 fork（无 agent_name 的克隆场景）
    const explicitKind =
      params.kind !== undefined &&
      params.kind !== null &&
      String(params.kind).trim() !== "";
    let kind: ForkOptions["kind"] = "fork";
    if (explicitKind) {
      const kindRaw = String(params.kind).trim().toLowerCase();
      kind =
        kindRaw === "helper" || kindRaw === "task" || kindRaw === "project" || kindRaw === "fork"
          ? (kindRaw as ForkOptions["kind"])
          : "fork";
    } else if (agentName) {
      kind = fromDisk.kind ?? "task";
    }

    const opts: ForkOptions = {
      ...fromDisk,
      forkMode,
      agentName,
      kind,
    };

    // 3) 通用 fork 参数
    if (params.max_recursion_depth !== undefined && params.max_recursion_depth !== null) {
      const n = Number(params.max_recursion_depth);
      if (!Number.isNaN(n)) opts.maxRecursionDepth = n;
    }
    if (params.timeout_ms !== undefined && params.timeout_ms !== null) {
      const n = Number(params.timeout_ms);
      if (!Number.isNaN(n)) opts.maxRuntimeMs = n;
    }
    if (params.soft_budget !== undefined && params.soft_budget !== null) {
      const n = Number(params.soft_budget);
      if (!Number.isNaN(n)) opts.softRequestBudget = n;
    }
    if (params.output_schema && typeof params.output_schema === "object") {
      opts.outputSchema = params.output_schema as Record<string, unknown>;
    }
    if (params.detached === true) opts.detached = true;
    if (params.isolated === true) opts.isolated = true;
    if (params.merge_back === true) opts.mergeBack = true;
    if (params.patch_back === true) opts.patchBack = true;
    if (params.inherit_mcp === false) opts.inheritMcp = false;
    if (params.config_overrides && typeof params.config_overrides === "object") {
      opts.configOverrides = params.config_overrides as Record<string, unknown>;
    }

    // 4) 显式 kind 字段覆盖磁盘
    if (params.tool_preset !== undefined && params.tool_preset !== null) {
      opts.toolPreset = String(params.tool_preset);
    }
    if (params.persist_context === true) opts.persistContext = true;
    if (params.persist_context === false) opts.persistContext = false;
    if (params.enable_loop === true) opts.enableLoop = true;
    if (params.enable_loop === false) opts.enableLoop = false;
    if (params.path !== undefined && String(params.path).trim()) {
      opts.path = String(params.path).trim();
    }
    if (Array.isArray(params.audit_paths)) {
      opts.auditPaths = params.audit_paths.map(String);
    }

    if (opts.kind === "fork") {
      opts.inheritFullContext = opts.inheritFullContext ?? true;
    }
    return opts;
  }
}
