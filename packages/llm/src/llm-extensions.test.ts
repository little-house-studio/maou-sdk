/**
 * 新增 LLM 能力的回归测试（对标 pi-ai 补齐的能力）。
 * 全程使用 faux 短路，无需联网。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  getModel,
  getProviders,
  modelToAPIPreset,
  defineTool,
  Type,
  validateToolCall,
  agentLoop,
  registerFauxProvider,
  clearFauxProviders,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  normalizeForHandoff,
  getImageModel,
  getImageProviders,
  ChatSession,
  type APIPreset,
} from "./index.js";
import { startAnthropicLogin } from "./oauth/index.js";
import { generateCodeVerifier, codeChallengeS256 } from "./oauth/pkce.js";

describe("模型注册表", () => {
  it("getModel 返回能力与定价", () => {
    const m = getModel("anthropic", "claude-sonnet-4-5");
    expect(m).toBeTruthy();
    expect(m!.pricing?.input).toBe(3);
    expect(m!.toolCall).toBe(true);
    expect(m!.input).toContain("image");
  });

  it("getProviders 覆盖主要厂商", () => {
    const ids = getProviders().map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["openai", "anthropic", "google", "deepseek"]));
  });

  it("modelToAPIPreset 注入定价与能力位", () => {
    const preset = modelToAPIPreset("anthropic", "claude-sonnet-4-5", { key: "sk-test" });
    expect(preset.model).toBe("claude-sonnet-4-5");
    expect(preset.protocol).toBe("anthropic");
    expect((preset as Record<string, unknown>).pricing).toBeTruthy();
  });
});

describe("TypeBox 类型安全工具", () => {
  const add = defineTool({
    name: "add",
    description: "两数相加",
    parameters: Type.Object({ a: Type.Number(), b: Type.Number() }),
    execute: ({ a, b }) => a + b,
  });

  it("自动强转字符串数字并通过校验", () => {
    const v = validateToolCall(add, { parameters: { a: "3", b: 4 } });
    expect(v.ok).toBe(true);
    expect(v.value).toEqual({ a: 3, b: 4 });
  });

  it("非法参数被拒绝并给出错误", () => {
    const v = validateToolCall(add, { parameters: { a: "x" } });
    expect(v.ok).toBe(false);
    expect(v.errors?.length).toBeGreaterThan(0);
  });

  it("toSchema 产出 OpenAI function 形状", () => {
    const s = add.toSchema();
    expect(s.name).toBe("add");
    expect(s.parameters).toMatchObject({ type: "object" });
  });
});

describe("faux provider + agentLoop", () => {
  beforeEach(() => clearFauxProviders());

  it("调工具 → 喂回结果 → 给最终答案", async () => {
    const add = defineTool({
      name: "add",
      description: "两数相加",
      parameters: Type.Object({ a: Type.Number(), b: Type.Number() }),
      execute: ({ a, b }) => a + b,
    });
    registerFauxProvider({
      model: "faux-model",
      responses: [
        fauxAssistantMessage(fauxToolCall("add", { a: 3, b: 4 })),
        fauxAssistantMessage(fauxText("结果是 7")),
      ],
    });
    const preset: APIPreset = { model: "faux-model", url: "http://faux", protocol: "faux", key: "x" };

    let toolResult = "";
    const loop = agentLoop({ preset, tools: [add], prompt: "3+4=?" });
    let it = await loop.next();
    while (!it.done) {
      if (it.value.type === "tool_result") toolResult = it.value.result;
      it = await loop.next();
    }
    expect(toolResult).toBe("7");
    expect(it.value.steps).toBe(2);
    expect(it.value.finalText).toContain("7");
    expect(it.value.stoppedReason).toBe("done");
  });
});

describe("ChatSession + faux", () => {
  beforeEach(() => clearFauxProviders());

  it("非流式 send 返回预设响应", async () => {
    registerFauxProvider({ responses: ["你好呀～"] });
    const session = new ChatSession({ preset: { model: "any", url: "http://faux", protocol: "faux", key: "x" } });
    const resp = await session.send("hi");
    expect(resp.content).toContain("你好呀");
  });

  it("流式 sendStream 累积一致", async () => {
    registerFauxProvider({ responses: ["流式输出测试"] });
    const session = new ChatSession({ preset: { model: "any", url: "http://faux", protocol: "faux", key: "x" } });
    let acc = "";
    for await (const d of session.sendStream("hi")) {
      if (d.type === "delta" && d.delta) acc += d.delta;
    }
    expect(acc).toBe("流式输出测试");
  });
});

describe("跨厂商交接 handoff", () => {
  it("thinking 标签统一 + 视觉/工具降级", () => {
    const out = normalizeForHandoff(
      [
        { role: "user", content: "看图", attachments: [{ type: "image", data: "AAAA", mimeType: "image/png" }], timestamp: 0 },
        { role: "assistant", content: "<think>内部推理</think>外部回答", timestamp: 0 },
      ],
      { targetSupportsTools: false, targetSupportsVision: false, thinking: "tag" },
    );
    expect(out[1].content).toContain("<thinking>");
    expect(out[1].content).toContain("外部回答");
    expect(out[0].content).toContain("已省略");
    expect(out[0].attachments).toBeUndefined();
  });
});

describe("图片生成目录", () => {
  it("getImageModel / getImageProviders", () => {
    expect(getImageModel("openai", "gpt-image-1")?.name).toBe("GPT Image 1");
    expect(getImageProviders().map((p) => p.id)).toContain("openai");
  });
});

describe("订阅 OAuth", () => {
  it("Anthropic 授权 URL 含 client_id 与 PKCE challenge", () => {
    const login = startAnthropicLogin();
    expect(login.url).toContain("client_id=9d1c250a");
    expect(login.url).toContain("code_challenge=");
    expect(login.url).toContain("code_challenge_method=S256");
    expect(login.codeVerifier.length).toBeGreaterThanOrEqual(43);
  });

  it("PKCE challenge 由 verifier 派生", () => {
    const verifier = generateCodeVerifier();
    const challenge = codeChallengeS256(verifier);
    expect(challenge.length).toBeGreaterThan(0);
    expect(challenge).not.toContain("=");
  });
});

describe("协议路由：新增 5 个适配器已注册", () => {
  it("normalizeApiProtocol 识别新协议", async () => {
    const { normalizeApiProtocol } = await import("./adapters/types.js");
    expect(normalizeApiProtocol("azure")).toBe("azure");
    expect(normalizeApiProtocol("cloudflare")).toBe("cloudflare");
    expect(normalizeApiProtocol("vertex")).toBe("google-vertex");
    expect(normalizeApiProtocol("codex")).toBe("openai-codex");
    expect(normalizeApiProtocol("copilot")).toBe("github-copilot");
  });

  it("ProtocolGateway 能解析出对应适配器", async () => {
    const { ProtocolGateway } = await import("./adapters/router.js");
    const gw = new ProtocolGateway();
    expect(gw.resolve("azure").protocolName).toBe("azure");
    expect(gw.resolve("github-copilot").protocolName).toBe("github-copilot");
    expect(gw.resolve("openai-codex").protocolName).toBe("openai-codex");
  });
});
