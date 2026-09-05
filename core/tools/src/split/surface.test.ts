import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../registry.js";
import { registerBuiltins } from "../impls/index.js";

function registry(): ToolRegistry {
  const reg = new ToolRegistry();
  registerBuiltins(reg);
  return reg;
}

describe("dual-surface tools", () => {
  it("keeps god tools and registers verb / send / completed gods", () => {
    const reg = registry();
    const names = new Set(reg.list().map((item) => item.name));

    expect(names.has("notebook")).toBe(false);
    expect(names.has("undo_edit")).toBe(false);
    expect(names.has("terminal_scan")).toBe(false);
    expect(names.has("todo")).toBe(false);
    expect(names.has("inspect_session")).toBe(false);
    expect(names.has("llm_judge")).toBe(false);
    expect(names.has("supervisor_task_control")).toBe(false);
    expect(names.has("supervisor_chat_main")).toBe(false);
    expect(names.has("supervisor_start")).toBe(false);
    expect(names.has("get_goal")).toBe(true);
    expect(names.has("create_goal")).toBe(true);
    expect(names.has("update_goal")).toBe(true);
    expect(names.has("submit_plan")).toBe(true);
    const messageAction = (reg.get("agent_message")?.definition.parameters as { properties?: { action?: { enum?: string[] } } }).properties?.action?.enum;
    const projectAction = (reg.get("project_agent")?.definition.parameters as { properties?: { action?: { enum?: string[] } } }).properties?.action?.enum;
    expect(messageAction).toEqual(["fork", "create"]);
    expect(projectAction).toEqual(["list", "create", "send"]);
    expect(names.has("session_catalog")).toBe(false);
    expect(names.has("session_query")).toBe(false);

    for (const god of [
      "reader",
      "use_terminal",
      "find_skill",
      "todo_manage",
      "board",
      "find_code",
      "lsp",
      "use_browser",
      "use_computer",
      "agent_message",
      "agent_manage",
      "project_agent",
      "project_manage",
      "skill",
      "agent_team",
      "project",
    ]) {
      expect(names.has(god), god).toBe(true);
    }

    for (const verb of [
      "read_file",
      "read_image",
      "web_fetch",
      "agent_send",
      "project_send",
      "search_skill",
      "install_skill",
      "todo_create",
      "todo_list",
      "terminal_list",
      "terminal_write",
      "find_callers",
      "lsp_check",
      "browser_open",
      "computer_snapshot",
      "board_get",
    ]) {
      expect(names.has(verb), verb).toBe(true);
    }
  });

  it("exposes prefix whitelist for verb families", () => {
    const reg = registry();
    const schemas = reg.nativeToolSchemas(new Set(["terminal/*", "browser/*", "computer/*"]));
    const names = schemas.map((item) => String(item.name ?? ""));
    expect(names).toContain("terminal_write");
    expect(names).toContain("browser_click");
    expect(names).toContain("computer_click");
    expect(names).not.toContain("use_terminal");
    expect(names).not.toContain("use_computer");
    expect(names).not.toContain("reader");
  });

  it("keeps find_code and lsp as separate whitelist families", () => {
    const reg = registry();
    const findOnly = reg.nativeToolSchemas(new Set(["find/*"])).map((item) => String(item.name ?? ""));
    const lspOnly = reg.nativeToolSchemas(new Set(["lsp/*"])).map((item) => String(item.name ?? ""));
    expect(findOnly).toContain("find_code");
    expect(findOnly).toContain("find_callers");
    expect(findOnly).not.toContain("lsp");
    expect(lspOnly).toContain("lsp");
    expect(lspOnly).toContain("lsp_check");
    expect(lspOnly).not.toContain("find_code");
  });

  it("keeps use_skill and skill as distinct tools", () => {
    const reg = registry();
    expect(reg.get("use_skill")?.definition.name).toBe("use_skill");
    expect(reg.get("skill")?.definition.name).toBe("skill");
    expect(reg.get("load_skill")?.definition.name).toBe("use_skill");
    expect(reg.get("use_skill")).not.toBe(reg.get("skill"));
  });

  it("read_file rejects urls and images", async () => {
    const reg = registry();
    const file = reg.get("read_file");
    const image = reg.get("read_image");
    const fetch = reg.get("web_fetch");
    const ctx = {
      workingDir: process.cwd(),
      projectRoot: process.cwd(),
      agentMode: "execute",
    } as never;

    expect((await file!.execute({ path: "https://example.com" }, ctx)).ok).toBe(false);
    expect((await image!.execute({ path: "src/index.ts" }, ctx)).ok).toBe(false);
    expect((await fetch!.execute({ path: "src/index.ts" }, ctx)).ok).toBe(false);
  });
});
