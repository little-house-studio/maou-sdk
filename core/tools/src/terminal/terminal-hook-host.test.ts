import { afterEach, describe, expect, it } from "vitest";
import {
  bindTerminalHookHost,
  emitTerminal,
  gateTerminal,
} from "./terminal-hook-host.js";

describe("terminal-hook-host", () => {
  afterEach(() => {
    bindTerminalHookHost(null);
  });

  it("未 bind 时闸门放行", async () => {
    const r = await gateTerminal("terminal_pre_run", { command: "ls" });
    expect(r).toEqual({ allowed: true });
  });

  it("可拦 run 并带回理由", async () => {
    bindTerminalHookHost({
      gate: async (name, payload) => {
        if (name === "terminal_pre_run" && payload.command === "rm") {
          return { allowed: false, reason: "no rm" };
        }
      },
    });
    const r = await gateTerminal("terminal_pre_run", { command: "rm" });
    expect(r).toEqual({ allowed: false, reason: "no rm" });
  });

  it("可改写 command / data", async () => {
    bindTerminalHookHost({
      gate: async (name) => {
        if (name === "terminal_pre_run") return { allowed: true, command: "echo hi" };
        if (name === "terminal_pre_write") return { allowed: true, data: "y\n" };
        return { allowed: true };
      },
    });
    expect(await gateTerminal("terminal_pre_run", { command: "echo x" })).toEqual({
      allowed: true,
      command: "echo hi",
    });
    expect(await gateTerminal("terminal_pre_write", { id: "t", data: "n\n" })).toEqual({
      allowed: true,
      data: "y\n",
    });
  });

  it("emit 观察事件", () => {
    const seen: string[] = [];
    bindTerminalHookHost({
      emit: (name, payload) => {
        seen.push(`${name}:${String(payload.id)}`);
      },
    });
    emitTerminal("terminal_started", { id: "dev" });
    emitTerminal("terminal_exit", { id: "dev", exit_code: 0 });
    expect(seen).toEqual(["terminal_started:dev", "terminal_exit:dev"]);
  });

  it("gate 抛错时放行", async () => {
    bindTerminalHookHost({
      gate: async () => {
        throw new Error("boom");
      },
    });
    const r = await gateTerminal("terminal_pre_stop", { id: "x" });
    expect(r).toEqual({ allowed: true });
  });
});
