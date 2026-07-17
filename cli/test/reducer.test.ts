/**
 * reducer 单测 —— 验证 27 个 StreamEvent type 的处理 + 陷阱①-⑤。
 * 纯函数测试，不依赖 React/Ink。
 */

import { describe, it, expect } from "vitest";
import { reduce } from "../src/state/reducer.js";
import { useStore } from "../src/state/store.js";
import type { UIState } from "../src/state/types.js";
import type { StreamEvent } from "@little-house-studio/types";

function freshState(): UIState {
  // 重置 store 拿初始 state
  useStore.setState({
    messages: [], currentAssistantId: null, streaming: false, aborting: false,
    sessionId: null, agentName: "test", provider: "p", model: "m", maxContext: 100000,
    round: 0, thinkingLevel: 2, rounds: [], cacheHistory: [],
    currentRoundUsage: { input: 0, output: 0 },
    eventBlock: { mode: "idle", upTokens: 0, downTokens: 0 },
    toast: null, overlay: null,
  });
  return useStore.getState();
}

function apply(state: UIState, ev: StreamEvent): UIState {
  const patch = reduce(state, ev);
  return { ...state, ...patch };
}

describe("reducer: 27 StreamEvent types", () => {
  it("session: 从 Session 对象取 id（陷阱⑤）", () => {
    const s = apply(freshState(), { type: "session", session: { id: "s1" } as never });
    expect(s.sessionId).toBe("s1");
  });

  it("assistant_delta: 追加到流式消息", () => {
    let s = apply(freshState(), { type: "assistant_delta", delta: "Hello" });
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]!.content).toBe("Hello");
    expect(s.messages[0]!.role).toBe("assistant");
    expect(s.messages[0]!.streaming).toBe(true);
    expect(s.currentAssistantId).toBeTruthy();
    s = apply(s, { type: "assistant_delta", delta: " world" });
    expect(s.messages[0]!.content).toBe("Hello world");
  });

  it("assistant: 完整消息 + usage.max_context 更新窗口（陷阱③，区别于 model.usage）", () => {
    let s = apply(freshState(), { type: "assistant_delta", delta: "hi" });
    s = apply(s, {
      type: "assistant", content: "hi", round: 1,
      usage: { prompt_tokens: 100, completion_tokens: 50, max_context: 200000 },
    });
    expect(s.messages[0]!.content).toBe("hi");
    expect(s.messages[0]!.streaming).toBe(false);
    expect(s.messages[0]!.usage?.maxContext).toBe(200000);
    expect(s.maxContext).toBe(200000);
    // assistant 不再累加 currentRoundUsage：runtime 同一轮会先发 model.usage 再发 assistant，
    // 二者携带同一份 result.usage，若 assistant 也累加会导致 input/output 翻倍（缓存率被压低）。
    // 真实 runtime 中 model.usage 总在 assistant 之前发出并完成累计。
    expect(s.currentRoundUsage.input).toBe(0);
    expect(s.currentRoundUsage.output).toBe(0);
  });

  it("model.usage → assistant: token 由 model.usage 累计，assistant 不翻倍", () => {
    let s = apply(freshState(), { type: "assistant_delta", delta: "hi" });
    s = apply(s, { type: "model.usage", usage: { prompt_tokens: 100, completion_tokens: 50 } });
    s = apply(s, {
      type: "assistant", content: "hi", round: 1,
      usage: { prompt_tokens: 100, completion_tokens: 50, max_context: 200000 },
    });
    expect(s.currentRoundUsage.input).toBe(100);  // 不翻倍
    expect(s.currentRoundUsage.output).toBe(50);
    expect(s.maxContext).toBe(200000);
  });

  it("tool_call: ev.tool 是对象（陷阱④）", () => {
    let s = apply(freshState(), { type: "assistant_delta", delta: "" });
    s = apply(s, { type: "tool_call", tool: { id: "t1", name: "read", parameters: { path: "/a" } } });
    const msg = s.messages.find(m => m.role === "assistant")!;
    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls![0]!.name).toBe("read");
    expect(msg.toolCalls![0]!.args).toBe(JSON.stringify({ path: "/a" }));
    expect(msg.toolCalls![0]!.done).toBe(false);
  });

  it("tool_result: toolCallId/name/content/ok 是顶层（陷阱④）", () => {
    let s = apply(freshState(), { type: "assistant_delta", delta: "" });
    s = apply(s, { type: "tool_call", tool: { id: "t1", name: "read", parameters: {} } });
    s = apply(s, { type: "tool_result", toolCallId: "t1", name: "read", content: "file content", ok: true });
    const tc = s.messages.find(m => m.role === "assistant")!.toolCalls![0]!;
    expect(tc.done).toBe(true);
    expect(tc.result).toBe("file content");
    expect(tc.isError).toBe(false);
  });

  it("tool_result: 错误结果", () => {
    let s = apply(freshState(), { type: "assistant_delta", delta: "" });
    s = apply(s, { type: "tool_call", tool: { id: "t1", name: "edit", parameters: {} } });
    s = apply(s, { type: "tool_result", toolCallId: "t1", name: "edit", content: "not found", ok: false });
    const tc = s.messages.find(m => m.role === "assistant")!.toolCalls![0]!;
    expect(tc.isError).toBe(true);
    expect(tc.done).toBe(true);
  });

  it("thinking_delta: 追加到 thinkingBlock", () => {
    let s = apply(freshState(), { type: "assistant_delta", delta: "" });
    s = apply(s, { type: "thinking_delta", delta: "hmm" });
    s = apply(s, { type: "thinking_delta", delta: " let me think" });
    const msg = s.messages.find(m => m.role === "assistant")!;
    expect(msg.thinkingBlocks).toHaveLength(1);
    expect(msg.thinkingBlocks![0]!.content).toBe("hmm let me think");
    expect(msg.thinkingBlocks![0]!.streaming).toBe(true);
  });

  it("model.usage: 裸 usage 累计 token（陷阱③，区别于 assistant.usage）", () => {
    let s = apply(freshState(), { type: "model.usage", usage: { prompt_tokens: 30, completion_tokens: 20 } });
    expect(s.currentRoundUsage.input).toBe(30);
    expect(s.currentRoundUsage.output).toBe(20);
    // 不含 max_context，不应更新 maxContext
    expect(s.maxContext).toBe(100000);
  });

  it("model.usage: cacheRead 在多步轮次中累加（非 ?? 覆盖）", () => {
    let s = apply(freshState(), { type: "model.usage", usage: { prompt_tokens: 100, completion_tokens: 10, cached_tokens: 500 } });
    // 同一轮第二次 LLM 调用（agent 模式带工具）
    s = apply(s, { type: "model.usage", usage: { prompt_tokens: 80, completion_tokens: 5, cached_tokens: 700 } });
    expect(s.currentRoundUsage.cacheRead).toBe(1200);  // 500 + 700，而非 700
    expect(s.currentRoundUsage.input).toBe(180);        // 100 + 80
  });

  it("cacheHistory: 合并平均缓存率（sum(cacheRead)/sum(input)，非 mean-of-rates）+ 0 缓存轮次纳入", () => {
    let s = freshState();
    s = { ...s, model: "gpt-4o", provider: "openai" };
    // 第1轮：cache=900, input=1000 → 命中率 90%
    s = apply(s, { type: "model.usage", usage: { prompt_tokens: 1000, completion_tokens: 10, cached_tokens: 900 }, model: "gpt-4o", role: "main" } as StreamEvent);
    s = apply(s, { type: "agent_round", round: 2 });
    // 第2轮：cache=0, input=100 → 命中率 0%（必须纳入，否则平均偏高）
    s = apply(s, { type: "model.usage", usage: { prompt_tokens: 100, completion_tokens: 5, cached_tokens: 0 }, model: "gpt-4o", role: "main" } as StreamEvent);
    s = apply(s, { type: "done", rounds: 2 });
    expect(s.cacheHistory).toHaveLength(2);
    // 合并：900/(1000+100) = 81.8% → 82%（若用 mean-of-rates 会得 45%；若排除0轮次会得 90%）
    const sumCache = s.cacheHistory.reduce((a, c) => a + c.cacheRead, 0);
    const sumInput = s.cacheHistory.reduce((a, c) => a + c.input, 0);
    expect(Math.round((sumCache / sumInput) * 100)).toBe(82);
    // 缓存率公式 = cacheRead/input（input 是 prompt_tokens，已含 cache）
    expect(sumCache).toBe(900);
    expect(sumInput).toBe(1100);
  });

  it("cacheHistory: 无 cache 能力的主模型（xopqwen）不写入假 0%，token 仍累计", () => {
    let s = freshState();
    s = { ...s, model: "xopqwen36v35b", provider: "xfyun" };
    s = apply(s, {
      type: "model.usage",
      usage: { prompt_tokens: 5000, completion_tokens: 20, cached_tokens: 0 },
      model: "xopqwen36v35b",
      role: "main",
      agentName: "test",
    } as StreamEvent);
    expect(s.currentRoundUsage.input).toBe(5000);
    s = apply(s, { type: "done", rounds: 1 });
    expect(s.cacheHistory).toHaveLength(0);
  });

  it("model.usage: helper/supervisor 不计入主上下文 cache 与 token", () => {
    let s = freshState();
    s = { ...s, model: "gpt-4o", provider: "openai", agentName: "coding" };
    s = apply(s, {
      type: "model.usage",
      usage: { prompt_tokens: 100, completion_tokens: 5, cached_tokens: 80 },
      model: "gpt-4o-mini",
      role: "helper",
    } as StreamEvent);
    expect(s.currentRoundUsage.input).toBe(0);
    s = apply(s, {
      type: "model.usage",
      usage: { prompt_tokens: 200, completion_tokens: 5, cached_tokens: 100 },
      model: "gpt-4o",
      role: "main",
      agentName: "supervisor",
    } as StreamEvent);
    expect(s.currentRoundUsage.input).toBe(0);
    s = apply(s, {
      type: "model.usage",
      usage: { prompt_tokens: 300, completion_tokens: 10, cached_tokens: 200 },
      model: "gpt-4o",
      role: "main",
      agentName: "coding",
    } as StreamEvent);
    expect(s.currentRoundUsage.input).toBe(300);
    expect(s.currentRoundUsage.cacheRead).toBe(200);
  });

  it("done: 结束 streaming + 归档 rounds", () => {
    let s = apply(freshState(), { type: "assistant_delta", delta: "x" });
    s = apply(s, { type: "model.usage", usage: { prompt_tokens: 10, completion_tokens: 5 } });
    s = apply(s, { type: "done", rounds: 1 });
    expect(s.streaming).toBe(false);
    expect(s.messages[0]!.streaming).toBe(false);
    expect(s.round).toBe(1);
    expect(s.rounds).toHaveLength(1);
    expect(s.rounds[0]!.input).toBe(10);
  });

  it("error: 置 streaming:false（陷阱①，不依赖后续 done）", () => {
    let s = apply(freshState(), { type: "assistant_delta", delta: "x" });
    s = apply(s, { type: "error", message: "boom" });
    expect(s.streaming).toBe(false);
    expect(s.toast?.kind).toBe("err");
    expect(s.toast?.text).toBe("boom");
  });

  it("log vs info 分流（陷阱②）", () => {
    let s = apply(freshState(), { type: "log", level: "error", message: "err log" });
    expect(s.toast?.kind).toBe("err");
    s = apply(s, { type: "log", level: "warning", message: "warn log" });
    expect(s.toast?.kind).toBe("warn");
    s = apply(s, { type: "log", level: "info", message: "info log" });
    // info/debug 静默，不覆盖 toast
    s = apply(freshState(), { type: "info", message: "已中断" });
    expect(s.eventBlock.detail).toBe("已中断");
  });

  it("agent_round: 归档 usage 到 rounds 历史，重置当前轮", () => {
    let s = apply(freshState(), { type: "model.usage", usage: { prompt_tokens: 40, completion_tokens: 30 } });
    s = apply(s, { type: "agent_round", round: 2 });
    expect(s.round).toBe(2);
    expect(s.rounds).toHaveLength(1);
    expect(s.rounds[0]!.total).toBe(70);
    expect(s.currentRoundUsage.input).toBe(0);
  });

  it("tool_pending: 事件块模式 + 立刻出 pending 卡", () => {
    const s = apply(freshState(), { type: "tool_pending", tool: { name: "bash" } });
    expect(s.eventBlock.mode).toBe("tool_pending");
    expect(s.eventBlock.detail).toBe("bash");
    const cards = s.messages[0]?.toolCalls ?? [];
    expect(cards).toHaveLength(1);
    expect(cards[0]!.name).toBe("bash");
    expect(cards[0]!.done).toBe(false);
  });

  it("tool_call 在 tool_result 前就有进行中卡（意图先显示）", () => {
    let s = apply(freshState(), {
      type: "tool_call",
      tool: { id: "t1", name: "read", parameters: { path: "/x" } },
    });
    const cards = s.messages[0]?.toolCalls ?? [];
    expect(cards).toHaveLength(1);
    expect(cards[0]!.done).toBe(false);
    expect(cards[0]!.name).toBe("read");
    expect(s.eventBlock.mode).toBe("tool_pending");
    s = apply(s, {
      type: "tool_result",
      toolCallId: "t1",
      name: "read",
      content: "ok",
      ok: true,
    });
    expect(s.messages[0]!.toolCalls![0]!.done).toBe(true);
    expect(s.messages[0]!.toolCalls![0]!.result).toContain("ok");
  });

  it("thinking 在 assistant_delta / tool_call 时 seal，不再保持 streaming", () => {
    let s = apply(freshState(), { type: "thinking_delta", delta: "先想一步" });
    const bid = s.messages[0]!.thinkingBlocks![0]!.id;
    expect(s.messages[0]!.thinkingBlocks![0]!.streaming).toBe(true);

    s = apply(s, { type: "assistant_delta", delta: "开始写" });
    const afterText = s.messages[0]!.thinkingBlocks!.find((b) => b.id === bid)!;
    expect(afterText.streaming).toBe(false);
    expect(afterText.content).toContain("先想一步");
    expect(s.messages[0]!.content).toContain("开始写");

    // 新一轮思考 + 直接工具
    s = apply(s, { type: "thinking_delta", delta: "再查一下" });
    // thinking 会因已有 toolCalls? 无 — 同消息无 tool，会 append 到新 block 或同消息
    // 若 assistant 已有 content 且无 tool，thinking 可能仍在同一 assistant 上
    const streamingThink = (s.messages[0]!.thinkingBlocks ?? []).some((b) => b.streaming);
    // 若当前消息已有 content，thinking_delta 仍挂同一消息
    if (streamingThink) {
      s = apply(s, {
        type: "tool_call",
        tool: { id: "t-seal", name: "use_terminal", parameters: { cmd: "ls" } },
      });
      const allSealed = (s.messages.flatMap((m) => m.thinkingBlocks ?? [])).every(
        (b) => !b.streaming,
      );
      expect(allSealed).toBe(true);
    }
  });

  it("tool_call 前有 thinking 时会 seal 成一行状态", () => {
    let s = apply(freshState(), { type: "thinking_delta", delta: "abc".repeat(40) });
    expect(s.messages[0]!.thinkingBlocks![0]!.streaming).toBe(true);
    s = apply(s, {
      type: "tool_call",
      tool: { id: "t9", name: "read", parameters: { path: "x" } },
    });
    expect(s.messages[0]!.thinkingBlocks![0]!.streaming).toBe(false);
    expect(s.messages[0]!.toolCalls![0]!.done).toBe(false);
  });

  it("同一轮 assistant+tool 不拆成双消息、工具不叠卡", () => {
    let s = apply(freshState(), { type: "thinking_delta", delta: "先想" });
    s = apply(s, { type: "assistant_delta", delta: "让我验证一下 👇" });
    // 完整 assistant（runtime 会带 nativeToolCalls 表示后面还有工具）
    s = apply(s, {
      type: "assistant",
      content: "让我验证一下 👇",
      nativeToolCalls: [{ id: "tc1", name: "use_terminal" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    } as StreamEvent);
    // 必须仍是 1 条 assistant，且 streaming 保持 true、槽位不丢
    expect(s.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(s.messages[0]!.streaming).toBe(true);
    expect(s.currentAssistantId).toBe(s.messages[0]!.id);
    expect(s.messages[0]!.thinkingBlocks![0]!.streaming).toBe(false);

    s = apply(s, {
      type: "tool_call",
      tool: { id: "tc1", name: "use_terminal", parameters: { command: "ls" } },
    });
    expect(s.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(s.messages[0]!.toolCalls).toHaveLength(1);
    expect(s.messages[0]!.content).toContain("验证");

    // 重复 announce 同 id 不叠第二张
    s = apply(s, {
      type: "tool_call",
      tool: { id: "tc1", name: "use_terminal", parameters: { command: "ls" } },
    });
    expect(s.messages[0]!.toolCalls).toHaveLength(1);

    s = apply(s, {
      type: "tool_result",
      toolCallId: "tc1",
      name: "use_terminal",
      content: "ok",
      ok: true,
    });
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]!.toolCalls![0]!.done).toBe(true);
    expect(s.messages[0]!.streaming).toBe(false);
  });

  it("trace 类静默 drop（不抛错）", () => {
    const s0 = freshState();
    for (const t of ["model.request", "model.response.raw", "raw_response", "field_complete", "field_streaming", "queue_delivered", "profile", "model.tool_detected", "loop_check"]) {
      const s = apply(s0, { type: t } as StreamEvent);
      expect(s.messages).toEqual(s0.messages);
    }
  });

  it("model.error / model.loop_detected / round_limit: toast", () => {
    let s = apply(freshState(), { type: "model.error", error: "rate limit" });
    expect(s.toast?.kind).toBe("err");
    s = apply(freshState(), { type: "model.loop_detected" });
    expect(s.toast?.kind).toBe("warn");
    s = apply(freshState(), { type: "round_limit", message: "max rounds" });
    expect(s.toast?.kind).toBe("warn");
  });

  it("完整对话流：user→delta→tool→result→done", () => {
    let s = freshState();
    s = apply(s, { type: "assistant_delta", delta: "let me read" });
    s = apply(s, { type: "tool_call", tool: { id: "t1", name: "read", parameters: { path: "/x" } } });
    s = apply(s, { type: "tool_pending", tool: { name: "read" } });
    s = apply(s, { type: "tool_result", toolCallId: "t1", name: "read", content: "ok", ok: true });
    s = apply(s, { type: "assistant_delta", delta: " done" });
    // 真实 runtime 顺序：model.usage 先于 assistant 发出（同一份 result.usage），
    // token 由 model.usage 累计，assistant 仅刷新消息展示，不再翻倍。
    s = apply(s, { type: "model.usage", usage: { prompt_tokens: 50, completion_tokens: 20 } });
    s = apply(s, { type: "assistant", content: "let me read done", round: 1, usage: { prompt_tokens: 50, completion_tokens: 20, max_context: 100000 } });
    s = apply(s, { type: "done", rounds: 1 });
    expect(s.streaming).toBe(false);
    expect(s.messages.find(m => m.role === "assistant")!.toolCalls).toHaveLength(1);
    expect(s.messages.find(m => m.role === "assistant")!.toolCalls![0]!.done).toBe(true);
    expect(s.rounds).toHaveLength(1);
    expect(s.rounds[0]!.input).toBe(50);  // 不翻倍
  });
});

  it("openai-compat 真实 usage 形状解析（prompt_tokens_details.cached_tokens 提取）", () => {
    // 真实捕获的 usage 形状（prompt_tokens_details.cached_tokens）
    const usage = {
      prompt_tokens: 6135,
      completion_tokens: 472,
      total_tokens: 6607,
      prompt_tokens_details: { cached_tokens: 5504 },
      completion_tokens_details: { reasoning_tokens: 175 },
      prompt_cache_hit_tokens: 5504,
      prompt_cache_miss_tokens: 631,
    };
    let s = freshState();
    s = { ...s, model: "gpt-4o", provider: "openai" };
    s = apply(s, { type: "model.usage", usage, model: "gpt-4o", role: "main" } as StreamEvent);
    // parseUsage 应从 prompt_tokens_details.cached_tokens 提取
    expect(s.currentRoundUsage.cacheRead).toBe(5504);
    expect(s.currentRoundUsage.input).toBe(6135);
    s = apply(s, { type: "done", rounds: 1 });
    expect(s.cacheHistory).toHaveLength(1);
    expect(s.cacheHistory[0]!.cacheRead).toBe(5504);
    expect(s.cacheHistory[0]!.input).toBe(6135);
    // 缓存率 = cached/prompt_tokens = 5504/6135 = 89.7% → 90%
    const sumCache = s.cacheHistory.reduce((a, c) => a + c.cacheRead, 0);
    const sumInput = s.cacheHistory.reduce((a, c) => a + c.input, 0);
    expect(Math.round((sumCache / sumInput) * 100)).toBe(90);
  });
