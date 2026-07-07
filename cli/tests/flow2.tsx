import React from "react";
import { render } from "ink-testing-library";
import { App } from "../src/app.js";
import { useStore } from "../src/state/store.js";
import type { AgentCliConfig } from "../src/types.js";
const mockConfig: AgentCliConfig = {
  name: "test", createAgent: () => ({ runtime: {} as never, agentName: "t", projectRoot: ".", toolWhitelist: [], startSession: () => "s1" }),
  getPreset: () => ({}), getProviders: () => [], getModels: () => [], listAgents: () => [],
};
const { lastFrame, unmount } = render(<App config={mockConfig} />);
const s = useStore.getState();
s.pushUserMessage("你好");
console.log("store messages:", useStore.getState().messages.length);
console.log("frame has 待命:", lastFrame().includes("待命"));
console.log("frame has 你好:", lastFrame().includes("你好"));
unmount();
