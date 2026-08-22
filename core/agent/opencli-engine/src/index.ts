/**
 * OpenCLI 引擎公共 API
 * 所有 opencli I/O + argv 映射 + 协议解析/格式化在本包内。
 * 返回 EngineResult（含已格式化 message + payload），工具层只做 ToolResponse 封装。
 */

import { SHORTCUTS, knownActions, truncate, formatEnvelope, MSG_LIMIT } from "./shortcuts.js";
import { isAvailable, runOpencli, runOpencliAsync } from "./exec.js";
import type { EngineResult, MultiStep, MultiResult, OpencliEnvelope } from "./types.js";

export { isAvailable, knownActions };
export type { EngineResult, MultiStep, OpencliEnvelope } from "./types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── 单命令 ──────────────────────────────────────────────────────────────

/**
 * 执行一个 action（通过 SHORTCUTS 映射）。
 * screenshot 无 path 时在 imageBase64 返回 base64。
 */
export async function run(
  session: string,
  action: string,
  params: Record<string, string>,
  opts: { cwd: string },
): Promise<EngineResult> {
  if (action === "help") {
    const r = await runOpencli(["--help"], session, opts.cwd);
    return finalize(r, "--help");
  }

  const shortcut = SHORTCUTS[action];
  if (!shortcut) {
    return {
      ok: false,
      message: `未知操作: ${action}。action='help' 查看所有可用操作。\n提示: open 打开网页后用 state 查看，用 tab 参数指定标签页。`,
      payload: { unknown_action: action },
    };
  }

  const args = shortcut(params);
  const r = await runOpencli(args, session, opts.cwd);

  // screenshot 特殊处理：无 path 时返回 base64
  if (action === "screenshot" && !args.some((a) => a.startsWith("/") || a.startsWith("."))) {
    let base64Data = "";
    const env = r.envelope as Record<string, unknown> | null;
    if (env && typeof env.image === "string") {
      base64Data = env.image as string;
    } else if (r.stdoutStr && !r.stdoutStr.startsWith("{")) {
      base64Data = r.stdoutStr.replace(/\s/g, "");
    }
    if (base64Data && base64Data.length > 100) {
      const formatted = r.envelope ? formatEnvelope(r.envelope) : "截图完成";
      return {
        ok: true,
        message: `${formatted}\n\n[screenshot 退出码: ${r.exitCode}]`,
        payload: { exit_code: r.exitCode, envelope: r.envelope },
        imageBase64: base64Data,
      };
    }
  }

  return finalize(r, args[0] ?? action);
}

/** 直接执行原始命令（action=run） */
export async function runRaw(session: string, commandArgs: string[], opts: { cwd: string }): Promise<EngineResult> {
  const r = await runOpencli(commandArgs, session, opts.cwd);
  return finalize(r, commandArgs[0] ?? "run");
}

function finalize(r: Awaited<ReturnType<typeof runOpencli>>, cmdName: string): EngineResult {
  let message: string;
  if (r.envelope) {
    const formatted = formatEnvelope(r.envelope);
    message = truncate(formatted, MSG_LIMIT);
    if (message !== formatted) message += `\n(输出已截断，原始 ${r.rawText.length} 字符)`;
  } else {
    const raw = r.rawText || (r.exitCode === 0 ? "操作完成（无输出）" : `操作失败，退出码: ${r.exitCode}`);
    message = truncate(raw, MSG_LIMIT);
    if (message !== raw) message += `\n(输出已截断，原始 ${raw.length} 字符)`;
  }
  message += `\n\n[${cmdName} 退出码: ${r.exitCode}]`;
  return {
    ok: r.exitCode === 0,
    message,
    payload: { exit_code: r.exitCode, envelope: r.envelope, raw_stdout: r.stdoutStr, raw_stderr: r.stderrStr },
  };
}

// ─── 批量（同 session，顺序 execFile，无 shell）────────────────────────────

export async function batch(
  session: string,
  steps: Array<Record<string, string>>,
  opts: { cwd: string },
): Promise<EngineResult> {
  if (!steps || steps.length === 0) {
    return { ok: false, message: "batch 需要 steps 数组", payload: {} };
  }

  const outputs: string[] = [];
  let allOk = true;
  for (const step of steps) {
    const stepAction = String(step.action ?? "").trim();
    const shortcut = SHORTCUTS[stepAction];
    if (!shortcut) {
      outputs.push(`--- ${stepAction} ---\n[跳过] 未知操作`);
      continue;
    }
    const stepSession = step.session || session;
    const args = shortcut({
      url: step.url || "", target: step.target || "", text: step.text || "", js: step.js || "",
      tab: step.tab || "", subtype: String(step.subtype ?? ""), nth: String(step.nth ?? ""),
      amount: String(step.amount ?? ""), timeout: String(step.timeout ?? ""),
    });
    const r = await runOpencli(args, stepSession, opts.cwd);
    if (r.exitCode !== 0) allOk = false;
    outputs.push(`--- ${stepAction} [${stepSession}] ---\n${r.message}`);
  }

  const rawOutput = outputs.join("\n");
  const truncated = truncate(rawOutput, MSG_LIMIT);
  const meta = `[batch ${steps.length} 步, ${allOk ? "全部成功" : "有失败"}, 输出: ${rawOutput.length} 字符${truncated !== rawOutput ? " (已截断)" : ""}]`;
  return {
    ok: allOk,
    message: `${truncated}\n\n${meta}`,
    payload: { step_count: steps.length, all_ok: allOk },
  };
}

// ─── 跨工作区批量 + 模板变量 ────────────────────────────────────────────────

export async function multi(steps: MultiStep[], opts: { cwd: string }): Promise<EngineResult> {
  if (!steps || steps.length === 0) {
    return { ok: false, message: "multi 需要 steps 数组", payload: {} };
  }

  const results: MultiResult[] = [];
  const contextData: Record<string, string> = {};

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepSession = step.session || "default";
    const stepAction = step.action;

    if (stepAction === "watch") {
      try {
        const w = await watch(stepSession, {
          tab: step.tab,
          watch_target: step.watch_target || step.target,
          watch_type: step.watch_type || "change",
          timeout: step.timeout || "60000",
          poll_interval: step.poll_interval || "2000",
          extract_js: step.extract_js,
        }, opts);
        results.push({ step: i + 1, session: stepSession, action: stepAction, success: w.ok, message: truncate(w.message, 500), data: w.payload });
        if (w.payload?.extracted) contextData[`step${i + 1}`] = String(w.payload.extracted);
      } catch (err) {
        results.push({ step: i + 1, session: stepSession, action: stepAction, success: false, message: `watch 错误: ${err}` });
        if (!step.continue_on_error) break;
      }
      continue;
    }

    const shortcut = SHORTCUTS[stepAction];
    if (!shortcut) {
      results.push({ step: i + 1, session: stepSession, action: stepAction, success: false, message: `未知操作: ${stepAction}` });
      if (!step.continue_on_error) break;
      continue;
    }

    let resolvedText = step.text || "";
    for (const [key, value] of Object.entries(contextData)) {
      resolvedText = resolvedText.replace(`{{${key}}}`, value);
    }

    const args = shortcut({
      url: step.url || "", target: step.target || "", text: resolvedText, js: step.js || "",
      tab: step.tab || "", subtype: String(step.subtype ?? ""), nth: String(step.nth ?? ""),
      amount: String(step.amount ?? ""), timeout: String(step.timeout ?? ""), wait_type: step.wait_type || "",
    });

    try {
      const r = await runOpencliAsync(args, stepSession, opts.cwd);
      results.push({ step: i + 1, session: stepSession, action: stepAction, success: r.success, message: truncate(r.message, 500), data: { envelope: r.envelope, rawText: r.rawText } });
      if (stepAction === "eval" && r.envelope && typeof r.envelope === "object") {
        const env = r.envelope as Record<string, unknown>;
        if (env.value !== undefined) contextData[`step${i + 1}`] = String(env.value);
      }
      if (!r.success && !step.continue_on_error) break;
    } catch (err) {
      results.push({ step: i + 1, session: stepSession, action: stepAction, success: false, message: `执行错误: ${err}` });
      if (!step.continue_on_error) break;
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const summary = `完成 ${successCount}/${results.length} 步`;
  const details = results.map((r) => `[${r.step}] ${r.session}/${r.action}: ${r.success ? "✅" : "❌"} ${r.message}`).join("\n");
  return {
    ok: successCount === results.length,
    message: `${summary}\n\n${details}`,
    payload: { results, successCount, totalCount: results.length, contextData },
  };
}

// ─── 监听变化（后端轮询）────────────────────────────────────────────────────

export async function watch(
  session: string,
  params: { tab?: string; watch_target?: string; target?: string; watch_type?: string; timeout?: string; poll_interval?: string; extract_js?: string },
  opts: { cwd: string },
): Promise<EngineResult> {
  const tab = String(params.tab ?? "");
  const watchType = String(params.watch_type ?? "change");
  const target = String(params.watch_target ?? params.target ?? "body");
  const timeout = parseInt(String(params.timeout ?? "60000"));
  const pollInterval = parseInt(String(params.poll_interval ?? "2000"));
  const extractJs = String(params.extract_js ?? "");

  const startTime = Date.now();
  let lastContent = "";
  let pollCount = 0;

  try {
    lastContent = await getStateContent(session, tab, target, watchType, extractJs, opts.cwd);
    if (watchType === "selector" && lastContent === "found") {
      return { ok: true, message: `✅ 检测到元素 "${target}" (0ms, 初始状态已存在)`, payload: { matched: true, target, extracted: lastContent } };
    }
    if (watchType === "text" && target && lastContent.includes(target)) {
      return { ok: true, message: `✅ 检测到文本 "${target}" (0ms, 初始状态已包含)`, payload: { matched: true, text: target, extracted: lastContent } };
    }
  } catch { /* 初始获取失败，继续 */ }

  while (Date.now() - startTime < timeout) {
    await sleep(pollInterval);
    pollCount++;
    try {
      const current = await getStateContent(session, tab, target, watchType, extractJs, opts.cwd);
      if (watchType === "selector" && current === "found") {
        return { ok: true, message: `✅ 检测到元素 "${target}" (${Date.now() - startTime}ms, ${pollCount} 次轮询)`, payload: { matched: true, target, extracted: current } };
      }
      if (watchType === "text" && target && current.includes(target)) {
        return { ok: true, message: `✅ 检测到文本 "${target}" (${Date.now() - startTime}ms, ${pollCount} 次轮询)`, payload: { matched: true, text: target, extracted: current } };
      }
      if (watchType === "change" && lastContent && current !== lastContent) {
        const duration = Date.now() - startTime;
        return {
          ok: true,
          message: `✅ 检测到变化 (${duration}ms, ${pollCount} 次轮询)\n\n【变化前】\n${truncate(lastContent, 500)}\n\n【变化后】\n${truncate(current, 500)}`,
          payload: { changed: true, duration, pollCount, previous: lastContent, current, extracted: current },
        };
      }
      if (watchType === "value" && current && current !== "undefined") {
        return { ok: true, message: `✅ 检测到值 "${current}" (${Date.now() - startTime}ms, ${pollCount} 次轮询)`, payload: { matched: true, value: current, extracted: current } };
      }
      lastContent = current;
    } catch { /* 轮询出错，继续 */ }
  }

  return {
    ok: false,
    message: `⏱️ 超时 (${timeout}ms, ${pollCount} 次轮询)\n\n最后内容:\n${truncate(lastContent, 1000)}`,
    payload: { changed: false, timeout: true, pollCount, lastContent },
  };
}

async function getStateContent(session: string, tab: string, target: string, watchType: string, extractJs: string, cwd: string): Promise<string> {
  const extractValue = (r: Awaited<ReturnType<typeof runOpencliAsync>>): string => {
    if (!r.success) throw new Error(`命令执行失败: ${r.message}`);
    if (r.envelope?.value !== undefined && r.envelope?.value !== null) return String(r.envelope.value);
    if (r.envelope?.content) return r.envelope.content;
    if (r.rawText && !r.rawText.includes("操作完成") && !r.rawText.includes("退出码")) return r.rawText;
    return "";
  };

  if (extractJs) {
    return extractValue(await runOpencliAsync(["eval", extractJs, ...(tab ? ["--tab", tab] : [])], session, cwd));
  }

  switch (watchType) {
    case "change":
    case "text": {
      const js = "document.body.innerText.substring(0, 5000)";
      return extractValue(await runOpencliAsync(["eval", js, ...(tab ? ["--tab", tab] : [])], session, cwd));
    }
    case "value": {
      const js = `document.querySelector('${target}')?.value || ''`;
      return extractValue(await runOpencliAsync(["eval", js, ...(tab ? ["--tab", tab] : [])], session, cwd));
    }
    case "selector": {
      const js = `document.querySelector('${target}') ? 'found' : 'not_found'`;
      return extractValue(await runOpencliAsync(["eval", js, ...(tab ? ["--tab", tab] : [])], session, cwd));
    }
    default:
      throw new Error(`未知 watchType: ${watchType}`);
  }
}
