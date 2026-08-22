import { describe, it, expect } from "vitest";
import { toMaouToolName, toPiToolName, isSameTool } from "./tool-names.js";

describe("tool name compat", () => {
  it("maps Pi names to Maou", () => {
    expect(toMaouToolName("read")).toBe("reader");
    expect(toMaouToolName("write")).toBe("write_file");
    expect(toMaouToolName("edit")).toBe("edit_file");
    expect(toMaouToolName("bash")).toBe("use_terminal");
    expect(toMaouToolName("find")).toBe("glob");
    expect(toMaouToolName("ls")).toBe("glob");
  });

  it("maps Maou names to Pi", () => {
    expect(toPiToolName("reader")).toBe("read");
    expect(toPiToolName("write_file")).toBe("write");
    expect(toPiToolName("use_terminal")).toBe("bash");
    expect(toPiToolName("bash")).toBe("bash");
  });

  it("treats aliases as the same tool", () => {
    expect(isSameTool("read", "reader")).toBe(true);
    expect(isSameTool("bash", "use_terminal")).toBe(true);
    expect(isSameTool("grep", "search-text")).toBe(true);
    expect(isSameTool("reader", "write_file")).toBe(false);
  });

  it("leaves unknown names alone", () => {
    expect(toMaouToolName("mcp__foo__bar")).toBe("mcp__foo__bar");
    expect(toPiToolName("todo_manage")).toBe("todo_manage");
  });
});
