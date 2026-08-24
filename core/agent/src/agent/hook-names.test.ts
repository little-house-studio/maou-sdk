import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Hooks } from "./hooks.js";
import { hookNameFromFilename, loadHookScripts } from "./hook-loader.js";
import {
  CANONICAL_HOOK_SET,
  HOOK_ALIASES,
  resolveHookName,
} from "./hook-names.js";

describe("hook 名表", () => {
  it("别名落到规范名", () => {
    expect(resolveHookName("tool_call")).toBe("pre_tool_use");
    expect(resolveHookName("tool_result")).toBe("post_tool_use");
    expect(resolveHookName("session_before_compact")).toBe("pre_compact");
    expect(resolveHookName("on_user_message")).toBe("pre_message");
    expect(resolveHookName("loop_end")).toBe("loop_end");
    expect(resolveHookName("Stop")).toBe("stop");
    expect(resolveHookName("UserPromptSubmit")).toBe("pre_message");
    expect(resolveHookName("PostToolUseFailure")).toBe("post_tool_use_failure");
    expect(resolveHookName("PermissionRequest")).toBe("permission_request");
    expect(resolveHookName("StopCancelled")).toBe("abort");
    expect(resolveHookName("SubagentStart")).toBe("subagent_start");
    expect(resolveHookName("tools/pre-execute")).toBe("pre_tool_use");
    expect(resolveHookName("tools_pre_execute")).toBe("pre_tool_use");
    expect(resolveHookName("agent/pre-step")).toBe("before_agent_start");
    expect(resolveHookName("agent/turn-stopping")).toBe("stop");
    expect(resolveHookName("agent/request")).toBe("agent_request");
    expect(resolveHookName("approval/request")).toBe("permission_request");
    expect(resolveHookName("subagent/end")).toBe("subagent_stop");
    expect(resolveHookName("fs/write-intent")).toBe("fs_write_intent");
    expect(resolveHookName("TerminalPreRun")).toBe("terminal_pre_run");
    expect(resolveHookName("TerminalExit")).toBe("terminal_exit");
  });

  it("规范名都在 CANONICAL_HOOK_SET", () => {
    expect(CANONICAL_HOOK_SET.has("error")).toBe(true);
    expect(CANONICAL_HOOK_SET.has("session_fork")).toBe(true);
    expect(CANONICAL_HOOK_SET.has("prompt_refresh")).toBe(true);
    expect(CANONICAL_HOOK_SET.has("loop_end")).toBe(true);
    expect(CANONICAL_HOOK_SET.has("stop")).toBe(true);
    expect(CANONICAL_HOOK_SET.has("stop_failure")).toBe(true);
    expect(CANONICAL_HOOK_SET.has("subagent_start")).toBe(true);
    expect(CANONICAL_HOOK_SET.has("permission_request")).toBe(true);
    expect(CANONICAL_HOOK_SET.has("post_tool_use_failure")).toBe(true);
    expect(CANONICAL_HOOK_SET.has("post_tool_batch")).toBe(true);
    expect(CANONICAL_HOOK_SET.has("notification")).toBe(true);
    expect(CANONICAL_HOOK_SET.has("agent_request")).toBe(true);
    expect(CANONICAL_HOOK_SET.has("fs_write_intent")).toBe(true);
    expect(CANONICAL_HOOK_SET.has("terminal_pre_run")).toBe(true);
    expect(CANONICAL_HOOK_SET.has("terminal_exit")).toBe(true);
    expect(CANONICAL_HOOK_SET.has("response_chunk")).toBe(false);
  });

  it("别名键都能 resolve 到规范名", () => {
    for (const [alias, canonical] of Object.entries(HOOK_ALIASES)) {
      expect(resolveHookName(alias)).toBe(canonical);
      expect(CANONICAL_HOOK_SET.has(canonical)).toBe(true);
    }
  });
});

describe("Hooks 别名只打一次", () => {
  it("on(tool_call) 与 pre_tool_use 同一条链", async () => {
    const hooks = new Hooks();
    let n = 0;
    hooks.on("tool_call", () => {
      n += 1;
    });
    hooks.on("pre_tool_use", () => {
      n += 1;
    });
    await hooks.preToolUse({ id: "1", name: "reader", parameters: {} } as never);
    expect(n).toBe(2);
    expect(hooks.hookNames).toEqual(["pre_tool_use"]);
  });

  it("session_before_compact 取消 pre_compact", async () => {
    const hooks = new Hooks();
    hooks.on("session_before_compact", () => ({ cancel: true }));
    const r = await hooks.preCompact({ sessionId: "s" });
    expect(r.cancel).toBe(true);
  });
});

describe("hook/ 脚本加载", () => {
  it("文件名别名映射", () => {
    expect(hookNameFromFilename("on_user_message.ts")).toBe("pre_message");
    expect(hookNameFromFilename("pre_compact.mjs")).toBe("pre_compact");
    expect(hookNameFromFilename("Stop.ts")).toBe("stop");
    expect(hookNameFromFilename("tools_pre_execute.ts")).toBe("pre_tool_use");
    expect(hookNameFromFilename("agent_pre_step.ts")).toBe("before_agent_start");
    expect(hookNameFromFilename("terminal_pre_run.ts")).toBe("terminal_pre_run");
    expect(hookNameFromFilename("README.md")).toBeNull();
    expect(hookNameFromFilename("unknown.ts")).toBeNull();
  });

  it("加载 default export 并注册", async () => {
    const dir = mkdtempSync(join(process.cwd(), "src/agent/.tmp-hook-"));
    try {
      writeFileSync(
        join(dir, "pre_compact.js"),
        "export default function () { return { cancel: true }; }\n",
        "utf-8",
      );
      const hooks = new Hooks();
      const { loaded } = await loadHookScripts(hooks, [dir]);
      expect(loaded.length).toBe(1);
      const r = await hooks.preCompact({ sessionId: "s" });
      expect(r.cancel).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
