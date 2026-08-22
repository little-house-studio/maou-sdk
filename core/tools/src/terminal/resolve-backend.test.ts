import { afterEach, describe, expect, it } from "vitest";
import { nativeWasProbed } from "./full-backend.js";
import {
  applyAgentShellEnv,
  resetTerminalBackendForTest,
  rebindTerminalPersist,
  resolveInteractiveShell,
  resolveTerminalBackend,
  resolveTerminalPersistPath,
  setAgentTerminalMode,
} from "./resolve-backend.js";

describe("resolveTerminalBackend", () => {
  afterEach(() => {
    resetTerminalBackendForTest();
  });

  it("显式 mini 强制纯 Node，不探测 Rust", () => {
    const r = resolveTerminalBackend({
      env: { ...process.env, MAOU_TERMINAL: "mini" },
      configMode: "full",
    });
    expect(r.kind).toBe("mini");
    expect(r.degraded).toBe(false);
    expect(r.requested).toBe("mini");
    expect(nativeWasProbed()).toBe(false);
  });

  it("env 覆盖 config", () => {
    const r = resolveTerminalBackend({
      env: { ...process.env, MAOU_TERMINAL: "mini" },
      configMode: "full",
      agentTerminalMode: "full",
    });
    expect(r.requested).toBe("mini");
    expect(r.kind).toBe("mini");
    expect(nativeWasProbed()).toBe(false);
  });

  it("full 无 .node 降级 mini", () => {
    const r = resolveTerminalBackend({
      env: { ...process.env, MAOU_TERMINAL: "full" },
      nativeAvailable: false,
    });
    expect(r.kind).toBe("mini");
    expect(r.degraded).toBe(true);
    expect(r.requested).toBe("full");
    expect(r.backend.statusPanel("x")).toMatch(/degraded from full/);
  });

  it("agent.json terminalMode=mini（无 env）", () => {
    setAgentTerminalMode("mini");
    const env = { ...process.env };
    delete env.MAOU_TERMINAL;
    const r = resolveTerminalBackend({ env, configMode: "full" });
    expect(r.kind).toBe("mini");
    expect(r.degraded).toBe(false);
    expect(nativeWasProbed()).toBe(false);
  });
});

describe("resolveInteractiveShell", () => {
  it("MAOU_SHELL 优先于 config.shell", () => {
    expect(
      resolveInteractiveShell({
        env: { ...process.env, MAOU_SHELL: "/bin/zsh" },
        configPath: "/nonexistent/maou-config.json",
      }),
    ).toBe("/bin/zsh");
  });

  it("persist 路径与 Agent 一致：<project>/.maou/terminals.json", () => {
    expect(resolveTerminalPersistPath("/tmp/proj")).toMatch(/[/\\]\.maou[/\\]terminals\.json$/);
    expect(resolveTerminalPersistPath("/tmp/proj")).toContain("proj");
  });

  it("applyAgentShellEnv 在 Unix 不写 MAOU_SHELL", () => {
    if (process.platform === "win32") return;
    const before = process.env.MAOU_SHELL;
    applyAgentShellEnv({ env: { ...process.env, MAOU_SHELL: "C:\\Windows\\System32\\cmd.exe" } });
    expect(process.env.MAOU_SHELL).toBe(before);
  });

  it("rebindTerminalPersist 不抛，且指向新项目", () => {
    resolveTerminalBackend({ env: { ...process.env, MAOU_TERMINAL: "mini" } });
    expect(() => rebindTerminalPersist("/tmp/other-proj")).not.toThrow();
  });
});
