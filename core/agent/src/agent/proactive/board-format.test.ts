import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDispatchUserMessage,
  emptyBoardMarkdown,
  formatItemLine,
  isQueued,
  mergeSuggestions,
  parseItemLine,
  parseProactiveMarkdown,
  parseSuggestionsFromModelText,
  serializeProactiveBoard,
  setItemChecked,
  setItemDone,
} from "./board-format.js";
// node:test so package can run without vitest for pure format

describe("proactive board-format", () => {
  it("parses checklist lines with note and risk", () => {
    const item = parseItemLine(
      `- [ ] 拆分构建 ||| 高 ||| 构建慢 <!-- note: 先量 vitest -->`,
      "高风险框架优化",
    );
    assert.ok(item);
    assert.equal(item!.title, "拆分构建");
    assert.equal(item!.risk, "高");
    assert.equal(item!.comment, "构建慢");
    assert.equal(item!.note, "先量 vitest");
    assert.equal(item!.done, false);
  });

  it("round-trips empty board and items", () => {
    const raw = emptyBoardMarkdown();
    const board = parseProactiveMarkdown(raw);
    assert.equal(board.zones.length, 4);
    const merged = mergeSuggestions(board, [
      {
        zone: "安全无风险修复与优化",
        title: "修类型警告",
        risk: "低",
        comment: "tsc clean",
      },
    ]);
    assert.equal(merged.items.length, 1);
    const again = parseProactiveMarkdown(serializeProactiveBoard(merged));
    assert.equal(again.items.length, 1);
    assert.equal(again.items[0]!.title, "修类型警告");
  });

  it("setItemDone moves to 已完成 and setItemChecked queues", () => {
    let board = parseProactiveMarkdown(emptyBoardMarkdown());
    board = mergeSuggestions(board, [
      {
        zone: "功能发现与完善",
        title: "补 E2E",
        risk: "中",
        comment: "覆盖登录",
      },
    ]);
    const id = board.items[0]!.id;
    board = setItemChecked(board, id, true);
    assert.ok(isQueued(board.items[0]!));
    board = setItemDone(board, id, true);
    assert.ok(board.items[0]!.done);
    assert.equal(board.items[0]!.zone, "已完成");
    assert.match(formatItemLine(board.items[0]!), /\[x\]/);
  });

  it("parseSuggestionsFromModelText reads proactive-json fence", () => {
    const text = `分析完毕\n\`\`\`proactive-json\n{"items":[{"zone":"大模块推进","title":"抽取 API","risk":"中","comment":"降耦"}]}\n\`\`\``;
    const s = parseSuggestionsFromModelText(text);
    assert.equal(s.length, 1);
    assert.equal(s[0]!.zone, "大模块推进");
  });

  it("buildDispatchUserMessage includes title and zone", () => {
    const msg = buildDispatchUserMessage({
      id: "x",
      zone: "大模块推进",
      title: "T",
      risk: "高",
      comment: "C",
      note: "[queue] N",
      done: false,
    });
    assert.match(msg, /主动智能派发/);
    assert.match(msg, /大模块推进/);
    assert.match(msg, /\bT\b/);
  });
});
