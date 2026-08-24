import { afterEach, describe, expect, it } from "vitest";
import {
  bindPermissionHookHost,
  consultPermissionHook,
  notifyPermissionDenied,
} from "./permission-hook-host.js";

describe("permission-hook-host", () => {
  afterEach(() => {
    bindPermissionHookHost(null);
  });

  it("未 bind 时 consult 为 ask", async () => {
    const r = await consultPermissionHook({ command: "ls", agentName: "coding" });
    expect(r).toEqual({ decision: "ask" });
  });

  it("allow 跳过审批", async () => {
    bindPermissionHookHost({
      request: async () => ({ decision: "allow" }),
    });
    const r = await consultPermissionHook({ command: "ls", agentName: "coding" });
    expect(r).toEqual({ decision: "allow" });
  });

  it("deny 通知 permission_denied", async () => {
    const denied: string[] = [];
    bindPermissionHookHost({
      request: async () => ({ decision: "deny", reason: "nope" }),
      denied: (p) => {
        denied.push(p.reason ?? "");
      },
    });
    const r = await consultPermissionHook({ command: "rm", agentName: "coding" });
    expect(r).toEqual({ decision: "deny", reason: "nope" });
    expect(denied).toEqual(["nope"]);
  });

  it("notifyPermissionDenied 单独可调", () => {
    const seen: string[] = [];
    bindPermissionHookHost({
      denied: (p) => {
        seen.push(p.command);
      },
    });
    notifyPermissionDenied({ command: "sudo", agentName: "coding", reason: "fatal" });
    expect(seen).toEqual(["sudo"]);
  });
});
