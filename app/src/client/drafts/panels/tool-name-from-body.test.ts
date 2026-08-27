/**
 * Tool badge name must come from Agent call / body — never hardcoded "tool".
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chatLinesToDraftMessages,
  extractToolNameFromToolBody,
} from "./WireThreadView.tsx";

describe("extractToolNameFromToolBody", () => {
  it("parses ▶ name", () => {
    assert.equal(extractToolNameFromToolBody("▶ write_file · desc"), "write_file");
  });
  it("parses ✗ name", () => {
    assert.equal(
      extractToolNameFromToolBody("✗ write_file · missing"),
      "write_file",
    );
  });
  it("parses 工具 name 缺少", () => {
    assert.equal(
      extractToolNameFromToolBody(
        "✗ 工具 write_file 缺少必填参数: path, content · 84 字",
      ),
      "write_file",
    );
  });
  it("does not hardcode a tool list — any identifier works", () => {
    assert.equal(
      extractToolNameFromToolBody("▶ my_custom_tool_xyz"),
      "my_custom_tool_xyz",
    );
  });
});

describe("chatLinesToDraftMessages tool.name", () => {
  it("uses toolName field when present", () => {
    const msgs = chatLinesToDraftMessages([
      {
        id: "1",
        role: "tool",
        text: "✗ something",
        toolName: "write_file",
        err: true,
      },
    ]);
    assert.equal(msgs[0]!.tool?.name, "write_file");
    assert.equal(msgs[0]!.tool?.isError, true);
  });

  it("extracts from body when toolName missing (no hardcode tool)", () => {
    const msgs = chatLinesToDraftMessages([
      {
        id: "1",
        role: "tool",
        text: "✗ 工具 write_file 缺少必填参数: path, content · 84 字 · ~63 tok",
        err: true,
      },
    ]);
    assert.equal(msgs[0]!.tool?.name, "write_file");
    assert.notEqual(msgs[0]!.tool?.name, "tool");
  });

  it("terminal id maps to use_terminal not generic tool", () => {
    const msgs = chatLinesToDraftMessages([
      {
        id: "1",
        role: "tool",
        text: "▶ use_terminal",
        terminalId: "bg_1",
      },
    ]);
    assert.equal(msgs[0]!.tool?.name, "use_terminal");
  });

  it("history-style body without prefix still uses toolName field", () => {
    const msgs = chatLinesToDraftMessages([
      {
        id: "1",
        role: "tool",
        text: "requirements.txt 写入完成",
        toolName: "write_file",
      },
    ]);
    assert.equal(msgs[0]!.tool?.name, "write_file");
    assert.notEqual(msgs[0]!.tool?.name, "tool");
  });
});
