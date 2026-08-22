import { describe, expect, it } from "vitest";
import type { WebhookRequest } from "@little-house-studio/types";
import { dispatchWebhook } from "./dispatch.js";
import type { WebhookHost } from "./host.js";
import { parseWebhookRequest } from "./parse.js";
import type { WebhookTarget } from "./target.js";

function fakeHost(overrides: Partial<WebhookHost> = {}): WebhookHost {
  const target: WebhookTarget = {
    switchId: "system:ops",
    agentName: "ops",
    projectPath: null,
  };
  return {
    listAgents: () => [{ name: "ops", switchId: "system:ops", group: "system" }],
    resolveAgent: () => target,
    status: () => ({
      agent: "ops",
      switchId: "system:ops",
      sessionId: "s1",
      busy: false,
      provider: "p",
      model: "m",
      approvalMode: "yolo",
      projectRoot: "/tmp",
    }),
    send: async () => ({
      status: "started",
      sessionId: "s1",
      switchId: "system:ops",
      agent: "ops",
    }),
    abort: () => ({ aborted: true, sessionId: "s1" }),
    enqueue: () => ({
      queueId: 1,
      sessionId: "s1",
      switchId: "system:ops",
      agent: "ops",
    }),
    listSessions: () => [{ id: "s1", title: "t", messageCount: 1 }],
    newSession: () => ({ sessionId: "s2" }),
    switchSession: () => ({ sessionId: "s1" }),
    clearSession: () => ({ sessionId: "s1" }),
    deleteSession: () => ({ deleted: true, sessionId: null }),
    renameSession: () => ({ sessionId: "s1", title: "x" }),
    sessionMessages: () => ({ sessionId: "s1", messages: [] }),
    sessionStats: () => ({ sessionId: "s1", stats: { messageCount: 0 } }),
    exportSession: () => ({ sessionId: "s1", text: "" }),
    getModel: () => ({ provider: "p", model: "m" }),
    setModel: (provider, model) => ({ provider, model }),
    listProviders: () => [{ id: "p" }],
    listModels: () => [{ id: "m" }],
    getApprovalMode: () => "yolo",
    setApprovalMode: (mode) => mode,
    listApprovals: () => [],
    answerApproval: () => true,
    listQueue: () => [],
    clearQueue: () => 0,
    removeQueue: () => false,
    ...overrides,
  };
}

describe("dispatchWebhook", () => {
  it("help lists actions", async () => {
    const r = await dispatchWebhook({ action: "help" }, fakeHost());
    expect(r.ok).toBe(true);
    expect(Array.isArray(r.actions)).toBe(true);
  });

  it("send forwards the Agent Message body", async () => {
    let seen: unknown;
    const host = fakeHost({
      send: async (opts) => {
        seen = opts.message;
        return {
          status: "started",
          sessionId: "s1",
          switchId: "system:ops",
          agent: "ops",
        };
      },
    });
    const req = parseWebhookRequest({
      action: "send",
      agent: "ops",
      message: {
        name: "门磁",
        content: "人回来了",
        image: [{ mimeType: "image/png", data: "abc" }],
        command: "goal",
      },
    });
    const r = await dispatchWebhook(req, host);
    expect(r.ok).toBe(true);
    expect(seen).toMatchObject({
      name: "门磁",
      content: "人回来了",
      command: "goal",
      image: [{ mimeType: "image/png", data: "abc" }],
    });
  });

  it("send returns 202 when not waiting", async () => {
    const req: WebhookRequest = {
      action: "send",
      agent: "ops",
      message: "hi",
    };
    const r = await dispatchWebhook(req, fakeHost());
    expect(r.ok).toBe(true);
    expect(r.status).toBe(202);
    expect(r.delivery).toBe("started");
    expect(r.sessionId).toBe("s1");
  });

  it("command /new maps to sessions.new", async () => {
    let seen = "";
    const host = fakeHost({
      newSession: (opts) => {
        seen = opts.title ?? "";
        return { sessionId: "n1" };
      },
    });
    const r = await dispatchWebhook(
      { action: "command", command: "new", args: { title: "回家" } },
      host,
    );
    expect(r.ok).toBe(true);
    expect(r.action).toBe("sessions.new");
    expect(seen).toBe("回家");
    expect(r.sessionId).toBe("n1");
  });

  it("unknown command fails", async () => {
    const r = await dispatchWebhook(
      { action: "command", command: "not-a-thing" },
      fakeHost(),
    );
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
  });
});
