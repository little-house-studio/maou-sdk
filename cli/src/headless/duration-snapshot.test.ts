/**
 * 耗时口径：已完成的必须封口，只有进行中才跟 now() 走。
 *
 * 回归目标：一条早已结束、duration 未落库的记录，之前每帧 `now() - startTs` 重算，
 * 屏幕上耗时会一直往上涨（历史工具卡显示几分钟）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { toProtoTool, toProtoThinking, toProtoMessage } from "./state-snapshot.js";
import type { ChatMessage } from "../state/types.js";

const NO_EXPAND = new Set<string>();

afterEach(() => {
  vi.useRealTimers();
});

/** 把时钟推进 ms（配合 fake timers） */
function advance(ms: number): void {
  vi.advanceTimersByTime(ms);
}

describe("已完成项：耗时封口不再增长", () => {
  it("工具 done 且 callDuration 缺失 → 不用 now() 倒推（留空 = 未知）", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const tool = { id: "t1", name: "read_file", args: "{}", done: true, callStartTs: 1_000 };

    const first = toProtoTool(tool, NO_EXPAND);
    advance(60_000);
    const later = toProtoTool(tool, NO_EXPAND);

    expect(first.duration_ms).toBeUndefined();
    expect(later.duration_ms).toBe(first.duration_ms); // 关键：不随时间涨
  });

  it("工具 done 且有 callDuration → 恒定用落库值", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const tool = {
      id: "t1", name: "read_file", args: "{}", done: true,
      callStartTs: 1_000, callDuration: 250,
    };

    expect(toProtoTool(tool, NO_EXPAND).duration_ms).toBe(250);
    advance(120_000);
    expect(toProtoTool(tool, NO_EXPAND).duration_ms).toBe(250);
  });

  it("工具进行中 → 仍按 now() 走（活的 elapsed）", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const tool = { id: "t1", name: "use_terminal", args: "{}", done: false, callStartTs: 8_000 };

    expect(toProtoTool(tool, NO_EXPAND).duration_ms).toBe(2_000);
    advance(3_000);
    expect(toProtoTool(tool, NO_EXPAND).duration_ms).toBe(5_000);
  });

  it("thinking 结束后封口，流式中才涨", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const live = { id: "th1", content: "…", streaming: true, startTs: 9_000 };
    const done = { id: "th2", content: "…", streaming: false, startTs: 1_000, duration: 700 };

    expect(toProtoThinking(live, NO_EXPAND).duration_ms).toBe(1_000);
    advance(5_000);
    expect(toProtoThinking(live, NO_EXPAND).duration_ms).toBe(6_000);
    expect(toProtoThinking(done, NO_EXPAND).duration_ms).toBe(700);
    advance(60_000);
    expect(toProtoThinking(done, NO_EXPAND).duration_ms).toBe(700);
  });

  it("thinking 已结束但 duration 缺失 → 留空，不涨", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const t = { id: "th3", content: "x", streaming: false, startTs: 1_000 };
    const first = toProtoThinking(t, NO_EXPAND).duration_ms;
    advance(90_000);
    expect(toProtoThinking(t, NO_EXPAND).duration_ms).toBe(first);
    expect(first).toBeUndefined();
  });
});

describe("消息耗时", () => {
  const base = (over: Partial<ChatMessage>): ChatMessage => ({
    id: "m1", role: "assistant", content: "hi", ts: 1_000, ...over,
  }) as ChatMessage;

  const conv = (m: ChatMessage) =>
    toProtoMessage(m, NO_EXPAND, NO_EXPAND, NO_EXPAND, undefined, false).duration_ms;

  it("已结束用 doneTs 封口", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const m = base({ streaming: false, doneTs: 3_500 });
    expect(conv(m)).toBe(2_500);
    advance(60_000);
    expect(conv(m)).toBe(2_500);
  });

  it("已结束且无 doneTs / duration → 留空，不涨", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const m = base({ streaming: false });
    const first = conv(m);
    advance(60_000);
    expect(conv(m)).toBe(first);
    expect(first).toBeUndefined();
  });

  it("流式中跟 now() 走", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const m = base({ streaming: true });
    expect(conv(m)).toBe(9_000);
    advance(2_000);
    expect(conv(m)).toBe(11_000);
  });

  it("落库 duration 永远优先于推算", () => {
    vi.useFakeTimers();
    vi.setSystemTime(999_999);
    const m = base({ streaming: true, duration: 1_234 });
    expect(conv(m)).toBe(1_234);
  });
});

describe("0ms 与未知要分开", () => {
  it("耗时 0 显示为 1ms（而非空白）", () => {
    const tool = {
      id: "t0", name: "todo_finish", args: "{}", done: true,
      callStartTs: 5_000, callDuration: 0,
    };
    // 0 是「快到测不出」，不是缺数据 → 必须有值
    expect(toProtoTool(tool, NO_EXPAND).duration_ms).toBe(1);
  });

  it("负耗时（坏数据）→ 未知", () => {
    const tool = {
      id: "t0", name: "x", args: "{}", done: true,
      callStartTs: 5_000, callDuration: -20,
    };
    expect(toProtoTool(tool, NO_EXPAND).duration_ms).toBeUndefined();
  });
});
