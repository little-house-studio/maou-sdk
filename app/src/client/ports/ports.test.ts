import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLivePorts } from "./live";
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
});
