/**
 * 第三批新增能力测试（Wave D：browser/Bun env、stealth、WebSocket 传输、session 清理、proxy）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  readEnv,
  isBrowserLike,
  createStealthMapper,
  CLAUDE_CODE_TOOL_MAP,
  createWebSocketFetch,
  LLMClient,
  ChatSession,
  agentLoop,
  defineTool,
  Type,
  registerFauxProvider,
  clearFauxProviders,
  fauxAssistantMessage,
  fauxToolCall,
  type APIPreset,
} from "./index.js";
import { createProxyFetch, getProxyDispatcher } from "./proxy.js";

describe("跨运行时 env (#22/#9)", () => {
  it("readEnv 读 process.env，缺失返回 undefined", () => {
    process.env.__MAOU_TEST__ = "v1";
    expect(readEnv("__MAOU_TEST__")).toBe("v1");
    delete process.env.__MAOU_TEST__;
    expect(readEnv("__MAOU_TEST__")).toBeUndefined();
  });
  it("Node 环境 isBrowserLike=false", () => {
    expect(isBrowserLike()).toBe(false);
  });
});

describe("Stealth 工具名伪装 (#19)", () => {
  it("forward 映射到 Claude Code 名并可逆", () => {
    const m = createStealthMapper();
    expect(m.forwardName("use_terminal")).toBe("Bash");
    expect(m.forwardName("reader")).toBe("Read");
    expect(m.restoreName("Bash")).toBe("use_terminal");
  });
  it("同名冲突时后者保留原名（保证可逆）", () => {
    const m = createStealthMapper();
    expect(m.forwardName("agent_message")).toBe("Task"); // 先到先得
    expect(m.forwardName("agent_manage")).toBe("agent_manage"); // Task 已占用 → 保留
    expect(m.restoreName("Task")).toBe("agent_message");
  });
  it("applySchemas 改写 name", () => {
    const m = createStealthMapper();
    const out = m.applySchemas([{ name: "write_file", description: "", parameters: {} }]);
    expect(out[0].name).toBe("Write");
    expect(CLAUDE_CODE_TOOL_MAP.write_file).toBe("Write");
  });
});

describe("agentLoop stealth 模式 (#19)", () => {
  beforeEach(() => clearFauxProviders());
  it("以 Claude 名发出、还原本项目工具执行", async () => {
    const term = defineTool({
      name: "use_terminal",
      description: "执行命令",
      parameters: Type.Object({ cmd: Type.String() }),
      execute: ({ cmd }) => `ran:${cmd}`,
    });
    // 模型按伪装后的名字 "Bash" 回传调用
    registerFauxProvider({
      model: "faux-model",
      responses: [fauxAssistantMessage(fauxToolCall("Bash", { cmd: "ls" })), fauxAssistantMessage("done")],
    });
    const preset: APIPreset = { model: "faux-model", url: "http://faux", protocol: "faux", key: "x" };
    let toolResult = "";
    const loop = agentLoop({ preset, tools: [term], prompt: "list", stealth: true });
    let it = await loop.next();
    while (!it.done) {
      if (it.value.type === "tool_result") toolResult = it.value.result;
      it = await loop.next();
    }
    expect(toolResult).toBe("ran:ls");
    expect(it.value.finalText).toContain("done");
  });
});

describe("WebSocket 传输 (#17)", () => {
  it("createWebSocketFetch 适配为 SSE，LLMClient 正常解析", async () => {
    // mock WebSocket：open 后收到 send，回放两条 openai chunk + [DONE]
    class MockWS {
      readyState = 0;
      private ls: Record<string, Array<(ev: { data?: unknown }) => void>> = {};
      constructor(public url: string) {
        setTimeout(() => { this.readyState = 1; this.fire("open", {}); }, 0);
      }
      addEventListener(t: string, cb: (ev: { data?: unknown }) => void) { (this.ls[t] ??= []).push(cb); }
      private fire(t: string, ev: { data?: unknown }) { (this.ls[t] || []).forEach((cb) => cb(ev)); }
      send() {
        setTimeout(() => {
          this.fire("message", { data: JSON.stringify({ choices: [{ delta: { content: "hello" } }] }) });
          this.fire("message", { data: JSON.stringify({ choices: [{ delta: { content: " ws" } }] }) });
          this.fire("message", { data: "[DONE]" });
        }, 0);
      }
      close() { this.readyState = 3; }
    }
    const wsFetch = createWebSocketFetch({ url: "ws://mock", WebSocketImpl: MockWS as unknown as never });
    const client = new LLMClient({ fetchImpl: wsFetch });
    const preset: APIPreset = { model: "x", url: "https://api.example.com/v1/chat/completions", protocol: "openai", key: "k" };
    const resp = await client.chat({ preset, messages: [{ role: "user", content: "hi" }] });
    expect(resp.content).toBe("hello ws");
  });
});

describe("Session 资源清理 (#23)", () => {
  it("dispose 执行注册的清理回调", async () => {
    const session = new ChatSession({ preset: { model: "x", url: "http://faux", protocol: "faux", key: "x" } });
    let cleaned = 0;
    session.onCleanup(() => { cleaned += 1; });
    session.onCleanup(async () => { cleaned += 10; });
    await session.dispose();
    expect(cleaned).toBe(11);
  });
});

describe("HTTP 代理 (#18)", () => {
  it("createProxyFetch 返回 fetch；getProxyDispatcher 返回 dispatcher", () => {
    expect(typeof createProxyFetch()).toBe("function");
    expect(getProxyDispatcher({ uri: "http://127.0.0.1:7890" })).toBeTruthy();
  });
});
