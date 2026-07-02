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

  it("assistant: 完整消息 + usage.max_context 更新窗口（陷阱③）", () => {
    let s = apply(freshState(), { type: "assistant_delta", delta: "hi" });
    s = apply(s, {
      type: "assistant", content: "hi", round: 1,
      usage: { prompt_tokens: 100, completion_tokens: 50, max_context: 200000 },
    });
    expect(s.messages[0]!.content).toBe("hi");
    expect(s.messages[0]!.streaming).toBe(false);
    expect(s.messages[0]!.usage?.maxContext).toBe(200000);
    expect(s.maxContext).toBe(200000);
    expect(s.currentRoundUsage.input).toBe(100);
    expect(s.currentRoundUsage.output).toBe(50);
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

  it("tool_pending: 事件块模式", () => {
    const s = apply(freshState(), { type: "tool_pending", tool: { name: "bash" } });
    expect(s.eventBlock.mode).toBe("tool_pending");
    expect(s.eventBlock.detail).toBe("bash");
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
    s = apply(s, { type: "assistant", content: "let me read done", round: 1, usage: { prompt_tokens: 50, completion_tokens: 20, max_context: 100000 } });
    s = apply(s, { type: "done", rounds: 1 });
    expect(s.streaming).toBe(false);
    expect(s.messages.find(m => m.role === "assistant")!.toolCalls).toHaveLength(1);
    expect(s.messages.find(m => m.role === "assistant")!.toolCalls![0]!.done).toBe(true);
    expect(s.rounds).toHaveLength(1);
  });
});
