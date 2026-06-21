/**
 * 第二批新增能力的回归测试（Wave A/B/C：Vertex URL、env 检测、toolCall-ID 归一、
 * overflow 检测、reasoning 5 级、cacheRetention、OpenRouter routing、fetch 注入 + 钩子）。
 */
import { describe, it, expect } from "vitest";
import {
  getEnvApiKey,
  findEnvKeys,
  detectContextOverflow,
  extractTokenCount,
  reasoningParamsFor,
  toOpenAIReasoningEffort,
  reasoningLevelFromBudget,
  normalizeToolCallIds,
  defineTool,
  Type,
  StringEnum,
  validateToolCall,
  LLMClient,
  type APIPreset,
} from "./index.js";
import { AnthropicMessagesAdapter } from "./adapters/anthropic.js";
import { OpenAIChatAdapter } from "./adapters/openai.js";

describe("环境变量检测 (#6)", () => {
  it("getEnvApiKey 按候选名命中", () => {
    process.env.MOONSHOT_API_KEY = "sk-moon";
    expect(getEnvApiKey("moonshot")).toBe("sk-moon");
    delete process.env.MOONSHOT_API_KEY;
    process.env.KIMI_API_KEY = "sk-kimi";
    expect(getEnvApiKey("moonshot")).toBe("sk-kimi"); // 回退到第二候选
    delete process.env.KIMI_API_KEY;
  });
  it("findEnvKeys 扫描出已配置的 provider", () => {
    process.env.GROQ_API_KEY = "gsk_x";
    expect(findEnvKeys().some((e) => e.provider === "groq")).toBe(true);
    delete process.env.GROQ_API_KEY;
  });
});

describe("上下文溢出检测 (#14)", () => {
  it("识别多厂商溢出文案", () => {
    expect(detectContextOverflow("This model's maximum context length is 8192 tokens")).toBe(true);
    expect(detectContextOverflow("prompt is too long: 250000 tokens > 200000 maximum")).toBe(true);
    expect(detectContextOverflow("The input token count (1200000) exceeds the maximum")).toBe(true);
    expect(detectContextOverflow("rate limit exceeded")).toBe(false);
    expect(detectContextOverflow("", 413)).toBe(true);
  });
  it("extractTokenCount 抽取 token 数", () => {
    expect(extractTokenCount("prompt is too long: 250000 tokens")).toBe(250000);
    expect(extractTokenCount("nope")).toBeNull();
  });
});

describe("统一思考强度 5 级 (#12)", () => {
  it("reasoningParamsFor 各级别预算", () => {
    expect(reasoningParamsFor("off")).toEqual({ thinking: { type: "disabled" } });
    expect(reasoningParamsFor("minimal")).toEqual({ thinking: { type: "enabled", budget_tokens: 1024 } });
    expect(reasoningParamsFor("xhigh")).toEqual({ thinking: { type: "enabled", budget_tokens: 32768 } });
    expect(reasoningParamsFor("high", { budgetTokens: 5000 })).toEqual({ thinking: { type: "enabled", budget_tokens: 5000 } });
  });
  it("到 OpenAI effort 的映射 + 反向", () => {
    expect(toOpenAIReasoningEffort("minimal")).toBe("minimal");
    expect(toOpenAIReasoningEffort("xhigh")).toBe("high");
    expect(toOpenAIReasoningEffort("off")).toBeNull();
    expect(reasoningLevelFromBudget(1024)).toBe("minimal");
    expect(reasoningLevelFromBudget(30000)).toBe("xhigh");
  });
});

describe("toolCall ID 归一化 (#10)", () => {
  it("跨厂商 id 统一为 call_N 且保持配对", () => {
    const out = normalizeToolCallIds([
      { role: "assistant", content: "", tool_calls: [{ id: "toolu_abc", type: "function", function: { name: "f", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "toolu_abc", content: "42" },
    ]);
    const asst = out[0] as Record<string, unknown>;
    const calls = asst.tool_calls as Array<Record<string, unknown>>;
    expect(calls[0].id).toBe("call_1");
    expect((out[1] as Record<string, unknown>).tool_call_id).toBe("call_1");
  });
});

describe("TypeBox 编译校验 + 枚举 (#16)", () => {
  it("StringEnum union 匹配 + 编译校验缓存命中两次", () => {
    const tool = defineTool({
      name: "pick",
      description: "选择单位",
      parameters: Type.Object({ unit: StringEnum(["c", "f"]) }),
    });
    expect(validateToolCall(tool, { parameters: { unit: "c" } }).ok).toBe(true);
    expect(validateToolCall(tool, { parameters: { unit: "x" } }).ok).toBe(false);
    // 第二次调用走 WeakMap 缓存，仍正确
    expect(validateToolCall(tool, { parameters: { unit: "f" } }).ok).toBe(true);
  });
});

describe("Anthropic cacheRetention (#11)", () => {
  const adapter = new AnthropicMessagesAdapter();
  const base = (cacheRetention?: string): APIPreset => ({
    model: "claude-sonnet-4-5", url: "https://api.anthropic.com/v1/messages", protocol: "anthropic", key: "k",
    ...(cacheRetention ? { cacheRetention } : {}),
  });
  const msgs = [{ role: "system", content: "你是助手" }, { role: "user", content: "hi" }];

  it("默认 ephemeral，1h 带 ttl + beta 头", () => {
    const def = adapter.buildRequestPayload({ preset: base(), messages: msgs, stream: false });
    expect((def.system as Array<Record<string, unknown>>)[0].cache_control).toEqual({ type: "ephemeral" });

    const long = adapter.buildRequestPayload({ preset: base("1h"), messages: msgs, stream: false });
    expect((long.system as Array<Record<string, unknown>>)[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect(adapter.buildRequestHeaders(base("1h"))["anthropic-beta"]).toContain("extended-cache-ttl");
  });
  it("none 关闭缓存", () => {
    const none = adapter.buildRequestPayload({ preset: base("none"), messages: msgs, stream: false });
    expect((none.system as Array<Record<string, unknown>>)[0].cache_control).toBeUndefined();
  });
});

describe("OpenAI: OpenRouter routing + reasoning 解析 (#25/#13)", () => {
  const adapter = new OpenAIChatAdapter();
  it("openrouterRouting 注入 provider/models", () => {
    const preset = {
      model: "anthropic/claude-sonnet-4.5", url: "https://openrouter.ai/api/v1/chat/completions", protocol: "openai", key: "k",
      openrouterRouting: { provider: { sort: "throughput" }, models: ["a/b", "c/d"] },
    } as unknown as APIPreset;
    const payload = adapter.buildRequestPayload({ preset, messages: [{ role: "user", content: "hi" }], stream: false });
    expect(payload.provider).toEqual({ sort: "throughput" });
    expect(payload.models).toEqual(["a/b", "c/d"]);
  });
  it("解析 OpenRouter reasoning 字段", () => {
    const parsed = adapter.parseNonstreamResponse({
      choices: [{ message: { content: "答案", reasoning: "我的推理过程" }, finish_reason: "stop" }],
    });
    expect(parsed.content).toBe("答案");
    expect(parsed.reasoningContent).toBe("我的推理过程");
  });
});

describe("LLMClient: fetch 注入 + onPayload/onResponse (#26/#27)", () => {
  it("注入 fetch、改写 body、触发响应钩子", async () => {
    const calls: { url: string; body: string }[] = [];
    let responded = false;
    const fakeFetch = (async (url: string, init: { body: string }) => {
      calls.push({ url: String(url), body: String(init.body) });
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const client = new LLMClient({
      fetchImpl: fakeFetch,
      onPayload: ({ body }) => ({ body: body.replace('"hi"', '"changed"') }),
      onResponse: () => { responded = true; },
    });
    const preset: APIPreset = { model: "gpt-4o", url: "https://api.openai.com/v1/chat/completions", protocol: "openai", key: "k" };
    const resp = await client.chat({ preset, messages: [{ role: "user", content: "hi" }] });
    expect(resp.content).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toContain('"changed"'); // onPayload 改写生效
    expect(responded).toBe(true);                  // onResponse 触发
  });

  it("Vertex URL 由 project/location/model 拼出", async () => {
    let capturedUrl = "";
    const fakeFetch = (async (url: string) => {
      capturedUrl = String(url);
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const client = new LLMClient({ fetchImpl: fakeFetch });
    const preset = {
      model: "gemini-2.5-pro", url: "", protocol: "google-vertex", key: "tok",
      project: "my-proj", location: "us-central1",
    } as unknown as APIPreset;
    await client.chat({ preset, messages: [{ role: "user", content: "hi" }] });
    expect(capturedUrl).toContain("us-central1-aiplatform.googleapis.com");
    expect(capturedUrl).toContain("/publishers/google/models/gemini-2.5-pro:generateContent");
  });
});
