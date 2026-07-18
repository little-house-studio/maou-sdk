/**
 * Terminal 工具 — 基于 Rust 终端引擎
 *
 * 3 种模式：
 *   1. run — 前台/后台运行命令
 *   2. manage — 终端管理 (list/rm/stop/logs)
 *   3. write — 键盘输入模拟（交互式命令支持）
 *
 * 底层由 Rust terminal-engine 驱动（对齐 Grok 思路的跨平台执行层）：
 * - 默认全平台管道（shell_command_argv + capture_env）
 * - ProcessGroup 杀进程树（Unix killpg / Windows Job Object）
 * - 可选 MAOU_PTY_FORCE=1 真 PTY（write 键盘交互）
 * - 命令过滤 + DCG 三层安全（TS gate）
 * - 200 并行上限、ring buffer、V1 路径沙箱
 * 勿再使用 terminal/registry.ts / pty.ts（已弃用，见 LEGACY.md）
 *
 * 安全三层（run 前，见 terminal-security.ts）：
 *   致命 fatal  — 硬拦（DCG critical/灾难规则 + maou-hard-deny），不可二次执行绕过
 *   危险 dangerous — 需确认（用户/审核 Agent/相同命令再执行一次）
 *   安全 safe — 放行或仅走普通白名单/ask/auto
 * 引擎层：sandbox + 自定义 filter
 *
 * before_user 终端状态面板由 Runtime 层自动注入，无需 AI 主动调用。
 */

import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { compressTerminalOutput, compressOutput } from "../../compress/output-compressor.js";
import { createToolResponse } from "../../base.js";
import { truncateMiddle, formatMetadata, errToString } from "../../browser/god_tool/use_browser/_util.js";
import {
  getTerminalReviewer,
  getTerminalApprover,
  addToWhitelist,
  addToBlacklist,
  commandPrefix,
  recordReviewApprove,
  recordReviewReject,
  getMode,
  gateTerminalCommand,
  describeCommandForApproval,
} from "../../security/index.js";

// Rust 终端引擎
import * as engine from "@little-house-studio/terminal-engine";

export class TerminalTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "use_terminal",
    aliases: ["bash", "terminal_manage"],
    description:
      "执行 shell 命令或管理常驻终端。" +
      " action=run 运行命令（前台阻塞或后台运行）；" +
      " action=manage 管理终端（list/rm/stop/logs）；" +
      " action=write 向运行中的终端发送键盘输入（交互式命令确认/Ctrl+C 等）。" +
      " 不指定 id 为临时终端，执行完即销毁；指定 id 为持久终端，可反复操作。" +
      " 已存在的 id 会复用该终端执行新任务。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["run", "manage", "write"],
          description: "操作类型，默认 run",
        },
        id: {
          type: "string",
          description:
            "终端名称（AI 自定义）。不填为临时终端。已存在的 id 会复用该终端。",
        },
        command: {
          type: "string",
          description: "要执行的 shell 命令（run 时必填）",
        },
        description: {
          type: "string",
          description: "任务简介，用于在状态面板中显示（run 时必填）",
        },
        background: {
          type: "boolean",
          description: "是否后台运行（run 时可选，默认 false）",
        },
        timeout: {
          type: "number",
          description:
            "超时秒数。前台默认 120（超时自动转后台）；后台默认 0 即不超时提醒",
        },
        result_limit: {
          type: "integer",
          description: "返回结果限制字数，默认 5000，0 表示只返回状态提示",
        },
        manage_action: {
          type: "string",
          enum: ["list", "rm", "stop", "logs"],
          description: "管理操作类型（manage 时必填）",
        },
        limit: {
          type: "integer",
          description: "logs 查看字数（manage logs 时可选，默认 5000）",
        },
        data: {
          type: "string",
          description: "要发送的键盘输入（write 时必填，如 'y\\n'、'\\x03' 表示 Ctrl+C）",
        },
        reason: {
          type: "string",
          description: "为什么必须调用此工具",
        },
      },
      required: ["reason"],
      additionalProperties: false,
    },
    allowedModes: ["execute"],
  };

  async execute(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const action = String(params.action ?? "run").trim();
    let res: ToolResponse;
    if (action === "run") res = await this._actionRun(params, ctx);
    else if (action === "manage") res = await this._actionManage(params, ctx);
    else if (action === "write") res = await this._actionWrite(params, ctx);
    else {
      return createToolResponse(false, `未知 action: ${action}，可选: run, manage, write`);
    }
    // 每次调用附带终端快照，避免后台任务「消失了也不知道」
    return this._withTerminalFooter(res, ctx, action);
  }

  /**
   * 在工具返回末尾附加本 agent 的终端状态（running 优先）。
   * manage list 本身就是面板，只补 payload 快照，不重复贴正文。
   */
  private _withTerminalFooter(
    res: ToolResponse,
    ctx: ToolContext,
    action: string,
  ): ToolResponse {
    const agent = ctx.agentName || "main";
    let mine: engine.TerminalInfoNapi[] = [];
    let others = 0;
    try {
      mine = engine.list(agent) ?? [];
      const all = engine.list() ?? [];
      others = Math.max(0, all.length - mine.length);
    } catch {
      return res;
    }

    const snapshot = mine.map((t) => ({
      id: t.id,
      state: t.state,
      description: t.description,
      exit_code: t.exitCode ?? null,
    }));
    const running = mine.filter((t) => t.state === "running");
    const exited = mine.filter((t) => t.state !== "running");

    const lines: string[] = [];
    if (running.length > 0) {
      lines.push(
        `🟢 运行中 (${running.length}): ` +
          running
            .map((t) => `${t.id}${t.description ? `「${t.description}」` : ""}`)
            .join("; "),
      );
    }
    if (exited.length > 0) {
      lines.push(
        `💤 已结束 (${exited.length}): ` +
          exited
            .slice(0, 6)
            .map(
              (t) =>
                `${t.id}${t.exitCode != null ? `(exit ${t.exitCode})` : ""}`,
            )
            .join("; ") +
          (exited.length > 6 ? " …" : ""),
      );
    }
    if (mine.length === 0) {
      lines.push(
        others > 0
          ? `本 agent「${agent}」无终端；系统另有 ${others} 个其它 agent 终端（可能 agentName 不一致）。`
          : `本 agent「${agent}」当前没有终端（后台进程若已退出会被移出列表；长驻请用 id + background=true）。`,
      );
    }
    lines.push(
      `提示: manage list 看全表 · manage logs id=… 看输出 · manage stop id=… 结束`,
    );

    const footer = lines.join("\n");
    const payload = {
      ...(res.payload && typeof res.payload === "object" ? res.payload : {}),
      terminals_snapshot: snapshot,
      terminals_running: running.length,
      terminals_total: mine.length,
      terminals_other_agents: others,
    };

    // list 已返回完整面板，只挂 payload，避免重复贴表
    const isList =
      action === "manage" &&
      /终端列表|当前没有终端|Agent「|Agent .+ 当前没有终端|Agent .+ 的终端列表/.test(
        res.message || "",
      );

    if (isList) {
      return { ...res, payload };
    }

    return {
      ...res,
      message: `${res.message || ""}\n\n── 终端状态 ──\n${footer}`,
      payload,
    };
  }

  // ─── run ────────────────────────────────────────────────────────────────────

  private async _actionRun(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const command = String(params.command ?? "").trim();
    if (!command) return createToolResponse(false,
      "❌ run 操作必须提供 command 参数。\n" +
      "正确用法示例：{\"action\":\"run\",\"command\":\"git status\",\"reason\":\"查看仓库状态\"}\n" +
      "请重新调用 use_terminal 并填写 command 字段。"
    );

    // ── 终端审批策略（normal / auto / yolo + 黑白名单 + 重复放行）──
    // 审批 UI 优先展示模型在 tool_call 里写的 description / reason（不是另一套 AI 生成）
    const aiDescription = String(params.description ?? "").trim();
    const aiReason = String(params.reason ?? "").trim();
    const gate = await this._approve(command, ctx, {
      description: aiDescription,
      reason: aiReason,
    });
    if (gate) return gate; // 非空 = 被拦截，返回审批提示/拒绝

    // description 缺失时用命令兜底（而非报错），减少模型多花一轮补参数。
    const description = aiDescription || `执行命令: ${command.slice(0, 60)}`;

    const id = params.id ? String(params.id) : undefined;
    const background = Boolean(params.background);
    // cwd 解析：默认在项目工作目录（与 reader/glob/grep 等文件工具一致，操作真实项目）。
    // 仅当显式 sandboxMode 为隔离模式时才落到 sandboxRoot；否则旧逻辑会把终端命令
    // 永远困在 ~/.maou/sandbox/<session>（sandboxRoot 总有值），导致看不到项目文件。
    const sandboxed =
      ctx.sandboxMode === "sandbox" ||
      ctx.sandboxMode === "strict" ||
      ctx.sandboxMode === "isolated";
    const cwd = params.cwd
      ? String(params.cwd)
      : sandboxed
        ? (ctx.sandboxRoot || ctx.workingDir || ctx.projectRoot)
        : (ctx.workingDir || ctx.projectRoot || ctx.sandboxRoot);
    const timeoutSec = params.timeout != null ? Number(params.timeout) : (background ? 0 : 120);
    const resultLimit = params.result_limit != null ? Number(params.result_limit) : 5000;

    if (background) {
      return this._runBackground(id, command, description, cwd, ctx, timeoutSec, resultLimit);
    }
    return this._runForeground(id, command, description, cwd, ctx, timeoutSec, resultLimit);
  }

  /**
   * 终端审批门：返回 null 放行；返回 ToolResponse 表示被拦截。
   * 三层：fatal / dangerous / safe（见 gateTerminalCommand）。
   * @param aiMeta 模型 tool_call 自带的 description/reason，用于审批条展示
   */
  private async _approve(
    command: string,
    ctx: ToolContext,
    aiMeta: { description?: string; reason?: string } = {},
  ): Promise<ToolResponse | null> {
    const agent = ctx.agentName || "main";
    // sandboxMode 可覆盖 agent 持久化 mode（HTTP yolo 场景）
    const mode =
      ctx.sandboxMode === "yolo" || ctx.sandboxMode === "auto" || ctx.sandboxMode === "normal"
        ? ctx.sandboxMode
        : getMode(agent);

    const gate = await gateTerminalCommand(command, agent, mode);

    if (gate.action === "allow") return null;

    if (gate.action === "deny_fatal") {
      return createToolResponse(false, gate.message || "致命指令已拦截", {
        payload: gate.payload,
      });
    }

    /** 审批条文案：优先 AI 写的 description，其次 reason；没有再弱回退到命令启发式 */
    const buildApproverCtx = (risk: "low" | "high") => {
      const aiSummary = (aiMeta.description || aiMeta.reason || "").trim();
      const fallback = describeCommandForApproval(command, risk);
      return {
        agentName: agent,
        cwd: ctx.workingDir || ctx.projectRoot,
        risk,
        // 展示给用户的主文案 = 模型调用工具时写的简介
        summary: aiSummary || fallback.summary,
        // 标签：有 AI 简介时标明来源，避免被当成另一段「生成文案」
        label: aiSummary
          ? risk === "high"
            ? "高风险·AI说明"
            : "需确认·AI说明"
          : fallback.label,
        ruleId: gate.assessment?.ruleId,
        // 安全层原因与 AI reason 分开：reason 字段仍给安全/规则；AI 的 reason 已并入 summary
        reason: gate.assessment?.reason || gate.message,
      };
    };

    if (gate.action === "deny_dangerous_pending") {
      // 危险级：优先尝试交互审批 / 审核 Agent，否则靠二次相同命令
      const approver = getTerminalApprover();
      if (approver && mode === "normal") {
        try {
          const verdict = await approver(command, buildApproverCtx("high"));
          if (verdict.approve) {
            if (verdict.persist === "whitelist") addToWhitelist(agent, commandPrefix(command));
            return null;
          }
          if (verdict.persist === "blacklist") addToBlacklist(agent, commandPrefix(command));
          return createToolResponse(false,
            `⛔ [危险] 用户拒绝了该危险命令：\`${command}\``,
            { payload: { ...gate.payload, policy: "dangerous-user-denied" } });
        } catch {
          /* fall through to double-confirm message */
        }
      }
      if (mode === "auto") {
        const reviewer = getTerminalReviewer();
        if (reviewer) {
          try {
            const verdict = await reviewer(command, {
              agentName: agent,
              cwd: ctx.workingDir || ctx.projectRoot,
            });
            if (verdict.approve) {
              recordReviewApprove(agent, command);
              return null;
            }
            // 审核拒绝：保留二次执行窗口（已 mark）
            return createToolResponse(false,
              `⚠️ [危险·审核未通过] \`${command}\`\n理由：${verdict.reason}\n` +
                `若仍需执行：在窗口期内再发送一次完全相同的命令以确认。`,
              { payload: { ...gate.payload, policy: "dangerous-review-reject", reason: verdict.reason } });
          } catch (err) {
            return createToolResponse(false,
              `⚠️ [危险·审核异常] \`${command}\`（${errToString(err)}）\n可稍后重试或二次相同命令确认。`,
              { payload: { ...gate.payload, policy: "dangerous-review-error" } });
          }
        }
      }
      return createToolResponse(false, gate.message || "危险指令需确认", {
        payload: gate.payload,
      });
    }

    if (gate.action === "ask") {
      const approver = getTerminalApprover();
      if (approver) {
        try {
          const verdict = await approver(command, buildApproverCtx("low"));
          if (verdict.approve) {
            if (verdict.persist === "whitelist") addToWhitelist(agent, commandPrefix(command));
            return null;
          }
          if (verdict.persist === "blacklist") addToBlacklist(agent, commandPrefix(command));
          return createToolResponse(false,
            `⛔ [系统拦截] 用户拒绝了此命令：\`${command}\``,
            { payload: { policy: "ask-denied", command, tier: "safe" } });
        } catch (err) {
          return createToolResponse(false,
            `🔐 [系统拦截] 命令审批被取消/超时：\`${command}\`（${errToString(err)}）`,
            { payload: { policy: "ask-cancelled", command, tier: "safe" } });
        }
      }
      return createToolResponse(false,
        `🔐 [安全层·需确认] 非破坏性命令，但当前为审核模式且未在白名单：\`${command}\`\n` +
          `无人审批环境请用文件工具，或切换 yolo / 将命令加入白名单。`,
        { payload: gate.payload });
    }

    // review（安全层 auto）
    const reviewer = getTerminalReviewer();
    if (!reviewer) {
      return createToolResponse(false,
        `🔐 [安全层·配置缺失] auto 模式未配置审核器：\`${command}\``,
        { payload: { policy: "review-no-reviewer", command, tier: "safe" } });
    }
    try {
      const verdict = await reviewer(command, {
        agentName: agent,
        cwd: ctx.workingDir || ctx.projectRoot,
      });
      if (verdict.approve) {
        recordReviewApprove(agent, command);
        return null;
      }
      recordReviewReject(agent, command);
      return createToolResponse(false,
        `⛔ 审核未通过：\`${command}\`\n理由：${verdict.reason}`,
        { payload: { policy: "review-reject", command, reason: verdict.reason, tier: "safe" } });
    } catch (err) {
      return createToolResponse(false,
        `🔐 审核异常：\`${command}\`（${errToString(err)}）`,
        { payload: { policy: "review-error", command, tier: "safe" } });
    }
  }

  /** 前台阻塞执行 */
  private async _runForeground(
    id: string | undefined,
    command: string,
    description: string,
    cwd: string,
    ctx: ToolContext,
    timeoutSec: number,
    resultLimit: number,
  ): Promise<ToolResponse> {
    const timeoutMs = timeoutSec > 0 ? timeoutSec * 1000 : 120_000;

    try {
      const result = await engine.run(
        ctx.agentName,
        command,
        cwd,
        description,
        timeoutMs,
        resultLimit,
      );

      const ok = result.ok && result.exitCode === 0;
      const status = result.exitCode === 0
        ? "完成"
        : result.exitCode != null
          ? `失败(退出码${result.exitCode})`
          : "超时";
      const meta = formatMetadata({
        exit_code: result.exitCode ?? null,
        cwd,
        terminal_id: result.terminalId,
        duration_ms: Math.round(result.durationMs),
      });
      // 摄入层压缩：测试输出只留失败+摘要、通用输出去噪去重超长截断（对标 RTK）。短输出不动。
      // 级别由 ctx.compressionLevel（agent.json tool_compression）控制，off 时原样。
      const compressed = result.output
        ? compressTerminalOutput(command, result.output, ctx.compressionLevel ?? "normal")
        : "";
      // 前台也按 result_limit 截断（与后台一致），避免压缩后输出仍过长撑大上下文
      const body = (compressed ? applyResultLimit(compressed, resultLimit) : "") || (ok ? "（无输出）" : `命令${status}`);

      return createToolResponse(ok, `${body}\n\n${meta}`, {
        payload: {
          exit_code: result.exitCode ?? null,
          cwd,
          terminal_id: result.terminalId,
          duration_ms: Math.round(result.durationMs),
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return createToolResponse(false, `终端执行失败: ${msg}`);
    }
  }

  /** 后台执行 */
  private async _runBackground(
    id: string | undefined,
    command: string,
    description: string,
    cwd: string,
    ctx: ToolContext,
    _timeoutSec: number,
    resultLimit: number,
  ): Promise<ToolResponse> {
    try {
      const result = await engine.runBackground(
        ctx.agentName,
        command,
        cwd,
        description,
        id,
      );

      // 已快速完成
      if (result.exitCode != null) {
        const ok = result.exitCode === 0;
        const status = ok ? "已完成" : `已失败(退出码${result.exitCode})`;
        // 摄入层压缩：与前台对齐（去噪去重超长截断/测试失败项抽取），off 时原样。
        const level = ctx.compressionLevel ?? "normal";
        const compressed = result.output
          ? compressTerminalOutput(command, result.output, level)
          : "";
        const truncated = applyResultLimit(compressed, resultLimit);
        const meta = formatMetadata({
          terminal_id: result.terminalId,
          exit_code: result.exitCode,
          cwd,
        });
        return createToolResponse(ok,
          `后台任务「${description}」${status}。\n${truncated ? `\n输出:\n${truncated}\n` : ""}\n${meta}`,
          { payload: { terminal_id: result.terminalId, exit_code: result.exitCode, cwd } },
        );
      }

      // 仍在运行
      const meta = formatMetadata({ terminal_id: result.terminalId, cwd });
      return createToolResponse(true,
        `任务「${description}」已在后台运行。\n` +
        `终端 ID: ${result.terminalId}\n` +
        `完成/失败/超时会自动提醒。\n\n${meta}`,
        { background: true, payload: { terminal_id: result.terminalId, cwd } },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return createToolResponse(false, `后台终端创建失败: ${msg}`);
    }
  }

  // ─── manage ─────────────────────────────────────────────────────────────────

  private async _actionManage(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const action = String(params.manage_action ?? "").trim();
    switch (action) {
      case "list": return this._manageList(ctx);
      case "rm": return this._manageRm(params, ctx);
      case "stop": return this._manageStop(params, ctx);
      case "logs": return this._manageLogs(params, ctx);
      default:
        return createToolResponse(false, `未知 manage_action: ${action}，可选: list, rm, stop, logs`);
    }
  }

  private async _manageList(ctx: ToolContext): Promise<ToolResponse> {
    const agent = ctx.agentName || "main";
    const panel = engine.statusPanel(agent);
    const terminals = engine.list(agent) ?? [];
    let all: engine.TerminalInfoNapi[] = [];
    try {
      all = engine.list() ?? [];
    } catch {
      all = terminals;
    }

    if (terminals.length === 0) {
      const others = all.filter((t) => t.agentName && t.agentName !== agent);
      const hints: string[] = [
        `📋 Agent「${agent}」当前没有终端。`,
        "",
        "说明：",
        "- 未指定 id 的临时前台任务结束后会销毁，不会出现在列表里",
        "- 后台任务请用 background=true，建议同时指定 id 便于复用",
        "- 已退出且被 rm/cleanup 的终端不会保留",
        "- 进程若崩溃退出，状态会变为 exited（manage logs 仍可看尾部）",
      ];
      if (others.length > 0) {
        hints.push(
          "",
          `注意：系统中还有 ${others.length} 个其它 agent 的终端（agentName 过滤后不可见）：`,
        );
        for (const t of others.slice(0, 8)) {
          hints.push(
            `  - [${t.agentName}] ${t.id} ${t.state} ${t.description || ""}`.trim(),
          );
        }
      }
      hints.push(
        "",
        "启动示例: {\"action\":\"run\",\"command\":\"npm run dev\",\"background\":true,\"id\":\"vite\",\"description\":\"Vite 开发服\",\"reason\":\"…\"}",
      );
      return createToolResponse(true, hints.join("\n"), {
        payload: {
          count: 0,
          agent,
          other_agents_count: others.length,
          other_terminals: others.slice(0, 12).map((t) => ({
            id: t.id,
            agent: t.agentName,
            state: t.state,
            description: t.description,
          })),
        },
      });
    }

    return createToolResponse(true, panel, {
      payload: {
        count: terminals.length,
        agent,
        terminals: terminals.map((t) => ({
          id: t.id,
          state: t.state,
          description: t.description,
          exit_code: t.exitCode ?? null,
          command: t.command,
        })),
      },
    });
  }

  private async _manageRm(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const id = params.id ? String(params.id) : "";
    if (!id) return createToolResponse(false, "rm 操作缺少 id 参数");

    try {
      await engine.remove(id, ctx.agentName);
      return createToolResponse(true, `终端 ${id} 已删除。`, {
        payload: { id },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return createToolResponse(false, msg);
    }
  }

  private async _manageStop(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const id = params.id ? String(params.id) : "";
    if (!id) return createToolResponse(false, "stop 操作缺少 id 参数");

    try {
      await engine.stop(id, ctx.agentName);
      return createToolResponse(true, `已向终端 ${id} 发送终止信号。`, {
        payload: { id },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return createToolResponse(false, msg);
    }
  }

  private async _manageLogs(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const id = params.id ? String(params.id) : "";
    if (!id) return createToolResponse(false, "logs 操作缺少 id 参数");

    const limit = Math.max(0, Number(params.limit ?? 5000) || 5000);

    try {
      const rawOutput = await engine.logs(id, ctx.agentName, limit);
      const terminals = engine.list(ctx.agentName);
      const term = terminals.find((t) => t.id === id);
      const stateLabel = term
        ? term.state === "running"
          ? "运行中"
          : term.state === "exited"
            ? `已退出(${term.exitCode})`
            : term.state
        : "未知";
      const meta = formatMetadata({ id, status: stateLabel });

      // 摄入层压缩：logs 路径无 command 上下文，用通用压缩（不触发测试失败项抽取）；
      // maxLines=Infinity 表示只去噪去重不截断——用户主动查日志应给完整信息。
      const level = ctx.compressionLevel ?? "normal";
      const output = rawOutput ? compressOutput(rawOutput, { level, maxLines: Infinity }) : "";

      return createToolResponse(true,
        `${output || "（无输出）"}\n\n${meta}`,
        { payload: { id, state: term?.state ?? "unknown", exit_code: term?.exitCode ?? null } },
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return createToolResponse(false, msg);
    }
  }

  // ─── write（键盘输入模拟） ──────────────────────────────────────────────────

  private async _actionWrite(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const id = params.id ? String(params.id) : "";
    if (!id) return createToolResponse(false, "write 操作缺少 id 参数");

    const data = String(params.data ?? "");
    if (!data) return createToolResponse(false, "write 操作缺少 data 参数");

    try {
      await engine.write(id, ctx.agentName, data);
      return createToolResponse(true, `已向终端 ${id} 发送输入: ${JSON.stringify(data)}`, {
        payload: { id, data },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return createToolResponse(false, msg);
    }
  }

  override onSessionStart(_sessionId: string): void {
    // 由 Runtime 层显式调 cleanupAgent，这里留空
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function applyResultLimit(output: string, limit: number): string {
  if (!output) return "";
  if (limit === 0) return "";
  if (output.length <= limit) return output;
  return truncateMiddle(output, limit);
}

// ─── Rust 引擎初始化（模块加载时自动执行） ────────────────────────────────────

let engineInitialized = false;

/** 初始化 Rust 终端引擎（由 harness/server.ts 调用） */
export function initTerminalEngine(logDir?: string, persistPath?: string): void {
  if (engineInitialized) return;
  engineInitialized = true;
  try {
    engine.initEngine(logDir);
    if (persistPath) {
      engine.setPersistPath(persistPath);
    }
    // 破坏性预设改由 DCG 负责；引擎层只保留自定义黑白名单 + 沙箱
    try {
      // napi 字段名以生成的 TS 类型为准（snake 或 camel）
      const filterCfg = {
        preset_blacklist_enabled: false,
        presetBlacklistEnabled: false,
        blacklist: [],
        whitelist: [],
        whitelist_mode: false,
        whitelistMode: false,
      };
      engine.setFilter(filterCfg as engine.FilterConfigNapi);
    } catch {
      /* older native build may lack field */
    }
  } catch {
    // 引擎初始化失败时静默降级（可能 native module 未安装）
    console.warn("[terminal-engine] Rust 引擎初始化失败，终端功能不可用");
  }
}

/** 关闭所有终端（由 harness/server.ts 在进程退出时调用） */
export function shutdownTerminalEngine(): void {
  try {
    engine.shutdown();
  } catch {
    // best effort
  }
}

/** 清理 Agent 的所有终端（由 runtime.ts 在 session 开始时调用） */
export function cleanupAgentTerminals(agentName: string): void {
  try {
    engine.cleanupAgent(agentName);
  } catch {
    // best effort
  }
}

/** 获取终端状态面板（由 dynamic-context.ts 注入 prompt） */
export function getTerminalStatusPanel(agentName: string): string {
  try {
    return engine.statusPanel(agentName);
  } catch {
    return "";
  }
}

/** 设置命令过滤器配置 */
export function setTerminalFilter(config: engine.FilterConfigNapi): void {
  try {
    engine.setFilter(config);
  } catch {
    // best effort
  }
}

/** 设置沙箱配置 */
export function setTerminalSandbox(config: engine.SandboxConfigNapi): void {
  try {
    engine.setSandbox(config);
  } catch {
    // best effort
  }
}

/** 设置持久化路径 */
export function setTerminalPersistPath(path: string): void {
  try {
    engine.setPersistPath(path);
  } catch {
    // best effort
  }
}

/** 列出终端（供 runtime.ts 注入通知用） */
export function listTerminals(agentName: string): engine.TerminalInfoNapi[] {
  try {
    return engine.list(agentName);
  } catch {
    return [];
  }
}

/** 获取终端日志（供 runtime.ts 注入通知用） */
export async function getTerminalLogs(id: string, agentName: string, lines: number): Promise<string> {
  try {
    // 防御性超时：engine.logs（native addon）在某些状态下可能 async 挂起不返回，
    // 用 5s 超时兜底，避免拖死 agent 循环（round 间读后台终端日志时）。
    return await Promise.race([
      engine.logs(id, agentName, lines),
      new Promise<string>((resolve) => setTimeout(() => resolve(""), 5000)),
    ]);
  } catch {
    return "";
  }
}
