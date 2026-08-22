import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dispatchWebhook } from "./dispatch.js";
import { parseWebhookRequest } from "./parse.js";
import { WebhookAgentHost } from "./runtime-host.js";

const root = join(tmpdir(), `maou-webhook-host-${process.pid}`);
const maou = join(root, ".maou-home");
const project = join(root, "project");

describe("WebhookAgentHost via message struct", () => {
  beforeAll(() => {
    mkdirSync(join(project, ".maou"), { recursive: true });
    mkdirSync(join(maou, "ops", ".maou"), { recursive: true });
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("sessions + send + status without UI", async () => {
    const host = new WebhookAgentHost({
      bootProjectRoot: project,
      maouRoot: maou,
      skipRun: true,
      sandboxMode: "yolo",
    });
    const created = await dispatchWebhook(
      parseWebhookRequest({
        action: "sessions.new",
        agent: `project:${project}:coding`,
        title: "回家",
      }),
      host,
    );
    expect(created.ok).toBe(true);
    const sessionId = String(created.sessionId ?? "");
    expect(sessionId).toBeTruthy();

    const sent = await dispatchWebhook(
      parseWebhookRequest({
        action: "send",
        agent: `project:${project}:coding`,
        session: sessionId,
        message: {
          role: "user",
          content: "人回来了",
        },
      }),
      host,
    );
    expect(sent.ok).toBe(true);
    expect(sent.delivery).toBe("started");

    const st = await dispatchWebhook(
      parseWebhookRequest({
        action: "status",
        agent: `project:${project}:coding`,
        session: sessionId,
      }),
      host,
    );
    expect(st.ok).toBe(true);
    expect(st.busy).toBe(true);
    expect(st.sessionId).toBe(sessionId);

    const queued = await dispatchWebhook(
      parseWebhookRequest({
        action: "send",
        agent: `project:${project}:coding`,
        session: sessionId,
        message: "第二句",
      }),
      host,
    );
    expect(queued.delivery).toBe("queued");

    host.abortAll();
  });
});
