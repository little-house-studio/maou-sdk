/**
 * 本机桌面控制 — 薄壳。
 * 重型逻辑在 @little-house-studio/computer-use-engine。
 */

import * as computer from "@little-house-studio/computer-use-engine";
import { Tool, toolDir } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse, toolFail } from "../../base.js";
import { errToString } from "../../util/common.js";

const OBSERVE = new Set<string>(computer.OBSERVE_ACTIONS);
const EXECUTE_ONLY = new Set<string>(computer.EXECUTE_ONLY_ACTIONS);

export class ComputerTool extends Tool {
  readonly schemaDir = toolDir(import.meta.url);
  readonly definition: ToolDefinition = {
    name: "use_computer",
    aliases: ["computer", "desktop", "computer_use"],
    description:
      "控制本机桌面 App（macOS 系统控件树优先；失败可降级截图/抽帧 + 键鼠）。\n" +
      "网页用 use_browser，不要用本工具点浏览器 DOM。\n\n" +
      "【流程】\n" +
      "1. permissions 看辅助功能 / 屏幕录制\n" +
      "2. snapshot app='Finder' → 元素 [N] 与 snapshotId\n" +
      "3. click/type target='[N]' snapshot='cu1_…'\n\n" +
      "【路线】auto（默认）先走控件树；ax 锁死树；pixels 只走截图坐标。\n" +
      "选型：MAOU_COMPUTER_USE → agent.json computerUse.mode → config.json computerUse.mode。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "snapshot",
            "click",
            "type",
            "press",
            "scroll",
            "hotkey",
            "set-value",
            "activate",
            "screenshot",
            "record",
            "apps",
            "windows",
            "permissions",
            "help",
          ],
          description: "操作类型。先 activate / snapshot，再 click/type。",
        },
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
        '❌ use_computer 缺少必填参数 action。正确用法：{"tool":"use_computer","params":{"action":"snapshot","app":"Finder","reason":"看桌面控件"}}',
        { code: "missing_params", details: { missing: ["action"] } },
      );
    }
    if (EXECUTE_ONLY.has(action) && ctx.agentMode === "plan") {
      return toolFail(
        "invalid_args",
        `❌ ${action} 只能在 execute 模式使用。plan 里用 snapshot / screenshot / apps / windows / permissions。`,
        { code: "plan_readonly", details: { action } },
      );
    }
    if (!OBSERVE.has(action) && !EXECUTE_ONLY.has(action) && action !== "state") {
      if (action !== "help" && action !== "available" && action !== "status") {
        /* run() 自己会报未知操作 */
      }
    }
    try {
      const r = await computer.run(action, params, {
        mode: computer.parseComputerUseMode(params.mode),
        agentMode: ctx.computerUseMode,
        env: process.env,
      });
      return this.wrap(r);
    } catch (e) {
      return createToolResponse(false, `computer-use 执行失败: ${errToString(e)}`);
    }
  }

  private wrap(r: computer.EngineResult): ToolResponse {
    const extras: { payload: Record<string, unknown>; images?: { mimeType: string; data: string }[] } = {
      payload: r.payload,
    };
    const imgs = r.images?.length ? r.images : r.imageBase64 ? [r.imageBase64] : [];
    if (imgs.length) {
      extras.images = imgs.map((data) => ({ mimeType: "image/png", data }));
    }
    return createToolResponse(r.ok, r.message, extras);
  }
}
