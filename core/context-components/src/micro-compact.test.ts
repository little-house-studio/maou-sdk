import { describe, expect, it } from "vitest";
import type { MaouMessage } from "./types/message.js";
import { maouToLLMMessage, maouToSessionMessage } from "./types/message.js";
import {
  applyRoundMicroCompact,
  stampMicroBirth,
  holdAsPromptCache,
  keepFrozenPrefix,
  resolveMicroCompactRounds,
  textSegment,
  formatMicroUnlockPrefix,
  MICRO_COMPACT_PRESETS,
  TRADITIONAL_READ_REREAD_HINT,
} from "./micro-compact.js";
import { applyWindowPressure } from "./window-pressure.js";

function readerResult(text: string, born: number): MaouMessage {
  return stampMicroBirth(
    {
      seqId: 1,
      taskIds: [],
      contents: [{ text }],
      keepAfterCompress: false,
      category: "tool_result",
      toolName: "reader",
      microBornTurn: born,
    },
    born,
  );
}

describe("round micro-compact", () => {
  it("resolves one shared agent-level round count", () => {
    expect(resolveMicroCompactRounds(undefined)).toBe(3);
    expect(resolveMicroCompactRounds(5)).toBe(5);
    expect(resolveMicroCompactRounds("5")).toBe(5);
    expect(resolveMicroCompactRounds(0)).toBe(3);
    expect(resolveMicroCompactRounds(-1)).toBe(3);
  });

  it("uses the shared round count for every compact feature", () => {
    const text = "正文".repeat(400);
    const history = [readerResult(text, 1)];
    expect(applyRoundMicroCompact(history, 4, undefined, 5).changed).toBe(false);
    const r = applyRoundMicroCompact(history, 6, undefined, 5);
    expect(r.changed).toBe(true);
    expect(r.history[0]!.microFrozen).toBe(true);
  });

  it("does not let a policy override the agent-wide round count", () => {
    const text = "正文".repeat(400);
    const msg = readerResult(text, 1);
    msg.contents[0] = {
      ...msg.contents[0]!,
      annotations: { microCompact: { ...MICRO_COMPACT_PRESETS.traditional_read, limitRounds: 1 } },
    };
    expect(applyRoundMicroCompact([msg], 2, undefined, 5).changed).toBe(false);
    expect(applyRoundMicroCompact([msg], 6, undefined, 5).changed).toBe(true);
  });

  it("keeps reader text through 3 later turns, shrinks after the 4th", () => {
    const text = "正文".repeat(400);
    let history = [readerResult(text, 1)];
    for (const turn of [1, 2, 3]) {
      const r = applyRoundMicroCompact(history, turn);
      expect(r.changed).toBe(false);
      expect(r.history[0]!.contents[0]!.microCompact).toBeUndefined();
    }
    const r = applyRoundMicroCompact(history, 4);
    expect(r.changed).toBe(true);
    expect(r.history[0]!.microFrozen).toBe(true);
    const summary = r.history[0]!.contents[0]!.microCompact?.summary ?? "";
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.length).toBeLessThan(text.length);
    expect(summary).toMatch(/省略 \d+ 字/);
    expect(summary).not.toContain(TRADITIONAL_READ_REREAD_HINT);
    expect(r.unlockItems.length).toBe(1);
    expect(formatMicroUnlockPrefix(r.unlockItems)).toContain(TRADITIONAL_READ_REREAD_HINT);
  });

  it("does not compact a file under 500 chars", () => {
    const body = "短文件正文";
    const text = `[path=/tmp/short.ts | total_chars=${[...body].length}]\n${body}`;
    const r = applyRoundMicroCompact([readerResult(text, 1)], 4);
    expect(r.history[0]!.microFrozen).toBe(true);
    expect(r.history[0]!.contents[0]!.microCompact).toBeUndefined();
    expect(r.history[0]!.contents[0]!.text).toBe(text);
  });

  it("does not compact a second read of the same path", () => {
    const body = "重要文件".repeat(200);
    const header = `[path=/tmp/keep.ts | total_chars=${[...body].length}]`;
    const first = readerResult(`${header}\n${body}`, 1);
    first.seqId = 1;
    const second = stampMicroBirth(
      {
        seqId: 2,
        taskIds: [],
        contents: [{ text: `${header}\n${body}` }],
        keepAfterCompress: false,
        category: "tool_result",
        toolName: "reader",
        microBornTurn: 1,
      },
      1,
      undefined,
      [first],
    );
    expect(second.microExempt).toBe(true);
    const r = applyRoundMicroCompact([first, second], 4);
    expect(r.history[0]!.contents[0]!.microCompact?.summary).toBeTruthy();
    expect(r.history[1]!.microExempt).toBe(true);
    expect(r.history[1]!.contents[0]!.microCompact).toBeUndefined();
    expect(r.history[1]!.contents[0]!.text).toContain(body);
  });

  it("empty preset leaves only the omit marker", () => {
    const msg = readerResult("很长的阅读结果".repeat(20), 1);
    msg.contents[0] = {
      ...msg.contents[0]!,
      annotations: { microCompact: MICRO_COMPACT_PRESETS.empty },
    };
    const r = applyRoundMicroCompact([msg], 4);
    expect(r.history[0]!.contents[0]!.microCompact?.summary).toMatch(/省略|omit|pruned|微压缩/i);
  });

  it("keeps strategy marks off the visible text", () => {
    const text = "正文".repeat(400);
    const stamped = readerResult(text, 1);
    expect(stamped.contents[0]!.text).toBe(text);
    expect(JSON.stringify(stamped.contents[0]!.annotations)).toContain("traditional_read");
    expect(maouToLLMMessage(stamped).content).toBe(text);
    expect(maouToLLMMessage(stamped).content).not.toContain("traditional_read");
    expect(maouToSessionMessage(stamped).content).toBe(text);

    const compacted = applyRoundMicroCompact([stamped], 4).history[0]!;
    const visible = maouToLLMMessage(compacted).content;
    expect(compacted.contents[0]!.text).toBe(text);
    expect(visible).not.toBe(text);
    expect(visible).not.toContain("traditional_read");
    expect(visible).not.toContain("limitRounds");
    expect(visible).not.toContain("再次阅读");
    expect(maouToSessionMessage(compacted).content).toBe(text);
  });

  it("compacts only segments that carry a strategy mark", () => {
    const body = "正文".repeat(400);
    const msg: MaouMessage = {
      seqId: 1,
      taskIds: [],
      contents: [
        textSegment("说明：下面是文件"),
        textSegment(body, {
          strategy: "traditional_read",
          attributes: { path: "/tmp/a.ts", totalChars: [...body].length },
        }),
        textSegment("页脚"),
      ],
      keepAfterCompress: false,
      category: "tool_result",
      toolName: "reader",
      microBornTurn: 1,
    };
    const r = applyRoundMicroCompact([msg], 4);
    expect(r.history[0]!.contents[0]!.text).toBe("说明：下面是文件");
    expect(r.history[0]!.contents[0]!.microCompact).toBeUndefined();
    expect(r.history[0]!.contents[1]!.microCompact?.summary).toBeTruthy();
    expect(r.history[0]!.contents[1]!.microCompact!.summary!.length).toBeLessThan(body.length);
    expect(r.history[0]!.contents[2]!.text).toBe("页脚");
    expect(r.history[0]!.contents[2]!.microCompact).toBeUndefined();
  });

  it("does not touch tools without a catalog entry", () => {
    const msg: MaouMessage = {
      seqId: 1,
      taskIds: [],
      contents: [{ text: "x".repeat(500) }],
      keepAfterCompress: false,
      category: "tool_result",
      toolName: "edit_file",
      microBornTurn: 1,
    };
    const r = applyRoundMicroCompact([msg], 9);
    expect(r.changed).toBe(true);
    expect(r.history[0]!.microFrozen).toBe(true);
    expect(r.history[0]!.contents[0]!.microCompact).toBeUndefined();
    expect(r.history[0]!.contents[0]!.text).toBe("x".repeat(500));
  });

  it("replaces terminal output with the spill path only", () => {
    const path = "/tmp/sess/spill/vite-1.txt";
    const preview = [
      `[path=${path} | total_lines=40 | total_chars=200]`,
      "line-a",
      "line-b",
      `(Showing lines 1-2 of 40. Full output stored at: ${path}. Use read with offset/limit.)`,
    ].join("\n");
    const msg = stampMicroBirth(
      {
        seqId: 1,
        taskIds: [],
        contents: [{ text: preview }],
        keepAfterCompress: false,
        category: "tool_result",
        toolName: "use_terminal",
        microBornTurn: 1,
      },
      1,
    );
    const r = applyRoundMicroCompact([msg], 4);
    const summary = r.history[0]!.contents[0]!.microCompact?.summary ?? "";
    expect(summary).toContain(path);
    expect(summary).toMatch(/read tool/i);
    expect(summary).not.toContain("line-a");
    expect(summary).not.toContain("line-b");
    expect(r.history[0]!.contents[0]!.text).toBe(preview);
  });

  it("freezes left-window messages and later writers cannot rewrite them", () => {
    const text = "阅读正文".repeat(400);
    const born = readerResult(text, 1);
    const user: MaouMessage = {
      seqId: 2,
      taskIds: [],
      contents: [{ text: "后来的问题" }],
      keepAfterCompress: false,
      category: "user",
      microBornTurn: 4,
    };
    const compacted = applyRoundMicroCompact([born, user], 4);
    expect(compacted.history[0]!.microFrozen).toBe(true);
    expect(compacted.history[1]!.microFrozen).toBeFalsy();
    expect(holdAsPromptCache(compacted.history[0]!, { currentTurn: 4 })).toBe(true);
    expect(holdAsPromptCache(compacted.history[1]!, { currentTurn: 4 })).toBe(false);

    const summary = compacted.history[0]!.contents[0]!.microCompact?.summary ?? "";
    const again = applyRoundMicroCompact(compacted.history, 6);
    expect(again.changed).toBe(false);
    expect(again.history[0]!.contents[0]!.microCompact?.summary).toBe(summary);

    const pressed = applyWindowPressure(compacted.history, 90_000, 100_000, (m) =>
      holdAsPromptCache(m, { currentTurn: 6 }),
    );
    expect(pressed.history[0]!.contents[0]!.microCompact?.summary).toBe(summary);

    const mutated = compacted.history.map((m) =>
      m.seqId === 1
        ? { ...m, contents: [{ text: "不该出现的改写" }] }
        : { ...m, contents: [{ text: "动态层可以改" }] },
    );
    const restored = keepFrozenPrefix(compacted.history, mutated, { currentTurn: 6 });
    expect(restored[0]!.contents[0]!.microCompact?.summary).toBe(summary);
    expect(restored[1]!.contents[0]!.text).toBe("动态层可以改");
  });

  it("does not restore frozen messages covered by a fold card", () => {
    const frozen: MaouMessage = {
      seqId: 1,
      taskIds: [],
      contents: [{ text: "old-frozen" }],
      keepAfterCompress: false,
      category: "user",
      microFrozen: true,
    };
    const tail: MaouMessage = {
      seqId: 2,
      taskIds: [],
      contents: [{ text: "tail" }],
      keepAfterCompress: false,
      category: "user",
    };
    const fold: MaouMessage = {
      seqId: 1,
      taskIds: [],
      contents: [{ text: "<folded-span seq=\"1-1\">stub</folded-span>" }],
      keepAfterCompress: true,
      category: "compact",
      compact: { type: "fold", summary: "stub", seqRange: { start: 1, end: 1 } },
    };
    const restored = keepFrozenPrefix([frozen, tail], [fold, tail], { currentTurn: 9 });
    expect(restored.some((m) => m.contents[0]?.text === "old-frozen")).toBe(false);
    expect(restored.some((m) => m.compact?.type === "fold")).toBe(true);
    expect(restored.some((m) => m.contents[0]?.text === "tail")).toBe(true);
  });
});
