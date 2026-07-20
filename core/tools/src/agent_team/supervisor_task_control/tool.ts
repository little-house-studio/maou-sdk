/**
 * supervisor_task_control —— 监督 Agent 生命周期控制工具。
 *
 * 监督 Agent 专用，仅在 /goal 模式下可用。
 * action:
 *   - start: 启动监督（绑定 plan，进入工作状态）
 *   - confirm_end: 向用户发起验收（第一次确认）
 *   - end: 完全结束监督模式（清除绑定，切回主 Agent）
 *
 * P3 扩展：
 *   - plan 内可含 ```json:plan stages``` 分阶段
 *   - verify 支持 check_command 硬指标（安全子集，见 hard-check）
 */

import { Tool } from "../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../base.js";
import { resolveToolRuntimePorts } from "../../base.js";
import { createToolResponse } from "../../base.js";
import { runHardCheck } from "../../security/hard-check.js";
import { parsePlanStages, formatStageStatus } from "../plan-stages.js";

export class SupervisorTaskControlTool extends Tool {
  readonly definition: ToolDefinition = {
    name: "supervisor_task_control",
    aliases: ["supervisor-control", "supervisor_task"],
    allowedModes: null,
    description:
      "监督 Agent 生命周期控制（仅 /goal 监督模式下可用）。" +
      "action=submit_plan: 写完任务计划后提交给用户确认（进入 confirming_plan）；" +
      "action=start: 用户确认后启动监督（绑定 plan，进入 started，主 Agent 开始持续干活）；" +
      "action=verify: 主 Agent 每轮 loop 完成后自动验收（硬指标 check_command 优先，再对照 plan；支持分阶段）；" +
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
            "任务计划 MD（action=submit_plan 时必填）—— 含验收标准；可选 ```json:plan {\"stages\":[...]} ``` 分阶段。" +
            "用户确认后绑定；verify 据此验收。",
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
        check_command: {
          type: "string",
          description:
            "可选硬指标命令（action=verify）。仅允许白名单解释器+项目内脚本，无 shell 元字符。" +
            "例：node scripts/check-stage1.mjs 。退出码 0=pass。若 plan 当前阶段已带 check_command 可省略。",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    // 仅监督 Agent session 可用
    const ports = resolveToolRuntimePorts(ctx);
    if (!ports.isSupervisorSession) {
      return createToolResponse(
        false,
        "此工具仅在 /goal 监督模式下可用。用 /goal 指令启动监督模式。",
      );
    }

    const mgr = ports.supervisorManager;
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
        const parsed = parsePlanStages(plan);
        mgr.updatePlan(binding.mainSessionId, plan);
        if (mgr.setStages) {
          if (parsed.stages.length > 0) {
            mgr.setStages(
              binding.mainSessionId,
              parsed.stages.map((s) => ({
                id: s.id,
                title: s.title,
                success: s.success,
                check_command: s.check_command,
              })),
            );
          } else {
            // 清除旧阶段（重新 submit 时）
            mgr.setStages(binding.mainSessionId, []);
          }
        }
        mgr.updateState(binding.mainSessionId, "confirming_plan");
        const stageHint =
          parsed.stages.length > 0
            ? `\n\n${formatStageStatus({ stages: parsed.stages, currentStageIndex: 0 })}\n`
            : "";
        const userMsg =
          `📋 **任务计划待确认**\n\n${plan}${stageHint}\n` +
          `---\n请审阅上面的任务计划与验收标准。回复"确认"开始监督（主 Agent 将持续执行，supervisor 自动验收）；` +
          `或直接说明需要修改的地方。`;
        return createToolResponse(
          true,
          userMsg,
          {
            payload: {
              state: "confirming_plan",
              planLength: plan.length,
              stages: parsed.stages.length,
            },
          },
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
        // P3: 硬指标 check_command 优先；分阶段门禁
        if (binding.state !== "started") {
          return createToolResponse(false, `当前状态为 ${binding.state}，只能在 started 状态验收。`);
        }
        const roundReport = String(params.round_report ?? "").trim();
        const planRef = binding.plan ?? "(未绑定 plan)";
        const fingerprint = [
          roundReport.slice(0, 200),
          String(params.check_command ?? ""),
          String(binding.currentStageIndex ?? 0),
        ].join("|");
        if (roundReport && binding.lastVerifiedReportFingerprint === fingerprint && binding.lastVerdict) {
          return createToolResponse(
            true,
            `ℹ️ 本轮汇报与上次验收内容一致，复用上次结论（${binding.lastVerdict === "pass" ? "合格" : "不合格"}），不重复验收。`,
            { payload: { state: "started", deduplicated: true, verdict: binding.lastVerdict } },
          );
        }

        const stages = binding.stages ?? [];
        const stageIdx = binding.currentStageIndex ?? 0;
        const currentStage = stages.length > 0 ? stages[stageIdx] : undefined;
        const checkCmd = String(
          params.check_command ?? currentStage?.check_command ?? "",
        ).trim();

        // ── 硬指标（可选，安全子集）──
        if (checkCmd) {
          const projectRoot = ctx.workingDir || ctx.projectRoot || process.cwd();
          const hard = await runHardCheck({
            projectRoot,
            command: checkCmd,
            timeoutMs: 60_000,
          });
          binding.verifyRounds += 1;
          binding.lastVerifiedReportFingerprint = fingerprint;

          if (!hard.ok) {
            const reason =
              hard.error ||
              `硬指标失败 exit=${hard.code} cmd=${hard.commandLine}\nstdout: ${hard.stdout.slice(0, 500)}\nstderr: ${hard.stderr.slice(0, 500)}`;
            binding.lastVerdict = "fail";
            if (binding.lastFailReason === reason) binding.sameReasonStreak += 1;
            else {
              binding.lastFailReason = reason;
              binding.sameReasonStreak = 1;
            }
            const stageLine = currentStage
              ? `当前阶段 **${currentStage.id}** 未通过硬指标。\n`
              : "";
            return createToolResponse(
              true,
              `❌ 硬指标不合格（第 ${binding.verifyRounds} 轮）。${stageLine}原因：${reason}\n` +
                `请调 supervisor_chat_main 派新需求；**不得**进入下一阶段。\n` +
                (stages.length
                  ? formatStageStatus({
                      stages,
                      currentStageIndex: stageIdx,
                      stageResults: binding.stageResults,
                    })
                  : ""),
              {
                payload: {
                  state: "started",
                  verdict: "fail",
                  hardCheck: true,
                  verifyRounds: binding.verifyRounds,
                  stageId: currentStage?.id,
                },
              },
            );
          }

          // 硬指标通过
          if (currentStage && mgr.advanceStage) {
            mgr.advanceStage(binding.mainSessionId, {
              id: currentStage.id,
              pass: true,
              at: Date.now(),
              reason: `hard check ok: ${hard.commandLine}`,
            });
            const allDone = mgr.allStagesPassed
              ? mgr.allStagesPassed(binding.mainSessionId)
              : true;
            binding.sameReasonStreak = 0;
            binding.lastFailReason = undefined;
            if (allDone) {
              binding.lastVerdict = "pass";
              return createToolResponse(
                true,
                `✅ 硬指标通过，且全部分阶段已完成（第 ${binding.verifyRounds} 轮）。\n` +
                  `请调 supervisor_task_control action=confirm_end 向用户发起最终验收。\n` +
                  formatStageStatus({
                    stages,
                    currentStageIndex: binding.currentStageIndex ?? stages.length,
                    stageResults: binding.stageResults,
                  }),
                {
                  payload: {
                    state: "started",
                    verdict: "pass",
                    hardCheck: true,
                    stagesComplete: true,
                    verifyRounds: binding.verifyRounds,
                  },
                },
              );
            }
            // 还有下一阶段：不算总 pass，要求主 Agent 继续
            binding.lastVerdict = "fail";
            const next = stages[binding.currentStageIndex ?? stageIdx + 1];
            return createToolResponse(
              true,
              `✅ 阶段 **${currentStage.id}** 硬指标通过，进入下一阶段 **${next?.id ?? "?"}**。\n` +
                `请用 supervisor_chat_main 派发下一阶段任务（勿 confirm_end）。\n` +
                formatStageStatus({
                  stages,
                  currentStageIndex: binding.currentStageIndex ?? 0,
                  stageResults: binding.stageResults,
                }),
              {
                payload: {
                  state: "started",
                  verdict: "stage_pass",
                  hardCheck: true,
                  nextStageId: next?.id,
                  verifyRounds: binding.verifyRounds,
                },
              },
            );
          }

          // 无分阶段 + 硬指标通过 → 可直接视为合格（仍建议 confirm_end）
          binding.lastVerdict = "pass";
          binding.sameReasonStreak = 0;
          return createToolResponse(
            true,
            `✅ 硬指标通过（第 ${binding.verifyRounds} 轮）：${hard.commandLine}\n` +
              `请调 supervisor_task_control action=confirm_end 向用户发起最终验收。`,
            {
              payload: {
                state: "started",
                verdict: "pass",
                hardCheck: true,
                verifyRounds: binding.verifyRounds,
              },
            },
          );
        }

        // ── 无硬指标：LLM 验收（原逻辑）──
        const aux = ports.auxModelCaller;
        const mainPreset = ports.mainPreset;
        const stageBlock =
          stages.length > 0
            ? `\n\n${formatStageStatus({
                stages,
                currentStageIndex: stageIdx,
                stageResults: binding.stageResults,
              })}\n` +
              (currentStage
                ? `请只判断**当前阶段 ${currentStage.id}** 是否达标；未完成当前阶段不得判定总任务完成。\n`
                : "")
            : "";

        if (!aux || !mainPreset) {
          return createToolResponse(
            true,
            `⚠️ 未注入辅助模型，无法自动验收。请 supervisor 对照 plan 验收标准人工判断本轮汇报：\n${roundReport || "(无汇报)"}${stageBlock}\n\n` +
              `判断合格 → 调 confirm_end（或进入下一阶段）；不合格 → 调 supervisor_chat_main 派新需求。` +
              (checkCmd ? "" : "\n提示：可在 verify 时传 check_command 做硬指标。"),
            { payload: { state: "started", autoVerify: false } },
          );
        }
        const helperPreset = ports.resolveHelperPreset
          ? ports.resolveHelperPreset(ctx.agentName, mainPreset)
          : mainPreset;
        const systemPrompt =
          "你是独立的验收判断模型。supervisor 把主 Agent 一轮 loop 的汇报 + 任务计划的验收标准交给你。" +
          "请严格对照验收标准判断本轮是否合格。输出 JSON：{\"pass\": true/false, \"reason\": \"...\", \"next_requirement\": \"不合格时派给主 Agent 的新需求\"}。" +
          (stages.length
            ? "若存在分阶段，仅判断当前阶段；当前阶段合格才 pass=true。"
            : "") +
          "不要输出 JSON 以外的文字。";
        const userPrompt =
          `## 任务计划与验收标准\n${planRef}${stageBlock}\n\n## 主 Agent 本轮 loop 汇报\n${roundReport || "(无汇报)"}`;
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
          let passed = verdict.pass === true;
          const reason = String(verdict.reason ?? "").trim();
          const nextReq = String(verdict.next_requirement ?? "").trim();

          binding.lastVerifiedReportFingerprint = fingerprint;
          binding.verifyRounds += 1;
          const MAX_STREAK = 5;

          // 分阶段：LLM pass → 推进阶段；未全部完成则不算总 pass
          if (passed && currentStage && mgr.advanceStage) {
            mgr.advanceStage(binding.mainSessionId, {
              id: currentStage.id,
              pass: true,
              at: Date.now(),
              reason: reason || "llm pass",
            });
            const stagesDone = mgr.allStagesPassed
              ? mgr.allStagesPassed(binding.mainSessionId)
              : true;
            if (!stagesDone) {
              passed = false;
              const next = stages[binding.currentStageIndex ?? 0];
              binding.lastVerdict = "fail";
              binding.sameReasonStreak = 0;
              return createToolResponse(
                true,
                `✅ 阶段 **${currentStage.id}** 验收通过，进入 **${next?.id ?? "?"}**。\n` +
                  `请 supervisor_chat_main 派下一阶段任务（勿 confirm_end）。\n` +
                  formatStageStatus({
                    stages,
                    currentStageIndex: binding.currentStageIndex ?? 0,
                    stageResults: binding.stageResults,
                  }),
                {
                  payload: {
                    state: "started",
                    verdict: "stage_pass",
                    nextStageId: next?.id,
                    verifyRounds: binding.verifyRounds,
                  },
                },
              );
            }
          }

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

          const MAX_VERIFY_ROUNDS = 30;
          if (binding.verifyRounds >= MAX_VERIFY_ROUNDS && !passed) {
            binding.lastVerdict = "loop";
            return createToolResponse(
              true,
              `⚠️ 已验收 ${binding.verifyRounds} 次（上限 ${MAX_VERIFY_ROUNDS}）仍不合格，达打回次数上限，强制转人工介入。\n` +
                `主 Agent 经多轮修正仍未达标，可能是任务难度超出当前模型能力或验收标准过高。\n` +
                `请调 supervisor_task_control action=confirm_end 向用户汇报现状，请用户决定：放宽验收 / 手动接手 / 终止。`,
              { payload: { state: "started", loopDetected: true, verifyRounds: binding.verifyRounds, verdict: "max_rounds" } },
            );
          }

          if (passed) {
            binding.lastVerdict = "pass";
            return createToolResponse(
              true,
              `✅ 本轮验收合格（第 ${binding.verifyRounds} 轮）。原因：${reason || "符合验收标准"}。\n` +
                `请调 supervisor_task_control action=confirm_end 向用户发起最终验收。`,
              { payload: { state: "started", verdict: "pass", verifyRounds: binding.verifyRounds } },
            );
          }
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
