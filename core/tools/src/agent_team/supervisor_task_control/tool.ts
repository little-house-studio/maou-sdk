/**
 * supervisor_task_control —— 监督 Agent 生命周期控制工具。
 *
 * 监督 Agent 专用，仅在 /goal 模式下可用。
 * action:
 *   - start: 启动监督（绑定 plan，进入工作状态）
 *   - confirm_end: 向用户发起验收（第一次确认）
 *   - end: 完全结束监督模式（清除绑定，切回主 Agent）
 */

import { Tool } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { createToolResponse } from "../../base.js";

export class SupervisorTaskControlTool extends Tool {
  readonly definition: ToolDefinition = {
    name: "supervisor_task_control",
    aliases: ["supervisor-control", "supervisor_task"],
    allowedModes: null,
    description:
      "监督 Agent 生命周期控制（仅 /goal 监督模式下可用）。" +
      "action=submit_plan: 写完任务计划后提交给用户确认（进入 confirming_plan）；" +
      "action=start: 用户确认后启动监督（绑定 plan，进入 started，主 Agent 开始持续干活）；" +
      "action=verify: 主 Agent 每轮 loop 完成后自动验收（对照 plan 验收标准 + 本轮汇报判断 pass/fail）；" +
      "action=confirm_end: 验收合格，向用户发起最终验收；" +
      "action=end: 用户最终确认通过，完全结束监督模式。" +
      "必须在监督 Agent session 内调用。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["submit_plan", "start", "verify", "confirm_end", "end"],
          description: "submit_plan=提交计划待确认 | start=用户确认后启动 | verify=自动验收本轮 | confirm_end=合格发起验收 | end=完全结束监督",
        },
        plan: {
          type: "string",
          description:
            "任务计划 MD（action=submit_plan 时必填）—— 包含任务要求、细节、验收标准等。" +
            "用户确认后，这份计划会绑定到主 Agent 作为任务文件，verify 据此验收。",
        },
        summary: {
          type: "string",
          description:
            "任务总结（action=confirm_end 时建议填）—— 简要说明任务完成情况，发给用户验收。",
        },
        round_report: {
          type: "string",
          description:
            "主 Agent 本轮 loop 的汇报内容（action=verify 时填，通常来自 MessageBus 推送的 loop_report）。" +
            "verify 会对照 plan 验收标准 + 此汇报判断是否合格。",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    // 仅监督 Agent session 可用
    if (!ctx.isSupervisorSession) {
      return createToolResponse(
        false,
        "此工具仅在 /goal 监督模式下可用。用 /goal 指令启动监督模式。",
      );
    }

    const mgr = ctx.supervisorManager;
    if (!mgr) {
      return createToolResponse(false, "未注入 supervisorManager（harness 配置错误）。");
    }

    const action = String(params.action ?? "").trim();
    const plan = String(params.plan ?? "").trim();
    const summary = String(params.summary ?? "").trim();

    // 查监督绑定
    const binding = mgr.getBySupervisor(ctx.sessionId);
    if (!binding) {
      return createToolResponse(false, "未找到监督绑定记录（session 可能已过期）。");
    }

    switch (action) {
      case "submit_plan": {
        // 步骤3: supervisor 写完 plan，提交给用户确认（进入 confirming_plan）
        if (!plan) {
          return createToolResponse(false, "action=submit_plan 时必须传 plan（任务计划 MD，含验收标准）。");
        }
        if (binding.state !== "planning" && binding.state !== "confirming_plan") {
          return createToolResponse(false, `当前状态为 ${binding.state}，不能 submit_plan（只能从 planning 提交）。`);
        }
        mgr.updatePlan(binding.mainSessionId, plan);
        mgr.updateState(binding.mainSessionId, "confirming_plan");
        const userMsg =
          `📋 **任务计划待确认**\n\n${plan}\n\n` +
          `---\n请审阅上面的任务计划与验收标准。回复"确认"开始监督（主 Agent 将持续执行，supervisor 自动验收）；` +
          `或直接说明需要修改的地方。`;
        return createToolResponse(
          true,
          userMsg,
          { payload: { state: "confirming_plan", planLength: plan.length } },
        );
      }
      case "start": {
        // 步骤3: 用户确认 plan 后，supervisor 调 start 正式启动监督
        if (binding.state !== "confirming_plan") {
          return createToolResponse(
            false,
            `当前状态为 ${binding.state}，不能 start。请先 submit_plan 提交计划给用户确认，用户确认后才能 start。`,
          );
        }
        if (!binding.plan) {
          return createToolResponse(false, "plan 未绑定（submit_plan 时应已写入，请检查）。");
        }
        mgr.updateState(binding.mainSessionId, "started");
        return createToolResponse(
          true,
          "✅ 监督已启动。任务计划已绑定。主 Agent 将开始持续执行；每轮 loop 完成后请用 verify action 自动验收。",
          { payload: { state: "started", planLength: binding.plan.length } },
        );
      }
      case "verify": {
        // 步骤2+4: 自动验收本轮 loop 汇报，对照 plan 验收标准判断 pass/fail
        if (binding.state !== "started") {
          return createToolResponse(false, `当前状态为 ${binding.state}，只能在 started 状态验收。`);
        }
        const roundReport = String(params.round_report ?? "").trim();
        const planRef = binding.plan ?? "(未绑定 plan)";
        // 去重：主 Agent 的 loop_report 推送 与 chat_main 工具返回值 会带来同一轮汇报的两份副本。
        // 若本次 round_report 与上次验收的内容指纹相同，直接复用上次结论，不重复调辅助模型、不累加计数。
        const fingerprint = roundReport.slice(0, 200);
        if (roundReport && binding.lastVerifiedReportFingerprint === fingerprint && binding.lastVerdict) {
          return createToolResponse(
            true,
            `ℹ️ 本轮汇报与上次验收内容一致，复用上次结论（${binding.lastVerdict === "pass" ? "合格" : "不合格"}），不重复验收。`,
            { payload: { state: "started", deduplicated: true, verdict: binding.lastVerdict } },
          );
        }
        // 复用 auxModelCaller（同 llm_judge 机制）做独立验收判断
        const aux = ctx.auxModelCaller;
        const mainPreset = ctx.mainPreset;
        if (!aux || !mainPreset) {
          // 无辅助模型 → 退化为提示 supervisor 自己判断
          return createToolResponse(
            true,
            `⚠️ 未注入辅助模型，无法自动验收。请 supervisor 对照 plan 验收标准人工判断本轮汇报：\n${roundReport || "(无汇报)"}\n\n` +
              `判断合格 → 调 confirm_end；不合格 → 调 supervisor_chat_main 派新需求。`,
            { payload: { state: "started", autoVerify: false } },
          );
        }
        const helperPreset = ctx.resolveHelperPreset ? ctx.resolveHelperPreset(ctx.agentName, mainPreset) : mainPreset;
        const systemPrompt =
          "你是独立的验收判断模型。supervisor 把主 Agent 一轮 loop 的汇报 + 任务计划的验收标准交给你。" +
          "请严格对照验收标准判断本轮是否合格。输出 JSON：{\"pass\": true/false, \"reason\": \"...\", \"next_requirement\": \"不合格时派给主 Agent 的新需求\"}。" +
          "不要输出 JSON 以外的文字。";
        const userPrompt =
          `## 任务计划与验收标准\n${planRef}\n\n## 主 Agent 本轮 loop 汇报\n${roundReport || "(无汇报)"}`;
        try {
          const result = await aux.callJson(
            {
              preset: helperPreset,
              systemPrompt,
              userPrompt,
              context: { sessionId: ctx.sessionId, tag: `supervisor_verify:${ctx.agentName}` },
            },
            mainPreset,
          );
          if (!result.ok || !result.json) {
            return createToolResponse(false, `验收模型调用失败${result.error ? `：${result.error}` : ""}（preset=${result.presetName}）。`);
          }
          const verdict = result.json as { pass?: boolean; reason?: string; next_requirement?: string };
          const passed = verdict.pass === true;
          const reason = String(verdict.reason ?? "").trim();
          const nextReq = String(verdict.next_requirement ?? "").trim();

          // 记录本次验收的指纹（供下次去重）
          binding.lastVerifiedReportFingerprint = fingerprint;
          // 步骤4: 防死循环 —— 记录验收轮数 + 同因连续命中
          binding.verifyRounds += 1;
          const MAX_STREAK = 5;
          if (passed) {
            binding.sameReasonStreak = 0;
            binding.lastFailReason = undefined;
          } else {
            if (reason && binding.lastFailReason === reason) {
              binding.sameReasonStreak += 1;
            } else {
              binding.lastFailReason = reason;
              binding.sameReasonStreak = 1;
            }
          }
          // 同因连续 fail 达上限 → 不改状态，提示 supervisor 转人工（让 supervisor 主动调 confirm_end）
          // 不在这里偷偷改状态：所有状态流转都由 supervisor 主动调工具完成，状态机语义保持一致。
          if (binding.sameReasonStreak >= MAX_STREAK) {
            binding.lastVerdict = "loop";
            return createToolResponse(
              true,
              `⚠️ 监督陷入循环（同一验收失败原因连续 ${MAX_STREAK} 次：${reason}），需人工介入。\n` +
                `请调 supervisor_task_control action=confirm_end 向用户发起验收，请用户检查任务方向或调整验收标准。\n` +
                `（状态仍为 started，调用 confirm_end 会转入 confirming）`,
              { payload: { state: "started", loopDetected: true, streak: binding.sameReasonStreak, verdict: "loop" } },
            );
          }

          if (passed) {
            // 合格 → 提示 supervisor 调 confirm_end 发起最终验收
            binding.lastVerdict = "pass";
            return createToolResponse(
              true,
              `✅ 本轮验收合格（第 ${binding.verifyRounds} 轮）。原因：${reason || "符合验收标准"}。\n` +
                `请调 supervisor_task_control action=confirm_end 向用户发起最终验收。`,
              { payload: { state: "started", verdict: "pass", verifyRounds: binding.verifyRounds } },
            );
          }
          // 不合格 → 提示 supervisor 用 chat_main 派新需求给主 Agent
          binding.lastVerdict = "fail";
          const dispatchHint = nextReq
            ? `建议派发的新需求：${nextReq}`
            : "请根据失败原因拟定新需求";
          return createToolResponse(
            true,
            `❌ 本轮验收不合格（第 ${binding.verifyRounds} 轮，同因连续 ${binding.sameReasonStreak}/${MAX_STREAK}）。原因：${reason}\n` +
              `${dispatchHint}\n` +
              `请调 supervisor_chat_main 把新需求派给主 Agent，主 Agent 会继续下一轮 loop。`,
            { payload: { state: "started", verdict: "fail", verifyRounds: binding.verifyRounds, nextRequirement: nextReq } },
          );
        } catch (err) {
          return createToolResponse(false, `验收模型调用异常: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      case "confirm_end": {
        if (binding.state !== "started") {
          return createToolResponse(false, `当前状态为 ${binding.state}，只能从 started 状态发起验收（请先 verify 通过）。`);
        }
        mgr.updateState(binding.mainSessionId, "confirming");
        const userMsg = summary
          ? `📋 **任务完成验收**\n\n${summary}\n\n请确认是否可以结束监督模式（回复"确认"或"继续修改"）。`
          : `📋 **任务完成验收**\n\n主 Agent 已汇报任务完成且 supervisor 验收通过。请确认是否可以结束监督模式（回复"确认"或"继续修改"）。`;
        return createToolResponse(
          true,
          userMsg,
          { payload: { state: "confirming" } },
        );
      }
      case "end": {
        if (binding.state !== "confirming") {
          return createToolResponse(false, `当前状态为 ${binding.state}，只能从 confirming 状态结束（请先 confirm_end）。`);
        }
        mgr.updateState(binding.mainSessionId, "ended");
        const unbound = mgr.unbind(binding.mainSessionId);
        return createToolResponse(
          true,
          "✅ 监督模式已结束。聊天对象切换回主 Agent。",
          {
            payload: { state: "ended", unbound },
            // 通过 displayEvents 通知前端切换 session
            displayEvents: [{
              type: "supervisor_end",
              text: binding.mainSessionId,
              stream: "info",
            }],
          },
        );
      }
      default:
        return createToolResponse(false, `不支持的 action: ${action}。支持: submit_plan / start / verify / confirm_end / end`);
    }
  }
}
