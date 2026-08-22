/**
 * Inbound webhook: target resolve + auth（不加载 AgentHub / tools）。
 * Run: pnpm exec tsx --test src/server/webhook.test.ts
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import {
  checkWebhookAuth,
  readWebhookAgent,
  readWebhookMessage,
} from "./webhook.js";
import {
  resolveWebhookTarget,
  WebhookResolveError,
} from "./webhook-target.js";

const agents = [
  { name: "ops", switchId: "system:ops" },
  {
    name: "coding",
    switchId: "project:/Users/me/maou-sdk:coding",
    projectPath: "/Users/me/maou-sdk",
  },
  {
    name: "coding",
    switchId: "project:/Users/me/other:coding",
    projectPath: "/Users/me/other",
  },
  {
    name: "explore",
    switchId: "project:/Users/me/maou-sdk:explore",
    projectPath: "/Users/me/maou-sdk",
  },
];

describe("resolveWebhookTarget", () => {
  it("empty raw uses the active switch", () => {
    const t = resolveWebhookTarget({
      raw: "",
      agents,
      activeSwitchId: "system:ops",
      bootProjectRoot: "/Users/me/maou-sdk",
      maouRoot: "/tmp/.maou",
    });
    assert.equal(t.switchId, "system:ops");
    assert.equal(t.agentName, "ops");
  });

  it("accepts system: and project: switch ids", () => {
    const ops = resolveWebhookTarget({
      raw: "system:ops",
      agents,
      activeSwitchId: "system:ops",
      bootProjectRoot: "/Users/me/maou-sdk",
      maouRoot: "/tmp/.maou",
    });
    assert.equal(ops.switchId, "system:ops");
    const coding = resolveWebhookTarget({
      raw: "project:/Users/me/other:coding",
      agents,
      activeSwitchId: "system:ops",
      bootProjectRoot: "/Users/me/maou-sdk",
      maouRoot: "/tmp/.maou",
    });
    assert.equal(coding.switchId, "project:/Users/me/other:coding");
    assert.equal(coding.projectPath, "/Users/me/other");
  });

  it("bare unique name hits that agent", () => {
    const t = resolveWebhookTarget({
      raw: "ops",
      agents,
      activeSwitchId: "project:/Users/me/maou-sdk:coding",
      bootProjectRoot: "/Users/me/maou-sdk",
      maouRoot: "/tmp/.maou",
    });
    assert.equal(t.switchId, "system:ops");
  });

  it("ambiguous coding prefers active, then boot project", () => {
    const active = resolveWebhookTarget({
      raw: "coding",
      agents,
      activeSwitchId: "project:/Users/me/other:coding",
      bootProjectRoot: "/Users/me/maou-sdk",
      maouRoot: "/tmp/.maou",
    });
    assert.equal(active.switchId, "project:/Users/me/other:coding");

    const boot = resolveWebhookTarget({
      raw: "coding",
      agents,
      activeSwitchId: "system:ops",
      bootProjectRoot: "/Users/me/maou-sdk",
      maouRoot: "/tmp/.maou",
    });
    assert.equal(boot.switchId, "project:/Users/me/maou-sdk:coding");
  });

  it("ambiguous name with no hint is 409", () => {
    assert.throws(
      () =>
        resolveWebhookTarget({
          raw: "coding",
          agents,
          activeSwitchId: "system:ops",
          bootProjectRoot: "/Users/me/unrelated",
          maouRoot: "/tmp/.maou",
        }),
      (e: unknown) =>
        e instanceof WebhookResolveError &&
        e.status === 409 &&
        (e.candidates?.length ?? 0) === 2,
    );
  });

  it("rejects stationed affiliates", () => {
    assert.throws(
      () =>
        resolveWebhookTarget({
          raw: "proactive",
          agents,
          activeSwitchId: "system:ops",
          bootProjectRoot: "/Users/me/maou-sdk",
          maouRoot: "/tmp/.maou",
        }),
      (e: unknown) =>
        e instanceof WebhookResolveError && e.status === 400,
    );
  });
});

describe("webhook request helpers", () => {
  it("reads agent and message aliases", () => {
    const req = {
      body: { switch_id: "system:ops", text: "人回来了" },
      query: {},
      params: {},
    } as unknown as Request;
    assert.equal(readWebhookAgent(req), "system:ops");
    assert.equal(readWebhookMessage(req), "人回来了");
  });

  it("falls back to path param", () => {
    const req = {
      body: { message: "hi" },
      query: {},
      params: { agent: "ops" },
    } as unknown as Request;
    assert.equal(readWebhookAgent(req), "ops");
  });

  it("reads Agent Message object as speak payload", () => {
    const req = {
      body: {
        message: { role: "user", content: "人回来了" },
      },
      query: {},
      params: {},
    } as unknown as Request;
    assert.equal(readWebhookMessage(req), "人回来了");
  });
});

describe("checkWebhookAuth", () => {
  const prev = process.env.MAOU_WEBHOOK_SECRET;

  const fakeReq = (headers: Record<string, string>): Request =>
    ({
      get(name: string) {
        const key = name.toLowerCase();
        return headers[key];
      },
    }) as Request;

  after(() => {
    if (prev == null) delete process.env.MAOU_WEBHOOK_SECRET;
    else process.env.MAOU_WEBHOOK_SECRET = prev;
  });

  it("open when secret unset", () => {
    delete process.env.MAOU_WEBHOOK_SECRET;
    assert.equal(checkWebhookAuth(fakeReq({})), true);
  });

  it("accepts bearer or x-webhook-secret", () => {
    process.env.MAOU_WEBHOOK_SECRET = "s3cret";
    assert.equal(checkWebhookAuth(fakeReq({})), false);
    assert.equal(
      checkWebhookAuth(fakeReq({ authorization: "Bearer s3cret" })),
      true,
    );
    assert.equal(
      checkWebhookAuth(fakeReq({ "x-webhook-secret": "s3cret" })),
      true,
    );
    assert.equal(
      checkWebhookAuth(fakeReq({ authorization: "Bearer nope" })),
      false,
    );
  });
});
