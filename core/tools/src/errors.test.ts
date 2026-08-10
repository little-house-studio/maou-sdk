/**
 * Tool error taxonomy — pure unit tests (no I/O).
 */
import { describe, it, expect } from "vitest";
import {
  TOOL_ERROR_CATEGORIES,
  TOOL_ERROR_CATEGORY_EXAMPLES,
  toolFail,
  toolFailFromThrown,
  classifyToolErrorMessage,
  classifyToolThrown,
  ensureToolError,
  createToolResponse,
  formatToolErrorForStream,
  parseToolErrorFromMessage,
  isRetryableToolCategory,
} from "./index.js";
import { ToolExecutor } from "./executor.js";
import { ToolRegistry } from "./registry.js";
import { Tool } from "./base.js";
import type { ToolContext, ToolDefinition, ToolResponse } from "./base.js";

describe("TOOL_ERROR_CATEGORIES table", () => {
  it("covers every category with a constructable failure", () => {
    for (const category of TOOL_ERROR_CATEGORIES) {
      const res = toolFail(category, TOOL_ERROR_CATEGORY_EXAMPLES[category], {
        code: `test_${category}`,
      });
      expect(res.ok).toBe(false);
      expect(res.error?.category).toBe(category);
      expect(res.message.length).toBeGreaterThan(0);
      expect(res.error?.retryable).toBe(isRetryableToolCategory(category));
    }
  });

  it("has example text for every category", () => {
    for (const c of TOOL_ERROR_CATEGORIES) {
      expect(TOOL_ERROR_CATEGORY_EXAMPLES[c]?.length).toBeGreaterThan(0);
    }
  });
});

describe("classifyToolErrorMessage heuristics", () => {
  const cases: Array<[string, string]> = [
    ["❌ 工具 reader 缺少必填参数: path", "invalid_args"],
    ["不支持的工具: foo", "unknown_tool"],
    ["Unknown tool: bar", "unknown_tool"],
    ["文件不存在: src/x.ts", "not_found"],
    ["路径越界（pathGuard.hard）: /etc/passwd", "sandbox_denied"],
    ["路径越过了项目根目录: ../x", "sandbox_denied"],
    ["工具 'edit' 在 plan 模式下不可用", "mode_denied"],
    ["致命指令已拦截", "policy_denied"],
    ["⛔ 用户拒绝了该危险命令", "user_rejected"],
    ["工具 run 执行超时（30秒）", "timeout"],
    ["sqry 未安装。请运行: maou doctor", "dependency_unavailable"],
    ["skill 已存在于 /tmp/x", "precondition"],
    ["URL 读取失败: ENOTFOUND", "external"],
    ["MCP protocol/transport error", "external"],
    ["写入文件失败: EACCES", "execution"],
    ["操作已取消 cancelled", "cancelled"],
    ["请提供 name（新 Agent 名称）。", "invalid_args"],
    ["rm 操作缺少 id 参数", "invalid_args"],
    ["get 需要提供 name 或 category 参数", "invalid_args"],
    ["未找到队友「bob」。", "not_found"],
    ["Self-maintenance 子 Agent 执行器未注入。", "dependency_unavailable"],
    ["当前状态为 planning，只能在 started 状态验收。", "precondition"],
    ["HTTP 请求失败: 404 Not Found", "external"],
    ["创建项目失败: boom", "execution"],
    ["No query provided", "invalid_args"],
    // example URL in help text must NOT become external
    [
      '❌ use_browser 缺少必填参数 action（操作类型）。正确用法示例：\n{"tool": "use_browser", "params": {"action": "open", "url": "https://example.com"}}\n请用正确的 action 参数重试。',
      "invalid_args",
    ],
    [
      '❌ use_browser batch 缺少必填参数 steps（操作步骤数组）。正确用法示例：\n{"tool": "use_browser", "params": {"action": "batch", "steps": [{"action": "open", "url": "https://example.com"}]}}\n请用正确的 steps 参数重试。',
      "invalid_args",
    ],
    [
      "URL 读取失败: https://example.com ENOTFOUND",
      "external",
    ],
  ];
  for (const [msg, cat] of cases) {
    it(`classifies «${msg.slice(0, 40)}…» → ${cat}`, () => {
      expect(classifyToolErrorMessage(msg)).toBe(cat);
    });
  }
});

describe("createToolResponse ok=false auto error", () => {
  it("attaches classified error when extras omit error", () => {
    const r = createToolResponse(false, "文件不存在: a.ts");
    expect(r.ok).toBe(false);
    expect(r.error?.category).toBe("not_found");
  });

  it("preserves explicit error category", () => {
    const r = createToolResponse(false, "whatever", {
      error: { category: "timeout", code: "t1", retryable: true },
    });
    expect(r.error?.category).toBe("timeout");
    expect(r.error?.code).toBe("t1");
  });

  it("success path has no error field", () => {
    const r = createToolResponse(true, "ok");
    expect(r.ok).toBe(true);
    expect(r.error).toBeUndefined();
  });
});

describe("toolFailFromThrown / path-guard style", () => {
  it("maps path sandbox throw", () => {
    const err = new Error("路径越界（pathGuard.hard）: /secret\n允许根: /proj");
    const r = toolFailFromThrown(err);
    expect(r.ok).toBe(false);
    expect(r.error?.category).toBe("sandbox_denied");
  });

  it("maps TimeoutError name", () => {
    const err = new Error("too slow");
    err.name = "TimeoutError";
    const c = classifyToolThrown(err);
    expect(c.category).toBe("timeout");
  });
});

describe("format/parse stream prefix", () => {
  it("round-trips", () => {
    const good = toolFail("timeout", "tool timed out", { code: "tool_timeout" });
    const s = formatToolErrorForStream(good.error!, good.message);
    expect(s.startsWith("[tool_error]")).toBe(true);
    const back = parseToolErrorFromMessage(s);
    expect(back?.category).toBe("timeout");
    expect(back?.code).toBe("tool_timeout");
  });
});

describe("ToolExecutor gates", () => {
  class DummyTool extends Tool {
    constructor(
      private readonly name: string,
      private readonly modes: string[] | null = null,
      private readonly impl?: () => Promise<ToolResponse>,
    ) {
      super();
    }
    get definition(): ToolDefinition {
      return {
        name: this.name,
        aliases: [],
        description: "d",
        parameters: { type: "object", properties: {} },
        allowedModes: this.modes,
      };
    }
    async execute(): Promise<ToolResponse> {
      if (this.impl) return this.impl();
      return createToolResponse(true, "ok");
    }
  }

  const ctx = {
    projectRoot: "/tmp",
    workingDir: "/tmp",
    agentMode: "agent",
    sessionId: "s",
  } as ToolContext;

  it("unknown tool → unknown_tool", async () => {
    const reg = new ToolRegistry();
    const ex = new ToolExecutor(reg);
    const out = await ex.executeSingle(
      { id: "1", name: "no_such_tool", parameters: {} },
      ctx,
    );
    expect(out.result.ok).toBe(false);
    expect(out.result.error?.category).toBe("unknown_tool");
  });

  it("mode deny → mode_denied", async () => {
    const reg = new ToolRegistry();
    reg.register(new DummyTool("only_plan", ["plan"]));
    const ex = new ToolExecutor(reg);
    const out = await ex.executeSingle(
      { id: "1", name: "only_plan", parameters: {} },
      ctx,
    );
    expect(out.result.ok).toBe(false);
    expect(out.result.error?.category).toBe("mode_denied");
  });

  it("thrown path-guard → sandbox_denied", async () => {
    const reg = new ToolRegistry();
    reg.register(
      new DummyTool("boom", null, async () => {
        throw new Error("路径越过了项目根目录: ../etc/passwd");
      }),
    );
    const ex = new ToolExecutor(reg);
    const out = await ex.executeSingle(
      { id: "1", name: "boom", parameters: {} },
      ctx,
    );
    expect(out.result.ok).toBe(false);
    expect(out.result.error?.category).toBe("sandbox_denied");
  });

  it("tool returns bare ok:false without error → ensureToolError fills", async () => {
    const reg = new ToolRegistry();
    reg.register(
      new DummyTool("bare", null, async () =>
        // bypass createToolResponse to simulate legacy
        ({
          ok: false,
          message: "文件不存在: x",
          displayEvents: [],
          payload: {},
          background: false,
          images: [],
        }),
      ),
    );
    const ex = new ToolExecutor(reg);
    const out = await ex.executeSingle(
      { id: "1", name: "bare", parameters: {} },
      ctx,
    );
    expect(out.result.error?.category).toBe("not_found");
  });
});

describe("ensureToolError", () => {
  it("no-ops success", () => {
    const r = ensureToolError(createToolResponse(true, "hi"));
    expect(r.ok).toBe(true);
    expect(r.error).toBeUndefined();
  });
});

describe("createToolResponse(false) residual inventory (no unknown)", () => {
  /**
   * Static string messages in tool execute paths must classify to a real category.
   * Extracted at test time from source — if a new bare free-form fails → unknown, this fails.
   */
  it("every extractable createToolResponse(false, static-string) classifies non-unknown", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = dirname(fileURLToPath(import.meta.url));

    function walk(dir: string, acc: string[] = []): string[] {
      for (const e of readdirSync(dir)) {
        if (e === "node_modules" || e === "dist") continue;
        const p = join(dir, e);
        const s = statSync(p);
        if (s.isDirectory()) walk(p, acc);
        else if (e === "tool.ts" && !p.includes(".test.")) {
          acc.push(p);
        }
      }
      return acc;
    }
    const files = walk(root);
    const rx =
      /createToolResponse\(\s*false\s*,\s*(`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")/g;
    const unknowns: string[] = [];
    let total = 0;
    for (const f of files) {
      const t = readFileSync(f, "utf8");
      let m: RegExpExecArray | null;
      while ((m = rx.exec(t))) {
        const raw = m[1];
        let msg: string;
        try {
          // eslint-disable-next-line no-eval
          msg = eval(raw) as string;
        } catch {
          msg = raw.slice(1, -1).replace(/\$\{[^}]*\}/g, "X");
        }
        if (typeof msg !== "string" || !msg.trim()) continue;
        total++;
        const cat = classifyToolErrorMessage(msg);
        if (cat === "unknown") {
          unknowns.push(`${f.replace(root, "")}: ${msg.slice(0, 80)}`);
        }
        // also ensure createToolResponse attaches category
        const r = createToolResponse(false, msg);
        expect(r.error?.category).not.toBe("unknown");
      }
    }
    expect(total).toBeGreaterThan(20);
    expect(unknowns, `unknown classifications:\n${unknowns.join("\n")}`).toEqual(
      [],
    );
  });

  it("missing-args style residuals classify as invalid_args (not external)", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = dirname(fileURLToPath(import.meta.url));
    function walk(dir: string, acc: string[] = []): string[] {
      for (const e of readdirSync(dir)) {
        if (e === "node_modules" || e === "dist") continue;
        const p = join(dir, e);
        const s = statSync(p);
        if (s.isDirectory()) walk(p, acc);
        else if (e === "tool.ts" && !p.includes(".test.")) acc.push(p);
      }
      return acc;
    }
    const rx =
      /createToolResponse\(\s*false\s*,\s*(`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")/g;
    const missingArgsLike =
      /缺少必填|请提供|操作缺少|需要提供|必须提供|必须传|call requires|No query provided/i;
    const wrong: string[] = [];
    let checked = 0;
    for (const f of walk(root)) {
      const t = readFileSync(f, "utf8");
      let m: RegExpExecArray | null;
      while ((m = rx.exec(t))) {
        let msg: string;
        try {
          // eslint-disable-next-line no-eval
          msg = eval(m[1]) as string;
        } catch {
          msg = m[1].slice(1, -1).replace(/\$\{[^}]*\}/g, "X");
        }
        if (typeof msg !== "string" || !missingArgsLike.test(msg)) continue;
        checked++;
        const cat = classifyToolErrorMessage(msg);
        if (cat !== "invalid_args") {
          wrong.push(
            `${f.replace(root, "")}: got ${cat} for «${msg.slice(0, 90).replace(/\n/g, " ")}»`,
          );
        }
        const r = createToolResponse(false, msg);
        expect(r.error?.category).toBe("invalid_args");
      }
    }
    // also lock toolFail sites that embed example URLs (use_browser)
    const browserMsg =
      '❌ use_browser 缺少必填参数 action（操作类型）。正确用法示例：\n{"url": "https://example.com"}';
    expect(classifyToolErrorMessage(browserMsg)).toBe("invalid_args");
    expect(createToolResponse(false, browserMsg).error?.category).toBe(
      "invalid_args",
    );
    expect(checked).toBeGreaterThan(5);
    expect(wrong, `wrong category for missing-args residuals:\n${wrong.join("\n")}`).toEqual(
      [],
    );
  });
});
