import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyAssistantContent,
  applyAssistantDelta,
  applyThinkingDelta,
  dropIdleAssistantPlaceholders,
  shouldOpenNewAssistantTurn,
  type ChatLine,
} from "./ChatPanel";
import { chatLinesToDraftMessages } from "./wire/thread/WireThreadView";
import { groupLoopTurns, groupThreadBlocks } from "./wire/thread/thread-blocks";

function line(
  id: string,
  role: ChatLine["role"],
  text = "",
  extra: Partial<ChatLine> = {},
): ChatLine {
  return { id, role, text, ...extra };
}

describe("stream line patches", () => {
  it("patches the open assistant in place; opens a new turn after a tool", () => {
    const seed = [
      line("u", "user", "go"),
      line("a1", "assistant", ""),
    ];
    assert.equal(shouldOpenNewAssistantTurn(seed), false);
    const afterText = applyAssistantDelta(seed, "hi", 1, "a-new");
    assert.equal(afterText[1]!.id, "a1");
    assert.equal(afterText[1]!.text, "hi");
    assert.equal(afterText.length, 2);

    const withTool = [...afterText, line("t1", "tool", "▶ read_file")];
    assert.equal(shouldOpenNewAssistantTurn(withTool), true);
    const next = applyAssistantDelta(withTool, "done", 2, "a2");
    assert.equal(next[1]!.id, "a1");
    assert.equal(next[1]!.text, "hi");
    assert.equal(next[next.length - 1]!.id, "a2");
    assert.equal(next[next.length - 1]!.text, "done");
  });

  it("thinking after a tool opens a new assistant with a stable id", () => {
    const lines = [
      line("u", "user", "go"),
      line("a1", "assistant", "step"),
      line("t1", "tool", "▶ read_file"),
    ];
    const next = applyThinkingDelta(lines, "reason", 3, {
      assistant: "a2",
      thinking: "th2",
    });
    assert.equal(next[1]!.id, "a1");
    assert.equal(next[3]!.id, "a2");
    assert.equal(next[3]!.role, "assistant");
    assert.equal(next[4]!.id, "th2");
    assert.equal(next[4]!.text, "reason");
  });

  it("replaces a 调用模型 placeholder instead of concatenating", () => {
    const lines = [
      line("u", "user", "go"),
      line("a1", "assistant", "… 调用模型: flash"),
    ];
    const next = applyAssistantDelta(lines, "正文");
    assert.equal(next[1]!.id, "a1");
    assert.equal(next[1]!.text, "正文");
  });

  it("keeps an empty assistant that already has internals", () => {
    const lines = [
      line("u", "user", "go"),
      line("a1", "assistant", ""),
      line("t1", "tool", "▶ read_file"),
      line("a2", "assistant", ""),
    ];
    const pruned = dropIdleAssistantPlaceholders(lines);
    assert.equal(
      pruned.some((l) => l.id === "a1"),
      true,
    );
    assert.equal(
      pruned.some((l) => l.id === "a2"),
      false,
    );
    assert.equal(
      pruned.some((l) => l.id === "t1"),
      true,
    );
  });

  it("live and finished grouping share the same assistant ids", () => {
    let lines: ChatLine[] = [
      line("u", "user", "go"),
      line("a1", "assistant", ""),
    ];
    lines = applyThinkingDelta(lines, "scan", 1, { thinking: "th1" });
    lines = [...lines, line("t1", "tool", "▶ read_file", { toolName: "read_file" })];
    lines = applyAssistantDelta(lines, "ok", 2, "a2");
    const live = chatLinesToDraftMessages(lines, { agentBusy: true });
    const doneLines = dropIdleAssistantPlaceholders(
      applyAssistantContent(
        lines.map((l) =>
          l.id === "t1" ? { ...l, text: "✓ read_file" } : l,
        ),
        "ok",
      ),
    );
    const done = chatLinesToDraftMessages(doneLines, { agentBusy: false });
    const liveSegs = groupLoopTurns(groupThreadBlocks(live));
    const doneSegs = groupLoopTurns(groupThreadBlocks(done));
    assert.equal(liveSegs.length, 1);
    assert.equal(doneSegs.length, 1);
    if (liveSegs[0]!.kind === "loop" && doneSegs[0]!.kind === "loop") {
      assert.equal(liveSegs[0]!.replies.length, doneSegs[0]!.replies.length);
      assert.equal(
        liveSegs[0]!.replies.map((r) => r.assistant?.id).join(","),
        doneSegs[0]!.replies.map((r) => r.assistant?.id).join(","),
      );
    }
  });
});
