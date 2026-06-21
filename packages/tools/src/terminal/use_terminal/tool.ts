/**
 * Terminal 工具 — 统一终端
 *
 * 3 种模式：
 *   1. run — 前台/后台运行命令
 *   2. manage — 终端管理 (list/rm/stop/logs)
 *
 * before_user 终端状态面板由 Runtime 层自动注入，无需 AI 主动调用。
 */

import { Tool } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";
import { truncateMiddle, formatMetadata } from "../../browser/god_tool/use_browser/_util.js";
import {
  TERMINAL_REGISTRY,
  generateAutoId,
} from "../../terminal/registry.js";
import { spawnPty, buildSafeEnv } from "../../terminal/pty.js";

/** 后台任务快速等待时间（毫秒） */
const BG_QUICK_WAIT_MS = 1000;

/** 前台超时后 SIGTERM → SIGKILL 宽限期（毫秒） */
const GRACE_PERIOD_MS = 3000;

export class TerminalTool extends Tool {
  readonly definition: ToolDefinition = {
    name: "use_terminal",
    aliases: ["bash", "terminal_manage"],
    description:
      "执行 shell 命令或管理常驻终端。" +
      " action=run 运行命令（前台阻塞或后台运行）；" +
      " action=manage 管理终端（list/rm/stop/logs）。" +
      " 不指定 id 为临时终端，执行完即销毁；指定 id 为持久终端，可反复操作。" +
      " 已存在的 id 会复用该终端执行新任务。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["run", "manage"],
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
    if (action === "run") return this._actionRun(params, ctx);
    if (action === "manage") return this._actionManage(params, ctx);
    return createToolResponse(false, `未知 action: ${action}，可选: run, manage`);
  }

  // ─── run ────────────────────────────────────────────────────────────────────

  private async _actionRun(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const command = String(params.command ?? "").trim();
    if (!command) return createToolResponse(false, "run 操作缺少 command 参数");

    const description = String(params.description ?? "").trim();
    if (!description) return createToolResponse(false, "run 操作缺少 description 参数（任务简介）");

    const id = params.id ? String(params.id) : null;
    const background = Boolean(params.background);
    const cwd = params.cwd
      ? String(params.cwd)
      : ctx.sandboxRoot || ctx.workingDir;
    const timeoutSec = params.timeout != null ? Number(params.timeout) : (background ? 0 : 120);
    const resultLimit = params.result_limit != null ? Number(params.result_limit) : 5000;

    // 指定了 id → 检查是否已被占用
    if (id) {
      const existing = TERMINAL_REGISTRY.get(id);
      if (existing && existing.agentName !== ctx.agentName) {
        return createToolResponse(false, `终端 ${id} 属于另一个 Agent，无法操作`);
      }
      if (existing && existing.state === "running") {
        return createToolResponse(
          false,
          `终端 ${id} 正在运行任务「${existing.description}」，如需执行新命令请先 stop 该终端或等待完成。`,
        );
      }
    }

    if (background) {
      return this._runBackground(id, command, description, cwd, ctx, timeoutSec, resultLimit);
    }
    return this._runForeground(id, command, description, cwd, ctx, timeoutSec, resultLimit);
  }

  /** 前台阻塞执行（临时终端 or 命名终端，超时自动转后台） */
  private _runForeground(
    id: string | null,
    command: string,
    description: string,
    cwd: string,
    ctx: ToolContext,
    timeoutSec: number,
    resultLimit: number,
  ): Promise<ToolResponse> {
    return new Promise((resolve) => {
      const env = buildSafeEnv();
      const pty = spawnPty("/bin/bash", ["-c", command], {
        cwd, env, cols: 120, rows: 36,
      });

      let output = "";
      let settled = false;

      const finish = (resp: ToolResponse) => {
        if (settled) return;
        settled = true;
        resolve(resp);
      };

      pty.onData((data) => { output += data; });

      pty.onExit((e) => {
        const truncated = applyResultLimit(output, resultLimit);
        const ok = e.exitCode === 0;
        const status = ok ? "完成" : `失败(退出码${e.exitCode})`;
        const meta = formatMetadata({ exit_code: e.exitCode, cwd });
        const body = truncated || (ok ? "（无输出）" : `命令${status}`);
        finish(createToolResponse(ok, `${body}\n\n${meta}`, {
          payload: { exit_code: e.exitCode, cwd, terminal_id: id ?? null },
        }));
      });

      // 超时处理
      if (timeoutSec > 0) {
        setTimeout(() => {
          if (settled) return;
          pty.kill("SIGTERM");
          setTimeout(() => {
            if (settled) return;
            pty.kill("SIGKILL");
          }, GRACE_PERIOD_MS);

          // 转后台
          const bgId = id || generateAutoId();
          try {
            const { terminal } = TERMINAL_REGISTRY.createOrReuse({
              agentName: ctx.agentName,
              id: bgId,
              command: "/bin/bash",
              args: ["-c", command],
              cwd,
              description,
              sessionId: ctx.sessionId,
            });
            const truncated = applyResultLimit(output, resultLimit);
            const meta = formatMetadata({ terminal_id: bgId, pid: terminal.pid, cwd });
            finish(createToolResponse(true,
              `任务「${description}」因超时(${timeoutSec}s)已自动转入后台。\n` +
              `终端 ID: ${bgId} (pid ${terminal.pid})\n` +
              (truncated ? `\n已有输出:\n${truncated}\n` : "") +
              `可用 manage stop/logs 查看或结束该任务。\n\n${meta}`,
              { payload: { terminal_id: bgId, pid: terminal.pid, timed_out: true, cwd } },
            ));
            TERMINAL_REGISTRY.persist();
          } catch {
            const truncated = applyResultLimit(output, resultLimit);
            finish(createToolResponse(false,
              `任务「${description}」超时(${timeoutSec}s)且转后台失败。\n${truncated || ""}`,
              { payload: { timed_out: true, cwd } },
            ));
          }
        }, timeoutSec * 1000);
      }
    });
  }

  /** 后台执行：注册到 Registry，等待 1 秒看是否快速完成 */
  private async _runBackground(
    id: string | null,
    command: string,
    description: string,
    cwd: string,
    ctx: ToolContext,
    timeoutSec: number,
    resultLimit: number,
  ): Promise<ToolResponse> {
    const termId = id || generateAutoId();

    let term;
    try {
      const result = TERMINAL_REGISTRY.createOrReuse({
        agentName: ctx.agentName,
        id: termId,
        command: "/bin/bash",
        args: ["-c", command],
        cwd,
        description,
        sessionId: ctx.sessionId,
      });
      term = result.terminal;
    } catch (err: unknown) {
      return createToolResponse(false, String(err instanceof Error ? err.message : err));
    }

    // 阻塞 1 秒等快速完成 / 迅速报错
    await new Promise<void>((resolve) => {
      let done = false;
      const check = () => { if (!done) { done = true; resolve(); } };
      term!.pty!.onExit(() => check());
      setTimeout(check, BG_QUICK_WAIT_MS);
    });

    // 已完成
    if (term.state === "exited") {
      const ok = term.exitCode === 0;
      const output = term.tailChars(Math.max(resultLimit, 1000));
      const truncated = applyResultLimit(output, resultLimit);
      const status = ok ? "已完成" : `已失败(退出码${term.exitCode})`;
      const meta = formatMetadata({ terminal_id: termId, exit_code: term.exitCode, cwd });
      TERMINAL_REGISTRY.persist();
      return createToolResponse(ok,
        `后台任务「${description}」${status}。\n${truncated ? `\n输出:\n${truncated}\n` : ""}\n${meta}`,
        { payload: { terminal_id: termId, exit_code: term.exitCode, cwd } },
      );
    }

    // 设置超时提醒标记
    if (timeoutSec > 0) {
      setTimeout(() => {
        if (term.state === "running") {
          term.timedOut = true;
          TERMINAL_REGISTRY.persist();
          // TODO: Runtime 层检测到此标记后注入 <terminal-message> 通知 AI
        }
      }, timeoutSec * 1000);
    }

    TERMINAL_REGISTRY.persist();
    const meta = formatMetadata({ terminal_id: termId, pid: term.pid, cwd });
    return createToolResponse(true,
      `任务「${description}」已在后台运行。\n` +
      `终端 ID: ${termId} (pid ${term.pid})\n` +
      (timeoutSec > 0 ? `超时: ${timeoutSec}秒后会提醒。\n` : "无超时限制。\n") +
      `完成/失败/超时会自动提醒。\n\n${meta}`,
      { background: true, payload: { terminal_id: termId, pid: term.pid, cwd } },
    );
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

  private _manageList(ctx: ToolContext): Promise<ToolResponse> {
    const panel = TERMINAL_REGISTRY.agentStatusPanel(ctx.agentName);
    if (!panel) {
      return Promise.resolve(createToolResponse(true, "当前没有终端。", {
        payload: { count: 0 },
      }));
    }
    const terminals = TERMINAL_REGISTRY.list(ctx.agentName);
    return Promise.resolve(createToolResponse(true, panel, {
      payload: {
        count: terminals.length,
        terminals: terminals.map((t) => ({
          id: t.id, state: t.state, description: t.description,
          exit_code: t.exitCode, timed_out: t.timedOut,
        })),
      },
    }));
  }

  private _manageRm(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const id = params.id ? String(params.id) : "";
    if (!id) return Promise.resolve(createToolResponse(false, "rm 操作缺少 id 参数"));

    const term = TERMINAL_REGISTRY.get(id);
    if (!term || term.agentName !== ctx.agentName) {
      return Promise.resolve(createToolResponse(false, `终端 ${id} 不存在`));
    }
    if (term.state === "running") {
      return Promise.resolve(createToolResponse(false,
        `终端 ${id} 正在执行任务「${term.description}」，请先 stop 或等待完成再删除。`,
      ));
    }

    TERMINAL_REGISTRY.remove(id, ctx.agentName);
    TERMINAL_REGISTRY.persist();
    return Promise.resolve(createToolResponse(true, `终端 ${id} 已删除。`, {
      payload: { id },
    }));
  }

  private _manageStop(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const id = params.id ? String(params.id) : "";
    if (!id) return Promise.resolve(createToolResponse(false, "stop 操作缺少 id 参数"));

    const term = TERMINAL_REGISTRY.get(id);
    if (!term || term.agentName !== ctx.agentName) {
      return Promise.resolve(createToolResponse(false, `终端 ${id} 不存在`));
    }
    if (term.state !== "running") {
      return Promise.resolve(createToolResponse(false, `终端 ${id} 已退出(exit_code=${term.exitCode})`));
    }

    term.kill("SIGTERM");
    return Promise.resolve(createToolResponse(true, `已向终端 ${id} 发送终止信号。`, {
      payload: { id },
    }));
  }

  private _manageLogs(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const id = params.id ? String(params.id) : "";
    if (!id) return Promise.resolve(createToolResponse(false, "logs 操作缺少 id 参数"));

    const limit = Math.max(0, Number(params.limit ?? 5000) || 5000);
    const term = TERMINAL_REGISTRY.get(id);
    if (!term || term.agentName !== ctx.agentName) {
      return Promise.resolve(createToolResponse(false, `终端 ${id} 不存在`));
    }

    term.lastViewedAt = new Date();
    TERMINAL_REGISTRY.persist();

    const output = limit > 0 ? term.tailChars(limit) : "";
    const stateLabel =
      term.state === "running"
        ? term.timedOut ? "超时运行中" : "运行中"
        : term.state === "exited" ? `已退出(${term.exitCode})` : "已中断";
    const meta = formatMetadata({ id, status: stateLabel, pid: term.pid });

    return Promise.resolve(createToolResponse(true,
      `${output || "（无输出）"}\n\n${meta}`,
      { payload: { id, state: term.state, exit_code: term.exitCode } },
    ));
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
