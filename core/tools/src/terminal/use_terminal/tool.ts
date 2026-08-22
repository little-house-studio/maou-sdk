/**
 * Terminal 工具 — 经 TerminalBackend（full Rust PTY / mini 纯 Node）
 *
 * 3 种模式：
 *   1. run — 前台/后台运行命令
 *   2. manage — 终端管理 (list/rm/stop/logs)
 *   3. write — 键盘输入模拟（仅 full PTY）
 *
 * 选型：MAOU_TERMINAL → agent.json terminalMode → config.json terminal.mode（默认 full）。
 * full 无 .node 时自动降级 mini，并在返回/status panel 标明。
 * 安全三层仍走 security/gate.ts（DCG），与后端无关。
 *
 * before_user 终端状态面板由 Runtime 层自动注入，无需 AI 主动调用。
 */

import { Tool, toolDir } from "../../base.js";
import type { JsonSchema, ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { compressTerminalOutput, compressOutput } from "../../compress/output-compressor.js";
import { createToolResponse, toolFail } from "../../base.js";
import { truncateMiddle, formatMetadata, errToString } from "../../util/common.js";
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
import {
  evalConditionOnFile,
  evalConditionOnText,
  formatConditionHits,
  resolveExpr,
  validateConditionParams,
  type ReturnWhen,
} from "./condition.js";

import {
  getActiveBackend,
  getTerminalResolution,
  initActiveBackend,
  shutdownActiveBackend,
} from "../resolve-backend.js";
import { isHumanTerminal, type TerminalInfo } from "../backend.js";

function be(ctx?: ToolContext) {
  return getActiveBackend({ agentTerminalMode: ctx?.terminalBackend });
}

function withWindowsShellHint(schemas: JsonSchema[]): JsonSchema[] {
  const hint = " Windows 上命令在 PowerShell 中执行（与人壳相同），不要写 bash/zsh。";
  return schemas.map((schema) => {
    if (!schema || typeof schema !== "object") return schema;
    const s = { ...(schema as Record<string, unknown>) };
    if (typeof s.description === "string" && !s.description.includes("PowerShell")) {
      s.description = `${s.description}${hint}`;
    }
    const params = s.parameters;
    if (params && typeof params === "object") {
      const p = { ...(params as Record<string, unknown>) };
      const props = p.properties;
      if (props && typeof props === "object") {
        const pr = { ...(props as Record<string, unknown>) };
        const cmd = pr.command;
        if (cmd && typeof cmd === "object") {
          pr.command = {
            ...(cmd as Record<string, unknown>),
            description: "要执行的 PowerShell 命令（run 时必填；不要写 bash/zsh）。",
          };
        }
        p.properties = pr;
      }
      s.parameters = p;
    }
    return s as JsonSchema;
  });
}

export class TerminalTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "use_terminal",
    aliases: ["bash", "terminal_manage"],
    description:
      "执行 shell 命令或管理常驻终端。" +
      " action=run 运行命令（前台/后台）；" +
      " action=manage（list/rm/stop/logs）；" +
      " action=write 键盘输入；" +
      " action=scan 扫文件（path + return_when=filter）。" +
      " 【条件返回】return_when=filter|until + match(正则可选) + expr(受限 Python 表达式)。" +
      " 表达式可用 line/n/re/m；例: match='a\\\\s*=\\\\s*(\\\\d+)' expr='m is not None and 2 < int(m.group(1)) < 5'。" +
      " until=第一次命中即返回（可 keep_running）；filter=筛出所有命中行。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["run", "manage", "write", "scan"],
          description: "操作类型，默认 run",
        },
        id: {
          type: "string",
          description:
            "终端名称。后台/until 时复用已有 id；前台不填为临时终端，结束后销毁。",
        },
        command: {
          type: "string",
          description: "要执行的 shell 命令（run 时必填；scan 不需要）",
        },
        description: {
          type: "string",
          description: "任务简介，用于在状态面板中显示（run 时建议填）",
        },
        background: {
          type: "boolean",
          description: "是否后台运行（run 且无 return_when 时可选，默认 false）",
        },
        timeout: {
          type: "number",
          description:
            "超时秒数。前台默认 120；until 默认 3600；后台默认 0",
        },
        result_limit: {
          type: "integer",
          description: "返回结果限制字数，默认 5000，0 表示只返回状态提示",
        },
        return_when: {
          type: "string",
          enum: ["filter", "until"],
          description:
            "条件返回：filter=筛出所有命中行；until=第一次命中即返回（终端流/长任务）。需配 expr 和/或 match",
        },
        match: {
          type: "string",
          description:
            "可选正则，匹配成功时 m=Match 否则 m=None。仅 match 时默认 expr 为 m is not None",
        },
        expr: {
          type: "string",
          description:
            "受限 Python 表达式，可用 line/n/re/m。例: m is not None and 2 < int(m.group(1)) < 5",
        },
        path: {
          type: "string",
          description: "scan 时文件路径；或 run+filter 时从该文件筛（不跑命令）",
        },
        keep_running: {
          type: "boolean",
          description: "until 命中后是否保留进程（默认 true）。false 则 stop 终端",
        },
        context_lines: {
          type: "integer",
          description: "命中行前后上下文行数，默认 3",
        },
        max_hits: {
          type: "integer",
          description: "filter 最多返回条数，默认 100",
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

  /** Windows 才改 LLM schema 文案；Mac 仍读 schema.json 原句。 */
  nativeToolSchemas(): JsonSchema[] {
    const schemas = super.nativeToolSchemas();
    if (process.platform !== "win32") return schemas;
    return withWindowsShellHint(schemas);
  }

  toolPrompt(): string | null {
    const base = super.toolPrompt();
    if (process.platform !== "win32") return base;
    const extra =
      "\n\nWindows：命令在 PowerShell 中执行（与人壳相同），不要写 bash/zsh。显式 `MAOU_SHELL=cmd.exe` 才走 cmd。\n";
    return `${base ?? ""}${extra}`;
  }

  async execute(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const action = String(params.action ?? "run").trim();
    let res: ToolResponse;
    if (action === "run") res = await this._actionRun(params, ctx);
    else if (action === "manage") res = await this._actionManage(params, ctx);
    else if (action === "write") res = await this._actionWrite(params, ctx);
    else if (action === "scan") res = await this._actionScan(params, ctx);
    else {
      return toolFail("invalid_args", `未知 action: ${action}，可选: run, manage, write, scan`, {
        code: "unknown_action",
      });
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
    let mine: TerminalInfo[] = [];
    let others = 0;
    try {
      mine = (be(ctx).list(agent) ?? []).filter((t) => !isHumanTerminal(t));
      const all = (be(ctx).list() ?? []).filter((t) => !isHumanTerminal(t));
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
          : `本 agent「${agent}」当前没有终端（前台临时任务结束后会销毁；长驻请用 id + background=true）。`,
      );
    }
    const resolution = getTerminalResolution({ agentTerminalMode: ctx.terminalBackend });
    if (resolution.degraded) {
      lines.push("terminalBackend=mini (degraded from full)");
    } else if (resolution.kind === "mini") {
      lines.push("terminalBackend=mini");
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
      terminal_backend: resolution.kind,
      terminal_degraded: resolution.degraded,
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
    const returnWhen = String(params.return_when ?? "").trim() as ReturnWhen | "";
    const pathOnly = String(params.path ?? "").trim();

    // run + path + filter 且无 command → 当文件扫描
    if (returnWhen === "filter" && pathOnly && !String(params.command ?? "").trim()) {
      return this._actionScan(params, ctx);
    }

    const command = String(params.command ?? "").trim();
    if (!command) return createToolResponse(false,
      "❌ run 操作必须提供 command 参数。\n" +
      "正确用法示例：{\"action\":\"run\",\"command\":\"git status\",\"reason\":\"查看仓库状态\"}\n" +
      "条件扫文件用 action=scan 或 run+return_when=filter+path。",
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
    const resultLimit = params.result_limit != null ? Number(params.result_limit) : 5000;

    // 条件返回路径
    if (returnWhen === "until" || returnWhen === "filter") {
      const verr = validateConditionParams({
        returnWhen,
        expr: params.expr != null ? String(params.expr) : undefined,
        match: params.match != null ? String(params.match) : undefined,
      });
      if (verr) return createToolResponse(false, verr);
      const expr = resolveExpr(
        params.expr != null ? String(params.expr) : undefined,
        params.match != null ? String(params.match) : undefined,
      );
      const match = params.match != null ? String(params.match) : undefined;
      const contextLines =
        params.context_lines != null ? Number(params.context_lines) : 3;
      const maxHits = params.max_hits != null ? Number(params.max_hits) : 100;
      const keepRunning = params.keep_running !== false;
      const timeoutSec =
        params.timeout != null
          ? Number(params.timeout)
          : returnWhen === "until"
            ? 3600
            : 120;

      if (returnWhen === "until") {
        return this._runUntilCondition({
          id,
          command,
          description,
          cwd,
          ctx,
          timeoutSec,
          resultLimit,
          expr,
          match,
          contextLines,
          keepRunning,
        });
      }
      // filter：跑完（或超时）后对输出筛行
      return this._runFilterCondition({
        id,
        command,
        description,
        cwd,
        ctx,
        timeoutSec,
        resultLimit,
        expr,
        match,
        contextLines,
        maxHits,
      });
    }

    const timeoutSec = params.timeout != null ? Number(params.timeout) : (background ? 0 : 120);
    if (background) {
      return this._runBackground(id, command, description, cwd, ctx, timeoutSec, resultLimit);
    }
    return this._runForeground(id, command, description, cwd, ctx, timeoutSec, resultLimit);
  }

  /** 扫文件：action=scan 或 run+path+filter */
  private async _actionScan(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const path = String(params.path ?? "").trim();
    if (!path) {
      return createToolResponse(
        false,
        "scan 需要 path。例: {\"action\":\"scan\",\"path\":\"data.txt\",\"return_when\":\"filter\",\"match\":\"a\\\\s*=\\\\s*(\\\\d+)\",\"expr\":\"m is not None and 2 < int(m.group(1)) < 5\",\"reason\":\"…\"}",
      );
    }
    const returnWhen = (String(params.return_when ?? "filter").trim() || "filter") as ReturnWhen;
    if (returnWhen !== "filter" && returnWhen !== "until") {
      return createToolResponse(false, "scan 的 return_when 须为 filter 或 until");
    }
    const verr = validateConditionParams({
      returnWhen,
      expr: params.expr != null ? String(params.expr) : undefined,
      match: params.match != null ? String(params.match) : undefined,
    });
    if (verr) return createToolResponse(false, verr);

    const expr = resolveExpr(
      params.expr != null ? String(params.expr) : undefined,
      params.match != null ? String(params.match) : undefined,
    );
    const match = params.match != null ? String(params.match) : undefined;
    const result = await evalConditionOnFile(path, {
      expr,
      match,
      mode: returnWhen,
      maxHits: params.max_hits != null ? Number(params.max_hits) : 100,
      contextLines: params.context_lines != null ? Number(params.context_lines) : 3,
    });
    const body = formatConditionHits(result);
    const ok = result.ok && (returnWhen === "filter" || (result.matched ?? 0) > 0);
    return createToolResponse(ok, body, {
      payload: {
        path,
        return_when: returnWhen,
        matched: result.matched ?? 0,
        hits: result.hits ?? [],
        error: result.error,
      },
    });
  }

  /** until：后台跑命令，轮询 logs，第一次 expr 真即返回 */
  private async _runUntilCondition(opts: {
    id: string | undefined;
    command: string;
    description: string;
    cwd: string;
    ctx: ToolContext;
    timeoutSec: number;
    resultLimit: number;
    expr: string;
    match?: string;
    contextLines: number;
    keepRunning: boolean;
  }): Promise<ToolResponse> {
    const agent = opts.ctx.agentName || "main";
    const timeoutMs = Math.max(1000, opts.timeoutSec * 1000);
    const pollMs = 400;
    const started = Date.now();

    let terminalId: string;
    try {
      const bg = await be(opts.ctx).runBackground(
        agent,
        opts.command,
        opts.cwd,
        opts.description,
        opts.id,
      );
      terminalId = bg.terminalId;
      // 已瞬间结束：对输出做 until
      if (bg.exitCode != null) {
        const cond = await evalConditionOnText(bg.output || "", {
          expr: opts.expr,
          match: opts.match,
          mode: "until",
          contextLines: opts.contextLines,
        });
        const body = formatConditionHits(cond, opts.resultLimit);
        const meta = formatMetadata({
          terminal_id: terminalId,
          exit_code: bg.exitCode,
          cwd: opts.cwd,
          return_when: "until",
        });
        const ok = cond.ok && (cond.matched ?? 0) > 0;
        return createToolResponse(ok, `${body}\n\n${meta}`, {
          payload: {
            terminal_id: terminalId,
            exit_code: bg.exitCode,
            return_when: "until",
            matched: cond.matched ?? 0,
            hits: cond.hits ?? [],
            elapsed_ms: Date.now() - started,
          },
        });
      }
    } catch (err: unknown) {
      return createToolResponse(
        false,
        `until 启动失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    let lastEvalKey = "";
    while (Date.now() - started < timeoutMs) {
      await new Promise((r) => setTimeout(r, pollMs));
      let output = "";
      try {
        output = await be(opts.ctx).logs(terminalId, agent, 5000);
      } catch {
        continue;
      }
      // 无变化则跳过求值
      const key = `${output.length}:${output.slice(-200)}`;
      if (key === lastEvalKey) {
        // 检查是否已退出
        const list = be(opts.ctx).list(agent) ?? [];
        const t = list.find((x) => x.id === terminalId);
        if (t && t.state !== "running") {
          const cond = await evalConditionOnText(output, {
            expr: opts.expr,
            match: opts.match,
            mode: "until",
            contextLines: opts.contextLines,
          });
          const body = formatConditionHits(cond, opts.resultLimit);
          const meta = formatMetadata({
            terminal_id: terminalId,
            exit_code: t.exitCode ?? null,
            cwd: opts.cwd,
            return_when: "until",
            reason: "process_exited",
          });
          return createToolResponse(cond.ok && (cond.matched ?? 0) > 0, `${body}\n\n${meta}`, {
            payload: {
              terminal_id: terminalId,
              exit_code: t.exitCode ?? null,
              return_when: "until",
              matched: cond.matched ?? 0,
              hits: cond.hits ?? [],
              elapsed_ms: Date.now() - started,
              process_exited: true,
            },
          });
        }
        continue;
      }
      lastEvalKey = key;

      const cond = await evalConditionOnText(output, {
        expr: opts.expr,
        match: opts.match,
        mode: "until",
        contextLines: opts.contextLines,
      });
      if (cond.ok && (cond.matched ?? 0) > 0) {
        if (!opts.keepRunning) {
          try {
            await be(opts.ctx).stop(terminalId, agent);
          } catch {
            /* ignore */
          }
        }
        const hit = cond.hits?.[0];
        const body =
          formatConditionHits(cond, opts.resultLimit) +
          (hit?.context_before?.length
            ? `\n\n── 上下文 ──\n${[...(hit.context_before ?? []), hit.text, ...(hit.context_after ?? [])].join("\n")}`
            : "");
        const meta = formatMetadata({
          terminal_id: terminalId,
          cwd: opts.cwd,
          return_when: "until",
          keep_running: opts.keepRunning,
          elapsed_ms: Date.now() - started,
        });
        return createToolResponse(true, `${body}\n\n${meta}`, {
          payload: {
            terminal_id: terminalId,
            return_when: "until",
            matched: 1,
            hits: cond.hits ?? [],
            keep_running: opts.keepRunning,
            elapsed_ms: Date.now() - started,
            trigger: hit,
          },
        });
      }
    }

    // 超时
    let tail = "";
    try {
      tail = await be(opts.ctx).logs(terminalId, agent, 80);
    } catch {
      /* ignore */
    }
    const meta = formatMetadata({
      terminal_id: terminalId,
      cwd: opts.cwd,
      return_when: "until",
      error: "timeout",
      timeout_sec: opts.timeoutSec,
    });
    return createToolResponse(
      false,
      `until 超时（${opts.timeoutSec}s）未命中条件。\n` +
        `expr: ${opts.expr}\n` +
        (opts.match ? `match: ${opts.match}\n` : "") +
        (tail ? `\n── 最近输出 ──\n${applyResultLimit(tail, opts.resultLimit)}\n` : "") +
        `\n${meta}`,
      {
        payload: {
          terminal_id: terminalId,
          return_when: "until",
          error: "timeout",
          timeout_sec: opts.timeoutSec,
          elapsed_ms: Date.now() - started,
        },
      },
    );
  }

  /** filter：前台/后台跑完后对输出筛行 */
  private async _runFilterCondition(opts: {
    id: string | undefined;
    command: string;
    description: string;
    cwd: string;
    ctx: ToolContext;
    timeoutSec: number;
    resultLimit: number;
    expr: string;
    match?: string;
    contextLines: number;
    maxHits: number;
  }): Promise<ToolResponse> {
    // 前台跑到结束（或超时）再筛
    const timeoutMs = opts.timeoutSec > 0 ? opts.timeoutSec * 1000 : 120_000;
    try {
      const result = await be(opts.ctx).run(
        opts.ctx.agentName || "main",
        opts.command,
        opts.cwd,
        opts.description,
        timeoutMs,
        200_000, // 内部多取一点再 filter
      );
      await discardTempTerminal(opts.id, result.terminalId, opts.ctx);
      const cond = await evalConditionOnText(result.output || "", {
        expr: opts.expr,
        match: opts.match,
        mode: "filter",
        maxHits: opts.maxHits,
        contextLines: opts.contextLines,
      });
      const body = formatConditionHits(cond, opts.resultLimit);
      const meta = formatMetadata({
        terminal_id: result.terminalId,
        exit_code: result.exitCode ?? null,
        cwd: opts.cwd,
        return_when: "filter",
        duration_ms: Math.round(result.durationMs),
      });
      return createToolResponse(cond.ok, `${body}\n\n${meta}`, {
        payload: {
          terminal_id: result.terminalId,
          exit_code: result.exitCode ?? null,
          return_when: "filter",
          matched: cond.matched ?? 0,
          hits: cond.hits ?? [],
          scanned: cond.scanned,
        },
      });
    } catch (err: unknown) {
      return createToolResponse(
        false,
        `filter 执行失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
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
    // sandboxMode 可覆盖 agent 持久化 mode（HTTP / CLI yolo 场景）
    // 统一小写，避免 UI 传 "Yolo" 等导致门禁落到 normal
    const rawMode = String(ctx.sandboxMode ?? getMode(agent) ?? "normal")
      .trim()
      .toLowerCase();
    const mode: "yolo" | "auto" | "normal" =
      rawMode === "yolo" || rawMode === "auto" || rawMode === "normal"
        ? rawMode
        : "normal";

    // yolo：不弹审批 UI。gate 内 fatal 仍硬拦；危险级 yolo 已 allow；
    // 用户黑名单在 yolo 下仍可拦截（deny，无 UI）。
    const gate = await gateTerminalCommand(command, agent, mode);

    if (gate.action === "allow") return null;

    // 防御：yolo 下绝不调用 TerminalApprover（避免 UI 与「全放」文案矛盾）
    if (mode === "yolo") {
      if (gate.action === "ask" || gate.action === "review") {
        // 理论不应出现；放行以符合 yolo
        return null;
      }
      // deny_dangerous_pending / deny_fatal：无 UI，直接拒绝（黑名单 / 致命）
      if (gate.action === "deny_dangerous_pending") {
        return toolFail("policy_denied", gate.message || "命令被策略拦截", {
          code: String((gate.payload as { policy?: string })?.policy ?? "deny_dangerous_pending"),
          payload: gate.payload,
          details: { gateAction: gate.action },
        });
      }
    }

    if (gate.action === "deny_fatal") {
      return toolFail("policy_denied", gate.message || "致命指令已拦截", {
        code: String((gate.payload as { policy?: string })?.policy ?? "deny_fatal"),
        payload: gate.payload,
        details: { gateAction: gate.action },
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
      // 危险级：
      // - normal → 人手审批（若注入）
      // - auto → 只走 AI 审核，绝不弹人手卡
      // - 否则 → 二次相同命令确认文案
      if (mode === "auto") {
        const reviewer = getTerminalReviewer();
        if (reviewer) {
          try {
            const verdict = await reviewer(command, {
              agentName: agent,
              cwd: ctx.workingDir || ctx.projectRoot,
            });
            if (verdict.approve) {
              // 危险级 AI 放行：本轮执行，但不永久入白名单
              return null;
            }
            // 审核拒绝：保留二次执行窗口（gate 已 mark）
            return toolFail(
              "policy_denied",
              `⚠️ [危险·审核未通过] \`${command}\`\n理由：${verdict.reason}\n` +
                `若仍需执行：在窗口期内再发送一次完全相同的命令以确认。`,
              {
                code: "dangerous-review-reject",
                payload: { ...gate.payload, policy: "dangerous-review-reject", reason: verdict.reason },
              },
            );
          } catch (err) {
            return toolFail(
              "policy_denied",
              `⚠️ [危险·审核异常] \`${command}\`（${errToString(err)}）\n可稍后重试或二次相同命令确认。`,
              {
                code: "dangerous-review-error",
                payload: { ...gate.payload, policy: "dangerous-review-error" },
              },
            );
          }
        }
        return toolFail(
          "dependency_unavailable",
          `⚠️ [危险·auto] 未配置审核器，无法自动审核：\`${command}\`\n` +
            `可在窗口期内再执行一次相同命令确认，或切换 yolo / normal。`,
          {
            code: "dangerous-no-reviewer",
            payload: { ...gate.payload, policy: "dangerous-no-reviewer" },
          },
        );
      }
      if (mode === "normal") {
        const approver = getTerminalApprover();
        if (approver) {
          try {
            const verdict = await approver(command, buildApproverCtx("high"));
            if (verdict.approve) {
              if (verdict.persist === "whitelist") addToWhitelist(agent, commandPrefix(command));
              return null;
            }
            if (verdict.persist === "blacklist") addToBlacklist(agent, commandPrefix(command));
            return toolFail(
              "user_rejected",
              `⛔ [危险] 用户拒绝了该危险命令：\`${command}\``,
              {
                code: "dangerous-user-denied",
                payload: { ...gate.payload, policy: "dangerous-user-denied" },
              },
            );
          } catch {
            /* fall through to double-confirm message */
          }
        }
      }
      return toolFail("policy_denied", gate.message || "危险指令需确认", {
        code: String((gate.payload as { policy?: string })?.policy ?? "dangerous_pending"),
        payload: gate.payload,
      });
    }

    if (gate.action === "ask") {
      // auto 不应落到 ask；若落到此，强制走 AI review，绝不弹人手卡
      if (mode === "auto") {
        const reviewer = getTerminalReviewer();
        if (!reviewer) {
          return toolFail(
            "dependency_unavailable",
            `🔐 [安全层] auto 模式未配置审核器：\`${command}\``,
            { code: "review-no-reviewer", payload: { policy: "review-no-reviewer", command, tier: "safe" } },
          );
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
          // 申诉通道：AI 拒后若有人手 approver，弹确认条（不写黑名单）
          const approver = getTerminalApprover();
          if (approver) {
            try {
              const human = await approver(command, {
                ...buildApproverCtx("low"),
                summary:
                  `AI 审核未通过（${verdict.reason || "无理由"}）。仍可确认执行一次。`,
                label: "AI拒·可确认",
                reason: verdict.reason,
                forceHuman: true,
              });
              if (human.approve) {
                if (human.persist === "whitelist") {
                  addToWhitelist(agent, commandPrefix(command));
                }
                recordReviewApprove(agent, command);
                return null;
              }
              if (human.persist === "blacklist") {
                addToBlacklist(agent, commandPrefix(command));
              }
              return toolFail(
                "user_rejected",
                `⛔ 用户确认后仍拒绝：\`${command}\`\nAI 理由：${verdict.reason}`,
                {
                  code: "review-reject-user-denied",
                  payload: {
                    policy: "review-reject-user-denied",
                    command,
                    reason: verdict.reason,
                    tier: "safe",
                  },
                },
              );
            } catch {
              /* 超时等 → 下方拒绝 */
            }
          }
          recordReviewReject(agent, command);
          return toolFail(
            "policy_denied",
            `⛔ 审核未通过：\`${command}\`\n理由：${verdict.reason}\n` +
              `申诉：切换 normal/yolo，或再发完全相同命令（若策略允许二次确认）；` +
              `人手在场时 auto 拒批会弹出确认条。`,
            {
              code: "review-reject",
              payload: {
                policy: "review-reject",
                command,
                reason: verdict.reason,
                tier: "safe",
              },
            },
          );
        } catch (err) {
          return toolFail(
            "policy_denied",
            `🔐 审核异常：\`${command}\`（${errToString(err)}）`,
            { code: "review-error", payload: { policy: "review-error", command, tier: "safe" } },
          );
        }
      }
      if (mode === "yolo") return null;
      // normal：人手审批
      const approver = getTerminalApprover();
      if (approver) {
        try {
          const verdict = await approver(command, buildApproverCtx("low"));
          if (verdict.approve) {
            if (verdict.persist === "whitelist") addToWhitelist(agent, commandPrefix(command));
            return null;
          }
          if (verdict.persist === "blacklist") addToBlacklist(agent, commandPrefix(command));
          return toolFail(
            "user_rejected",
            `⛔ [系统拦截] 用户拒绝了此命令：\`${command}\``,
            { code: "ask-denied", payload: { policy: "ask-denied", command, tier: "safe" } },
          );
        } catch (err) {
          return toolFail(
            "cancelled",
            `🔐 [系统拦截] 命令审批被取消/超时：\`${command}\`（${errToString(err)}）`,
            { code: "ask-cancelled", payload: { policy: "ask-cancelled", command, tier: "safe" } },
          );
        }
      }
      return toolFail(
        "policy_denied",
        `🔐 [安全层·需确认] 非破坏性命令，但当前为审核模式且未在白名单：\`${command}\`\n` +
          `无人审批环境请用文件工具，或切换 yolo / 将命令加入白名单。`,
        {
          code: String((gate.payload as { policy?: string })?.policy ?? "ask_pending"),
          payload: gate.payload,
        },
      );
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
      const result = await be(ctx).run(
        ctx.agentName,
        command,
        cwd,
        description,
        timeoutMs,
        resultLimit,
      );
      await discardTempTerminal(id, result.terminalId, ctx);

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
      const result = await be(ctx).runBackground(
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
    const panel = be(ctx).statusPanel(agent);
    const terminals = be(ctx).list(agent) ?? [];
    let all: TerminalInfo[] = [];
    try {
      all = be(ctx).list() ?? [];
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
      await be(ctx).remove(id, ctx.agentName);
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
      await be(ctx).stop(id, ctx.agentName);
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
      const rawOutput = await be(ctx).logs(id, ctx.agentName, limit);
      const terminals = be(ctx).list(ctx.agentName);
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
      await be(ctx).write(id, ctx.agentName, data);
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

/** 未指定 id 的前台任务：结束后销毁，不占列表（与 TOOL.md / manage list 文案一致） */
async function discardTempTerminal(
  requestedId: string | undefined,
  terminalId: string,
  ctx: ToolContext,
): Promise<void> {
  if (requestedId || !terminalId) return;
  try {
    await be(ctx).remove(terminalId, ctx.agentName);
  } catch {
    /* 仍在跑或已不存在 */
  }
}

// ─── 终端后端初始化（full / mini） ────────────────────────────────────────────

/** 初始化终端后端（full 或 mini；AgentRuntime / WebUI / CLI 调用） */
export function initTerminalEngine(logDir?: string, persistPath?: string): void {
  initActiveBackend(logDir, persistPath);
}

/** 关闭所有终端（WebUI close / 进程退出） */
export function shutdownTerminalEngine(): void {
  shutdownActiveBackend();
}

/** 清理 Agent 的所有终端（由 runtime.ts 在 session 开始时调用） */
export function cleanupAgentTerminals(agentName: string): void {
  try {
    getActiveBackend().cleanupAgent(agentName);
  } catch {
    // best effort
  }
}

/** 获取终端状态面板（由 dynamic-context.ts 注入 prompt） */
export function getTerminalStatusPanel(agentName: string): string {
  try {
    return getActiveBackend().statusPanel(agentName);
  } catch {
    return "";
  }
}

/** 列出终端（供 runtime.ts 注入通知用） */
export function listTerminals(agentName: string): TerminalInfo[] {
  try {
    return getActiveBackend().list(agentName);
  } catch {
    return [];
  }
}

/** 获取终端日志（供 runtime.ts 注入通知用） */
export async function getTerminalLogs(id: string, agentName: string, lines: number): Promise<string> {
  try {
    return await Promise.race([
      getActiveBackend().logs(id, agentName, lines),
      new Promise<string>((resolve) => setTimeout(() => resolve(""), 5000)),
    ]);
  } catch {
    return "";
  }
}
