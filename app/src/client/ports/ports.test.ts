import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLivePorts } from "./live";
import { createDraftPorts } from "./draft";
import * as api from "../api";

describe("AppPorts", () => {
  it("live ports wrap the same /api helpers", () => {
    const ports = createLivePorts();
    assert.equal(ports.kind, "live");
    assert.equal(ports.shell.fetchMeta, api.fetchMeta);
    assert.equal(ports.chat.streamChat, api.streamChat);
    assert.equal(ports.shell.fetchAgents, api.fetchAgents);
    assert.equal(ports.terminals.agentTerminalWsUrl, api.agentTerminalWsUrl);
  });

  it("draft ports reject live /api methods", async () => {
    const ports = createDraftPorts();
    assert.equal(ports.kind, "draft");
    await assert.rejects(() => ports.shell.fetchMeta(), /draft host/);
  });
});
