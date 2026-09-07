import { describe, expect, it } from "vitest";
import type { MaouMessage } from "@little-house-studio/context-components";
import { assignTaskIds, groupByTask } from "./assign-task-ids.js";

function msg(
  seqId: number,
  category: MaouMessage["category"],
  text: string,
  extra?: Partial<MaouMessage>,
): MaouMessage {
  return {
    seqId,
    taskIds: [],
    contents: [{ text }],
    keepAfterCompress: false,
    category,
    originalRole:
      category === "tool_result"
        ? "tool"
        : category === "assistant" || category === "tool_call"
          ? "assistant"
          : category === "system"
            ? "system"
            : "user",
    ...extra,
  };
}

describe("assignTaskIds", () => {
  it("marks each human user turn as t${seqId} and carries it forward", () => {
    const history = assignTaskIds([
      msg(0, "user", "先做 A"),
      msg(1, "assistant", "好"),
      msg(2, "user", "再做 B"),
      msg(3, "assistant", "行"),
    ]);
    expect(history[0]!.taskIds).toEqual(["t0"]);
    expect(history[1]!.taskIds).toEqual(["t0"]);
    expect(history[2]!.taskIds).toEqual(["t2"]);
    expect(history[3]!.taskIds).toEqual(["t2"]);
  });

  it("skips injected / compact sources as human turns", () => {
    const history = assignTaskIds([
      msg(0, "user", "hook 注入", { source: "hook" }),
      msg(1, "assistant", "看到了"),
      msg(2, "user", "真人开口"),
      msg(3, "assistant", "继续"),
    ]);
    expect(history[0]!.taskIds).toEqual([]);
    expect(history[1]!.taskIds).toEqual([]);
    expect(history[2]!.taskIds).toEqual(["t2"]);
    expect(history[3]!.taskIds).toEqual(["t2"]);
  });

  it("leaves already-labeled messages alone", () => {
    const history = assignTaskIds([
      { ...msg(0, "user", "已标"), taskIds: ["keep-me"] },
      msg(1, "assistant", "跟"),
    ]);
    expect(history[0]!.taskIds).toEqual(["keep-me"]);
    expect(history[1]!.taskIds).toEqual(["t0"]);
  });
});

describe("groupByTask", () => {
  it("buckets by taskIds and parks unlabeled in __no_task__", () => {
    const groups = groupByTask([
      { ...msg(0, "user", "a"), taskIds: ["t0"] },
      { ...msg(1, "assistant", "b"), taskIds: ["t0"] },
      msg(2, "system", "sys"),
    ]);
    expect([...groups.keys()]).toEqual(["t0", "__no_task__"]);
    expect(groups.get("t0")!.map((m) => m.seqId)).toEqual([0, 1]);
    expect(groups.get("__no_task__")!.map((m) => m.seqId)).toEqual([2]);
  });
});
