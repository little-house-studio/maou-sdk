/**
 * 默认 SubagentRunFn —— SDK facade / harness 共享，避免双份实现漂移。
 *
 * 职责：
 *   1. session 准备（inheritFullContext → forkSession 完整复制）
 *   2. project path 提示 + PathGuard 注入
 *   3. 工具白名单 / agentMode 透传
 *   4. MCP proxy 注册
 *   5. 调 AgentRuntime.run 消费事件
 */

import type { SessionStore } from "@little-house-studio/context";
import type { StreamEvent } from "@little-house-studio/types";
import type { SubagentRunFn } from "./subagent-executor.js";

/** 最小 runtime 契约（避免 default-run-fn ↔ Runtime 循环依赖过深） */
export interface SubagentRuntimeLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(
    sessionId: string | null | undefined,
    userMessage: string,
    // 与 AgentRuntime.run 兼容；用 any 避免 RunOptions 循环依赖
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: any,
  ): AsyncGenerator<StreamEvent, any, any>;
  registerMcpProxyTools?(tools: unknown[]): void;
  setSessionPathGuard?(sessionId: string, guard: unknown | null): void;
}

export interface CreateDefaultSubagentRunFnOpts {
  sessionStore: SessionStore;
  runtime: SubagentRuntimeLike;
  /** 取当前默认 preset；失败返回 undefined */
  getPreset: () => unknown | undefined;
  log?: (level: string, message: string) => void;
}

/**
 * 创建与 runtime-facade / harness 共用的 runFn。
 */
export function createDefaultSubagentRunFn(
  opts: CreateDefaultSubagentRunFnOpts,
): SubagentRunFn {
  const { sessionStore, runtime, getPreset, log } = opts;
  const _log = log ?? (() => {});

  return async function* defaultSubagentRunFn(
    subSessionId,
    taskId,
    taskDesc,
    options,
  ) {
    // 1. Session：完整 fork 或空 session
    const existing = sessionStore.load(subSessionId);
    if (options?.inheritFullContext && options.parentSessionId) {
      try {
        if (!existing || existing.messages.length === 0) {
          sessionStore.forkSession(
            options.parentSessionId,
            `fork: ${taskId}`,
            subSessionId,
          );
        }
      } catch (err) {
        _log(
          "warning",
          `[runFn] inheritFullContext 复制失败，降级空 session: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (!existing) {
          sessionStore.create({
            sessionId: subSessionId,
            agentName: options?.agentName ?? "main",
            title: `fork: ${taskId}`,
          });
        }
      }
    } else if (!existing) {
      sessionStore.create({
        sessionId: subSessionId,
        agentName: options?.agentName ?? "main",
        title: `fork: ${taskId}`,
      });
    }

    // 2. project scope 提示（软约束；硬约束靠 PathGuard）
    let effectiveTaskDesc = taskDesc;
    if (options?.scopedPath) {
      const audit =
        options.auditPaths && options.auditPaths.length > 0
          ? `\n域外审核路径: ${options.auditPaths.join(", ")}`
          : "";
      effectiveTaskDesc =
        `[project-scope] 你驻扎在路径 \`${options.scopedPath}\`。` +
        `优先只读写该路径内文件；路径外操作需更高权限或等待审核。${audit}\n\n` +
        taskDesc;
    }

    // 3. PathGuard → runtime per-session
    const kp = options?.kindPolicy as
      | { pathGuard?: unknown; permission?: string }
      | undefined;
    if (runtime.setSessionPathGuard && kp?.pathGuard) {
      runtime.setSessionPathGuard(subSessionId, kp.pathGuard);
    } else if (runtime.setSessionPathGuard && options?.scopedPath) {
      // 从 scopedPath 推断
      const mode =
        kp?.permission === "project_scoped_audit" ? "audit" : "hard";
      runtime.setSessionPathGuard(subSessionId, {
        mode,
        roots: [options.scopedPath],
        auditRoots: options.auditPaths ?? [],
      });
    }

    const preset = getPreset();
    if (!preset) {
      runtime.setSessionPathGuard?.(subSessionId, null);
      return { finalOutput: "", ok: false, error: "无可用 preset" };
    }

    if (options?.mcpProxyTools && options.mcpProxyTools.length > 0) {
      try {
        runtime.registerMcpProxyTools?.(options.mcpProxyTools);
      } catch {
        /* ignore */
      }
    }

    const agentMode = options?.agentMode !== false;
    const toolWhitelistOverride = options?.toolWhitelist;

    let finalOutput = "";
    let ok = true;
    let error: string | undefined;

    try {
      for await (const event of runtime.run(subSessionId, effectiveTaskDesc, {
        preset,
        initAgentName: options?.agentName,
        stream: true,
        abortSignal: options?.abortSignal,
        agentMode,
        toolWhitelistOverride,
        mcpProxyToolNames:
          toolWhitelistOverride?.length === 0
            ? []
            : options?.mcpProxyTools?.map(
                (t) => (t as { definition?: { name?: string } }).definition?.name ?? "",
              ).filter(Boolean),
        bindingProjectRoot: options?.projectRoot ?? options?.scopedPath,
      })) {
        yield event as StreamEvent;
        if (
          event.type === "assistant" &&
          typeof (event as { content?: unknown }).content === "string"
        ) {
          finalOutput = (event as { content: string }).content;
        }
      }
    } catch (err) {
      ok = false;
      error = err instanceof Error ? err.message : String(err);
    } finally {
      runtime.setSessionPathGuard?.(subSessionId, null);
    }

    return { finalOutput, ok, error };
  };
}
