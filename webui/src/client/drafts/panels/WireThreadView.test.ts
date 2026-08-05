/**
 * WireThreadView pure mapping + grouping (shipped helpers).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chatLinesToDraftMessages } from "./WireThreadView";
import { groupThreadBlocks } from "../thread-blocks";

const here = dirname(fileURLToPath(import.meta.url));

describe("chatLinesToDraftMessages + groupThreadBlocks", () => {
  it("maps live chat lines and nests tools under assistant", () => {
    const msgs = chatLinesToDraftMessages(
      [
        { id: "u1", role: "user", text: "hello" },
        { id: "a1", role: "assistant", text: "working" },
        { id: "t1", role: "tool", text: "ls", terminalId: "term-1" },
        { id: "th1", role: "thinking", text: "hmm" },
      ],
      { agentBusy: false, agentName: "coding" },
    );
    assert.equal(msgs[0]!.role, "user");
    assert.equal(msgs[1]!.role, "assistant");
    assert.equal(msgs[2]!.role, "tool");
    assert.equal(msgs[2]!.tool?.name, "terminal");
    assert.equal(msgs[3]!.role, "thinking");

    const blocks = groupThreadBlocks(msgs);
    // user solo + assistant reply with tool+thinking internals
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0]!.kind, "solo");
    assert.equal(blocks[1]!.kind, "reply");
    if (blocks[1]!.kind === "reply") {
      assert.equal(blocks[1]!.assistant?.id, "a1");
      assert.equal(blocks[1]!.internals.length, 2);
    }
  });

  it("marks streaming assistant when busy and empty body", () => {
    const msgs = chatLinesToDraftMessages(
      [{ id: "a", role: "assistant", text: "" }],
      { agentBusy: true },
    );
    assert.equal(msgs[0]!.meta?.streaming, true);
    assert.equal(msgs[0]!.body, "…");
  });

  it("thinking defaults collapsed; keeps duration/tokens meta", () => {
    const live = chatLinesToDraftMessages(
      [
        {
          id: "th",
          role: "thinking",
          text: "step one",
          thinkStartedAt: 1,
          thinkDurationMs: 800,
          thinkOutputTokens: 42,
        },
      ],
      { agentBusy: true },
    );
    assert.equal(live[0]!.thinking?.streaming, true);
    assert.equal(live[0]!.thinking?.collapsed, true);
    assert.equal(live[0]!.thinking?.outputTokens, 42);
    assert.equal(live[0]!.thinking?.durationMs, 800);

    const done = chatLinesToDraftMessages(
      [{ id: "th", role: "thinking", text: "step one" }],
      { agentBusy: false },
    );
    assert.equal(done[0]!.thinking?.streaming, false);
    assert.equal(done[0]!.thinking?.collapsed, true);
  });

  it("groupThreadBlocks keeps thinking as internals under assistant", () => {
    const msgs = chatLinesToDraftMessages(
      [
        { id: "u", role: "user", text: "hi" },
        { id: "a", role: "assistant", text: "ans" },
        { id: "th", role: "thinking", text: "reason" },
      ],
      { agentBusy: false },
    );
    // order assistant then thinking → nested
    const blocks = groupThreadBlocks(msgs);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[1]!.kind, "reply");
    if (blocks[1]!.kind === "reply") {
      assert.equal(blocks[1]!.internals.some((i) => i.role === "thinking"), true);
    }
  });
});

describe("WireThreadView source structure", () => {
  it("ships groupThreadBlocks + ToolCard + DraftMarkdown", () => {
    const src = readFileSync(join(here, "WireThreadView.tsx"), "utf8");
    assert.match(src, /groupThreadBlocks/);
    assert.match(src, /ToolCard/);
    assert.match(src, /DraftMarkdown/);
    assert.match(src, /AssistantTurn|wire-reply-turn/);
    assert.match(src, /chatLinesToDraftMessages/);
  });
});
