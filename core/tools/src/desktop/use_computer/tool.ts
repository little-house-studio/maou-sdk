/**
 * 本机桌面控制 — 薄壳。
 * 重型逻辑在 @little-house-studio/computer-use-engine。
 * MCP 式：list 拿目录，call 执行；TOOL.md 不进 system prompt。
 */

import * as computer from "@little-house-studio/computer-use-engine";
import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse, toolFail } from "../../base.js";
import { errToString } from "../../util/common.js";
import { ctxSupportsVision, visionUnavailableMessage } from "../../vision.js";

const EXECUTE_ONLY = new Set<string>(computer.EXECUTE_ONLY_ACTIONS);

export class ComputerTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "use_computer",
    aliases: ["computer", "desktop", "computer_use"],
    deferPrompt: true,
    description:
      "本机桌面控制（MCP 式门面）。网页用 use_browser。\n" +
      "list 拿操作目录；call 执行。截图：call name=screenshot。\n" +
      "每个 agent 一把虚拟光标，互不抢系统指针。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "list",
            "call",
            "screenshot",
            "snapshot",
            "click",
            "type",
            "press",
            "scroll",
            "hotkey",
            "set-value",
            "activate",
            "record",
            "apps",
            "windows",
            "permissions",
            "help",
          ],
          description: "list=目录；call=执行 name+arguments；也可直接写 screenshot/click。",
        },
        name: { type: "string", description: "call 的操作名，如 screenshot / click。" },
        arguments: { type: "object", description: "call 的参数。" },
        target: { type: "string", description: "元素编号，如 [3]。" },
        snapshot: { type: "string", description: "snapshot 返回的 snapshotId。" },
        text: { type: "string", description: "type / press 文本或按键名。" },
        app: { type: "string", description: "应用名或 bundle id。" },
        window: { type: "string", description: "窗口标题。" },
        pid: { type: "integer", description: "目标 PID。" },
        keys: { type: "array", items: { type: "string" }, description: "hotkey 键名。" },
        amount: { type: "number", description: "scroll 行数。" },
        x: { type: "number", description: "屏幕 X。" },
        y: { type: "number", description: "屏幕 Y。" },
        include_image: { type: "boolean", description: "snapshot 是否附带截图。" },
        duration_ms: { type: "integer", description: "record 时长。" },
        path: { type: "string", description: "截图/抽帧保存路径。" },
        mode: { type: "string", enum: ["auto", "ax", "pixels"], description: "覆盖本次路线。" },
        reason: { type: "string", description: "为什么必须调用此工具而不是直接回复用户？" },
      },
      required: ["action", "reason"],
      additionalProperties: false,
    },
    allowedModes: ["plan", "execute"],
    parallelSafe: false,
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const action = String(params.action ?? "").trim();
    if (!action) {
      return toolFail(
        "invalid_args",
        '❌ use_computer 缺少 action。先 list，再 call name=screenshot 或 name=click。',
        { code: "missing_params", details: { missing: ["action"] } },
      );
    }
    const resolved = action === "call"
      ? String(params.name ?? params.tool ?? "").trim()
      : action;
    if (resolved && EXECUTE_ONLY.has(resolved) && ctx.agentMode === "plan") {
      return toolFail(
        "invalid_args",
        `❌ ${resolved} 只能在 execute 模式使用。plan 里用 list / screenshot / snapshot / apps / windows / permissions。`,
        { code: "plan_readonly", details: { action: resolved } },
      );
    }
    try {
      const owner = computer.desktopOwnerFrom(ctx.agentName, ctx.sessionId);
      const r = await computer.run(action, params, {
        mode: computer.parseComputerUseMode(params.mode),
        agentMode: ctx.computerUseMode,
        env: process.env,
        owner,
      });
      return this.wrap(r, ctx);
    } catch (e) {
      return createToolResponse(false, `computer-use 执行失败: ${errToString(e)}`);
    }
  }

  private wrap(r: computer.EngineResult, ctx: ToolContext): ToolResponse {
    const extras: { payload: Record<string, unknown>; images?: { mimeType: string; data: string }[] } = {
      payload: r.payload,
    };
    const imgs = r.images?.length ? r.images : r.imageBase64 ? [r.imageBase64] : [];
    const vision = ctxSupportsVision(ctx);
    if (imgs.length && vision) {
      extras.images = imgs.map((data) => ({ mimeType: "image/png", data }));
    } else if (imgs.length) {
      extras.payload = { ...extras.payload, vision: "stripped" };
    }
    return createToolResponse(
      r.ok,
      imgs.length && !vision ? visionUnavailableMessage(r.message) : r.message,
      extras,
    );
  }
}
