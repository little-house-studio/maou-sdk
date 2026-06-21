/**
 * Browser 工具 — 浏览器自动化（基于 OpenCLI）
 *
 * ⚠️ 关键设计（不要随意修改）：
 * 1. open 返回 target ID（标签页标识），后续命令必须用 --tab <targetId> 指向该标签页
 *    否则 state/extract/screenshot 等操作会落在默认空标签页（about:blank）
 * 2. screenshot 无 path 时返回 base64，必须通过 ToolResponse.images 传给 LLM
 *    否则 AI 只能看到一堆 base64 文本，无法"看到"图片
 * 3. close 只释放 session tab lease，不关闭浏览器标签页
 * 4. state 使用 dom 源（ax 源不稳定，经常返回空）
 *
 * 操作铁律（Agent 必须遵守）：
 * 1. 先看再动 — state 或 find 获取数字引用，再 click/type
 * 2. 优先用数字引用 [N] — 通过指纹匹配，可承受轻度 DOM 漂移
 * 3. 每次写操作后检查 match_level — exact(放心) / stable(可用) / reidentified(需双重检查)
 * 4. type 后用 get value 验证 — React 受控组件会吞字符
 * 5. 导航/提交后重新 state — ref 在页面变化后失效
 * 6. 能用 network 就不截 DOM — API 比 DOM 截取更可靠
 * 7. 单次调用用 steps 数组串联 — 内部用 && 保持 ref 上下文
 */

import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import { Tool } from "../../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../../base.js";
import { createToolResponse } from "../../../base.js";

const execFileAsync = promisify(execFile);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ─── 常量 ────────────────────────────────────────────────────────────────────

const MSG_LIMIT = 8000;
const STEP_LIMIT = 3000;
const EXEC_TIMEOUT = 60_000;
const EXEC_BUFFER = 10 * 1024 * 1024;

// ─── OpenCLI Envelope 类型 ───────────────────────────────────────────────────

interface OpencliEnvelope {
  matches_n?: number;
  match_level?: "exact" | "stable" | "reidentified";
  clicked?: boolean;
  typed?: boolean;
  text?: string;
  autocomplete?: boolean;
  filled?: boolean;
  verified?: boolean;
  actual?: string;
  selected?: { label: string; value: string };
  value?: unknown;
  title?: string;
  url?: string;
  error?: { code: string; message: string; hint?: string; candidates?: string[]; available?: string[] };
  content?: string;
  total_chars?: number;
  next_start_char?: number | null;
  entries?: Array<{ key: string; method: string; status: number; url: string; ct: string; size: number; shape: string[] }>;
  tabs?: Array<{ index: number; page: string; url: string; title: string; active: boolean }>;
  page?: string;
  sessions?: Array<{ workspace: string; idleMsRemaining: number | null }>;
  compound?: Record<string, unknown>;
  compounds?: Record<string, Record<string, unknown>>;
  // open 返回的 target ID
  target?: string;
  targetId?: string;
}

// ─── SHORTCUTS ───────────────────────────────────────────────────────────────

type ShortcutFn = (args: Record<string, string>) => string[];

/** 给命令参数追加 --tab（如果指定了 tab） */
function withTab(args: string[], a: Record<string, string>): string[] {
  if (a.tab) args.push("--tab", a.tab);
  return args;
}

const SHORTCUTS: Record<string, ShortcutFn> = {
  // ── 导航 ──
  // open 返回 target ID，后续命令必须用 --tab <targetId> 指向该标签页
  open:       (a) => ["open", a.url || ""],
  state:      (a) => withTab(["state"], a),
  find:       (a) => {
    const args: string[] = ["find", "--css", a.target || "*"];
    if (a.limit) args.push("--limit", a.limit);
    if (a.text_max) args.push("--text-max", a.text_max);
    return withTab(args, a);
  },
  frames:     (a) => withTab(["frames"], a),
  screenshot: (a) => withTab(a.path ? ["screenshot", a.path] : ["screenshot"], a),

  // ── 读取 ──
  title:      (a) => withTab(["get", "title"], a),
  url:        (a) => withTab(["get", "url"], a),
  get:        (a) => {
    const args: string[] = ["get"];
    if (a.subtype) args.push(a.subtype);
    args.push(a.target || "");
    if (a.nth) args.push("--nth", a.nth);
    return withTab(args, a);
  },
  html:       (a) => {
    const args: string[] = ["get", "html", "--as", "json"];
    if (a.target) args.push("--selector", a.target);
    if (a.depth) args.push("--depth", a.depth);
    if (a.children_max) args.push("--children-max", a.children_max);
    if (a.text_max) args.push("--text-max", a.text_max);
    return withTab(args, a);
  },

  // ── 交互 ──
  click:      (a) => {
    const args: string[] = ["click", a.target || ""];
    if (a.nth) args.push("--nth", a.nth);
    return withTab(args, a);
  },
  type:       (a) => {
    const args: string[] = ["type", a.target || "", a.text || ""];
    if (a.nth) args.push("--nth", a.nth);
    return withTab(args, a);
  },
  fill:       (a) => {
    const args: string[] = ["fill", a.target || "", a.text || ""];
    if (a.nth) args.push("--nth", a.nth);
    return withTab(args, a);
  },
  select:     (a) => {
    const args: string[] = ["select", a.target || "", a.text || ""];
    if (a.nth) args.push("--nth", a.nth);
    return withTab(args, a);
  },
  keys:       (a) => withTab(["keys", a.text || ""], a),
  hover:      (a) => withTab(["hover", a.target || ""], a),
  check:      (a) => {
    const args: string[] = ["check", a.target || ""];
    if (a.nth) args.push("--nth", a.nth);
    return withTab(args, a);
  },
  uncheck:    (a) => {
    const args: string[] = ["uncheck", a.target || ""];
    if (a.nth) args.push("--nth", a.nth);
    return withTab(args, a);
  },
  scroll:     (a) => {
    const args: string[] = ["scroll", a.text || "down"];
    if (a.amount) args.push("--amount", a.amount);
    return withTab(args, a);
  },
  back:       (a) => withTab(["back"], a),

  // ── 等待 ──
  wait:       (a) => {
    const args: string[] = ["wait"];
    if (a.text) {
      args.push(a.wait_type === "selector" ? "selector" : "text", a.text);
    } else {
      args.push("time", a.amount || "3");
    }
    if (a.timeout) args.push("--timeout", a.timeout);
    return withTab(args, a);
  },

  // ── 提取 ──
  extract:    (a) => {
    const args: string[] = ["extract"];
    if (a.target) args.push("--selector", a.target);
    if (a.max_chars) args.push("--chunk-size", a.max_chars);
    if (a.start) args.push("--start", a.start);
    return withTab(args, a);
  },

  // ── 网络 ──
  network:    (a) => {
    const args: string[] = ["network"];
    if (a.detail) args.push("--detail", a.detail);
    if (a.filter) args.push("--filter", a.filter);
    if (a.raw) args.push("--raw");
    if (a.all) args.push("--all");
    if (a.ttl) args.push("--ttl", a.ttl);
    return withTab(args, a);
  },

  // ── JS 执行 ──
  eval:       (a) => {
    const args: string[] = ["eval", a.js || ""];
    if (a.frame) args.push("--frame", a.frame);
    return withTab(args, a);
  },

  // ── 标签页 ──
  "tab-list":   () => ["tab", "list"],
  "tab-new":    (a) => ["tab", "new", ...(a.url ? [a.url] : [])],
  "tab-select": (a) => ["tab", "select", a.target || ""],
  "tab-close":  (a) => ["tab", "close", a.target || ""],

  // ── 会话 ──
  bind:       (a) => {
    const args: string[] = ["bind"];
    if (a.workspace) args.push("--workspace", a.workspace);
    if (a.domain) args.push("--domain", a.domain);
    if (a.path_prefix) args.push("--path-prefix", a.path_prefix);
    return args;
  },
  unbind:     (a) => a.workspace ? ["unbind", "--workspace", a.workspace] : ["unbind"],
  close:      () => ["close"],

  // ── 高级 ──
  help:       () => ["--help"],
};

// ─── Multi-step 类型 ─────────────────────────────────────────────────────────

interface MultiStep {
  session?: string;
  action: string;
  target?: string;
  text?: string;
  js?: string;
  url?: string;
  tab?: string;
  subtype?: string;
  nth?: string;
  amount?: string;
  timeout?: string;
  wait_type?: string;
  poll_interval?: string;
  continue_on_error?: boolean;
  // watch 专用
  watch_target?: string;
  watch_type?: "change" | "text" | "selector" | "value";
  extract_js?: string;
}

interface MultiResult {
  step: number;
  session: string;
  action: string;
  success: boolean;
  message: string;
  data?: unknown;
}

// ─── 解析 OpenCLI JSON 输出 ──────────────────────────────────────────────────

function parseOpencliOutput(stdout: string): { envelope: OpencliEnvelope | null; rawText: string } {
  const trimmed = stdout.trim();
  if (!trimmed) return { envelope: null, rawText: "" };

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { envelope: parsed as OpencliEnvelope, rawText: trimmed };
    }
    if (Array.isArray(parsed)) {
      return { envelope: { entries: parsed }, rawText: trimmed };
    }
  } catch { /* 不是 JSON */ }

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && typeof parsed === "object") {
        return { envelope: parsed as OpencliEnvelope, rawText: trimmed };
      }
    } catch { /* 放弃 */ }
  }

  return { envelope: null, rawText: trimmed };
}

function formatEnvelope(env: OpencliEnvelope): string {
  const parts: string[] = [];

  if (env.error) {
    parts.push(`[错误] ${env.error.code}: ${env.error.message}`);
    if (env.error.hint) parts.push(`  提示: ${env.error.hint}`);
    if (env.error.candidates?.length) parts.push(`  候选: ${env.error.candidates.join(", ")}`);
    if (env.error.available?.length) parts.push(`  可用: ${env.error.available.join(", ")}`);
    return parts.join("\n");
  }

  // open 返回的 page 字段是标签页 ID — 高亮提示 AI 后续命令需要用 --tab
  if (env.page && !env.tabs && !env.clicked && !env.typed) {
    parts.push(`✅ 页面已打开，标签页 ID: ${env.page}`);
    parts.push(`⚠️ 后续命令（state/extract/screenshot/click 等）请传 tab="${env.page}" 以操作此标签页`);
  }

  if (env.matches_n !== undefined) {
    const level = env.match_level ? ` (${env.match_level})` : "";
    parts.push(`匹配: ${env.matches_n} 个${level}`);
  }

  if (env.clicked) parts.push("点击成功");
  if (env.typed) {
    parts.push(`输入成功: "${env.text}"`);
    if (env.autocomplete) parts.push("注意: 检测到自动补全弹窗，需要 keys Enter 或 click 建议项来确认");
  }
  if (env.filled) {
    parts.push(`填充成功${env.verified ? " (已验证)" : ""}`);
    if (env.actual !== undefined) parts.push(`实际值: "${env.actual}"`);
  }
  if (env.selected) parts.push(`已选择: ${env.selected.label} (${env.selected.value})`);

  if (env.title) parts.push(`标题: ${env.title}`);
  if (env.url) parts.push(`URL: ${env.url}`);
  if (env.value !== undefined && typeof env.value === "string") parts.push(`值: ${env.value}`);
  if (env.value !== undefined && typeof env.value === "object") {
    parts.push(`值: ${JSON.stringify(env.value)}`);
  }

  if (env.total_chars !== undefined) {
    parts.push(`总字符: ${env.total_chars}, 当前分块: ${env.content?.length || 0} 字符`);
    if (env.next_start_char !== null) parts.push(`下一分块起始: ${env.next_start_char}`);
  }

  if (env.entries && Array.isArray(env.entries) && env.entries.length > 0) {
    if (env.entries[0] && typeof env.entries[0].key === "string") {
      const list = env.entries.slice(0, 10).map((e: Record<string, unknown>) =>
        `  ${e.key} ${e.method} ${e.status} ${e.url} (${e.ct}, ${e.size}B)`
      ).join("\n");
      parts.push(`网络请求 (${env.entries.length}):\n${list}`);
      if (env.entries.length > 10) parts.push(`  ... 还有 ${env.entries.length - 10} 条`);
    }
  }

  if (env.tabs) {
    const list = env.tabs.map((t: Record<string, unknown>) =>
      `  [${t.index}] ${t.page} ${t.active ? "◉" : "○"} ${t.title} (${t.url})`
    ).join("\n");
    parts.push(`标签页:\n${list}`);
  }
  // tab-list 返回的 entries 数组（含 page/url/title/active 字段）也按标签页显示
  if (env.entries && Array.isArray(env.entries) && env.entries.length > 0 && (env.entries[0] as Record<string, unknown>)?.page) {
    const list = env.entries.map((t) => {
      const tr = t as Record<string, unknown>;
      return `  [${tr.index}] ${tr.page} ${tr.active ? "◉" : "○"} ${tr.title} (${tr.url})`;
    }).join("\n");
    parts.push(`标签页:\n${list}`);
  }
  if (env.page && !parts.some(p => p.includes("标签页 ID"))) parts.push(`标签页: ${env.page}`);

  if (env.sessions) {
    const list = env.sessions.map((s: Record<string, unknown>) =>
      `  ${s.workspace} ${s.idleMsRemaining !== null ? `${s.idleMsRemaining}ms 剩余` : "无超时"}`
    ).join("\n");
    parts.push(`会话:\n${list}`);
  }

  if (env.compound) {
    parts.push(`控件信息: ${JSON.stringify(env.compound)}`);
  }

  // extract 的 content（放最后，可能很长）
  if (env.content && !env.total_chars) {
    parts.push(env.content);
  }

  return parts.length > 0 ? parts.join("\n") : "操作完成";
}

// ─── 工具类 ──────────────────────────────────────────────────────────────────

export class BrowserTool extends Tool {
  readonly definition: ToolDefinition = {
    name: "use_browser",
    aliases: ["browser-verify", "browser-check", "browser_verify", "web-verify", "read-page"],
    description:
      "控制真实浏览器（基于 OpenCLI），复用已登录 Chrome 会话。\n\n" +
      "【关键：tab 参数】\n" +
      "open 命令会返回标签页 ID（targetId）。后续所有命令（state/extract/screenshot/click 等）\n" +
      "必须传 tab 参数指向该标签页，否则操作会落在默认空标签页！\n\n" +
      "【操作流程】\n" +
      "1. open url='https://...' → 返回 targetId\n" +
      "2. state tab='<targetId>' → 获取页面元素 [N]\n" +
      "3. click/type/fill target='[N]' tab='<targetId>'\n" +
      "4. 页面变化后重新 state tab='<targetId>'\n\n" +
      "【常用操作】\n" +
      "  检查：state, find, screenshot, frames\n" +
      "  读取：get (text/value/attributes), title, url, html\n" +
      "  交互：click, type, fill, select, keys, hover, scroll, check, uncheck, back\n" +
      "  等待：wait (selector/text/time)\n" +
      "  提取：extract (长文分块), network (API 优先)\n" +
      "  标签：tab-list, tab-new, tab-select, tab-close\n" +
      "  会话：bind (绑定已登录标签), unbind, close\n" +
      "  批量：steps 数组串联多步操作\n" +
      "  跨工作区：multi 支持不同 session 的步骤序列\n" +
      "  监听：watch 后端轮询监听 DOM 变化",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description:
            "操作类型：open|state|find|screenshot|frames|" +
            "get|title|url|html|" +
            "click|type|fill|select|keys|hover|scroll|check|uncheck|back|" +
            "wait|extract|network|eval|" +
            "tab-list|tab-new|tab-select|tab-close|" +
            "bind|unbind|close|help|" +
            "batch|multi|watch",
        },
        tab: {
          type: "string",
          description: "标签页 ID（open 返回的 targetId）。state/extract/screenshot/click 等命令必须传此参数！",
        },
        target: { type: "string", description: "数字引用 [N] 或 CSS 选择器" },
        text: { type: "string", description: "文本内容（type/fill/select/keys/scroll/wait 用）" },
        url: { type: "string", description: "URL（open/tab-new 用）" },
        js: { type: "string", description: "只读 JavaScript（eval 用）" },
        session: { type: "string", description: "浏览器会话名称（默认 default）" },
        subtype: { type: "string", description: "get 子类型", enum: ["text", "value", "attributes", "html"] },
        nth: { type: "string", description: "CSS 多匹配时的索引" },
        limit: { type: "string", description: "find 限制条数" },
        text_max: { type: "string", description: "find/extract/html 文本截断长度" },
        depth: { type: "string", description: "html JSON 树深度" },
        children_max: { type: "string", description: "html 子节点限制" },
        amount: { type: "string", description: "scroll 滚动量(px) / wait 等待秒数" },
        timeout: { type: "string", description: "wait 超时时间(ms)" },
        wait_type: { type: "string", description: "wait 类型：selector/text/time（默认 text）", enum: ["selector", "text", "time"] },
        max_chars: { type: "string", description: "extract 分块大小（默认 20000）" },
        start: { type: "string", description: "extract 起始字符（用于分块续读）" },
        path: { type: "string", description: "screenshot 保存路径（不填则返回 base64 图片）" },
        frame: { type: "string", description: "eval 跨域 iframe 索引" },
        detail: { type: "string", description: "network 获取单条请求详情" },
        filter: { type: "string", description: "network 按字段过滤" },
        raw: { type: "boolean", description: "network 返回完整 body" },
        all: { type: "boolean", description: "network 包含静态资源" },
        ttl: { type: "string", description: "network 缓存 TTL(ms)" },
        workspace: { type: "string", description: "bind/unbind 工作区名称" },
        domain: { type: "string", description: "bind 域名过滤" },
        path_prefix: { type: "string", description: "bind 路径前缀过滤" },
        steps: {
          type: "array",
          description: "批量操作步骤（batch/multi 用）。multi 支持跨 session 和 watch",
          items: {
            type: "object",
            properties: {
              session: { type: "string", description: "浏览器会话名称（multi 用）" },
              action: { type: "string" },
              target: { type: "string" },
              text: { type: "string" },
              js: { type: "string" },
              url: { type: "string" },
              tab: { type: "string" },
              subtype: { type: "string" },
              nth: { type: "string" },
              amount: { type: "string" },
              timeout: { type: "string" },
              wait_type: { type: "string" },
              continue_on_error: { type: "boolean", description: "失败时是否继续" },
              watch_target: { type: "string", description: "watch 监听的 CSS 选择器" },
              watch_type: { type: "string", enum: ["change", "text", "selector", "value"], description: "watch 监听类型" },
              poll_interval: { type: "string", description: "watch 轮询间隔(ms)" },
              extract_js: { type: "string", description: "watch 自定义提取 JS" },
            },
            required: ["action"],
          },
        },
        watch_type: { type: "string", description: "watch 监听类型：change/text/selector/value", enum: ["change", "text", "selector", "value"] },
        watch_target: { type: "string", description: "watch 监听的 CSS 选择器" },
        poll_interval: { type: "string", description: "watch 轮询间隔(ms，默认 2000)" },
        extract_js: { type: "string", description: "watch 自定义提取内容的 JS 表达式" },
        reason: { type: "string", description: "为什么必须调用此工具" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    allowedModes: ["execute"],
    paramGuards: {
      "type": "true", "fill": "true", "keys": "true", "select": "true",
      "click": "true", "eval": "true",
    },
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const action = String(params.action ?? "").trim().toLowerCase();
    if (!action) return createToolResponse(false, "缺少 action 参数。action='help' 查看所有可用操作。");

    const session = String(params.session ?? "default").trim();

    if (action === "help") {
      return this.runOpencli(["--help"], session, ctx, action);
    }

    if (action === "batch") {
      return this.executeBatch(params, session, ctx);
    }

    if (action === "multi") {
      return this.executeMulti(params, ctx);
    }

    if (action === "watch") {
      return this.executeWatch(params, session, ctx);
    }

    if (action === "run") {
      const command = String(params.command ?? "").trim();
      if (!command) return createToolResponse(false, "run 需要 command 参数");
      return this.runOpencli(command.split(/\s+/), session, ctx, action);
    }

    const shortcut = SHORTCUTS[action];
    if (!shortcut) {
      return createToolResponse(false,
        `未知操作: ${action}。action='help' 查看所有可用操作。\n` +
        `提示: open 打开网页后用 state 查看，用 tab 参数指定标签页。`
      );
    }

    const shortcutArgs: Record<string, string> = {
      url: String(params.url ?? ""),
      target: String(params.target ?? ""),
      text: String(params.text ?? ""),
      js: String(params.js ?? ""),
      tab: String(params.tab ?? ""),
      subtype: String(params.subtype ?? ""),
      nth: String(params.nth ?? ""),
      limit: String(params.limit ?? ""),
      text_max: String(params.text_max ?? ""),
      depth: String(params.depth ?? ""),
      children_max: String(params.children_max ?? ""),
      amount: String(params.amount ?? ""),
      timeout: String(params.timeout ?? ""),
      max_chars: String(params.max_chars ?? ""),
      start: String(params.start ?? ""),
      path: String(params.path ?? ""),
      frame: String(params.frame ?? ""),
      detail: String(params.detail ?? ""),
      filter: String(params.filter ?? ""),
      raw: params.raw ? "--raw" : "",
      all: params.all ? "--all" : "",
      ttl: String(params.ttl ?? ""),
      workspace: String(params.workspace ?? ""),
      domain: String(params.domain ?? ""),
      path_prefix: String(params.path_prefix ?? ""),
      type: String(params.type ?? ""),
      wait_type: String(params.wait_type ?? ""),
    };

    const args = shortcut(shortcutArgs);
    return this.runOpencli(args, session, ctx, action);
  }

  // ── 批量执行 ──────────────────────────────────────────────────────────────

  private async executeBatch(
    params: Record<string, unknown>,
    session: string,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const steps = params.steps as Array<Record<string, string>> | undefined;
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return createToolResponse(false, "batch 需要 steps 数组");
    }

    const commands: string[] = [];
    for (const step of steps) {
      const stepAction = String(step.action ?? "").trim();
      const shortcut = SHORTCUTS[stepAction];
      if (!shortcut) {
        commands.push(`echo "[${stepAction}] [跳过] 未知操作"`);
        continue;
      }
      // 支持每个步骤指定不同的 session
      const stepSession = step.session || session;
      const args = shortcut({
        url: step.url || "",
        target: step.target || "",
        text: step.text || "",
        js: step.js || "",
        tab: step.tab || "",
        subtype: String(step.subtype ?? ""),
        nth: String(step.nth ?? ""),
        amount: String(step.amount ?? ""),
        timeout: String(step.timeout ?? ""),
      });
      const cmd = ["opencli", "browser", stepSession, ...args].join(" ");
      commands.push(`echo "--- ${stepAction} [${stepSession}] ---" && ${cmd}`);
    }

    const chainedCmd = commands.join(" && ");

    return new Promise((resolve) => {
      exec(chainedCmd, {
        cwd: ctx.projectRoot,
        timeout: EXEC_TIMEOUT * Math.max(1, steps.length),
        maxBuffer: EXEC_BUFFER,
        encoding: "utf-8",
      }, (error, stdout, stderr) => {
        const exitCode = error ? (error.code ?? 1) : 0;
        const rawOutput = (stdout?.trim() || stderr?.trim() || "");
        const truncated = truncate(rawOutput, MSG_LIMIT);
        const meta = `[batch ${steps.length} 步, 退出码: ${exitCode}, 输出: ${rawOutput.length} 字符${truncated !== rawOutput ? " (已截断)" : ""}]`;
        resolve(
          createToolResponse(exitCode === 0, `${truncated}\n\n${meta}`, {
            payload: { exit_code: exitCode, step_count: steps.length },
          }),
        );
      });
    });
  }

  // ── 跨工作区批量执行 ──────────────────────────────────────────────────────

  private async executeMulti(
    params: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const steps = params.steps as MultiStep[] | undefined;
    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return createToolResponse(false, "multi 需要 steps 数组");
    }

    const results: MultiResult[] = [];
    const contextData: Record<string, string> = {}; // 存储中间结果

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepSession = step.session || "default";
      const stepAction = step.action;

      // 处理 watch 命令
      if (stepAction === "watch") {
        try {
          const watchResult = await this.executeWatch({
            action: "watch",
            session: stepSession,
            tab: step.tab,
            target: step.watch_target || step.target,
            watch_type: step.watch_type || "change",
            timeout: step.timeout || "60000",
            poll_interval: step.poll_interval || "2000",
            extract_js: step.extract_js,
          }, stepSession, ctx);

          results.push({
            step: i + 1,
            session: stepSession,
            action: stepAction,
            success: watchResult.ok,
            message: truncate(watchResult.message, 500),
            data: watchResult.payload,
          });

          // 如果 watch 有提取的数据，存入上下文
          if (watchResult.payload?.extracted) {
            contextData[`step${i + 1}`] = String(watchResult.payload.extracted);
          }
        } catch (err) {
          results.push({
            step: i + 1,
            session: stepSession,
            action: stepAction,
            success: false,
            message: `watch 错误: ${err}`,
          });
          if (!step.continue_on_error) break;
        }
        continue;
      }

      // 处理普通命令
      const shortcut = SHORTCUTS[stepAction];
      if (!shortcut) {
        results.push({
          step: i + 1,
          session: stepSession,
          action: stepAction,
          success: false,
          message: `未知操作: ${stepAction}`,
        });
        if (!step.continue_on_error) break;
        continue;
      }

      // 替换模板变量 {{stepN}}
      let resolvedText = step.text || "";
      for (const [key, value] of Object.entries(contextData)) {
        resolvedText = resolvedText.replace(`{{${key}}}`, value);
      }

      const args = shortcut({
        url: step.url || "",
        target: step.target || "",
        text: resolvedText,
        js: step.js || "",
        tab: step.tab || "",
        subtype: String(step.subtype ?? ""),
        nth: String(step.nth ?? ""),
        amount: String(step.amount ?? ""),
        timeout: String(step.timeout ?? ""),
        wait_type: step.wait_type || "",
      });

      try {
        const result = await this.runOpencliAsync(args, stepSession, ctx, stepAction);
        results.push({
          step: i + 1,
          session: stepSession,
          action: stepAction,
          success: result.success,
          message: truncate(result.message, 500),
          data: result.payload,
        });

        // 如果是 eval 命令且有返回值，存入上下文
        if (stepAction === "eval" && result.payload?.envelope && typeof result.payload.envelope === 'object') {
          const env = result.payload.envelope as Record<string, unknown>;
          if (env.value !== undefined) {
            contextData[`step${i + 1}`] = String(env.value);
          }
        }

        if (!result.success && !step.continue_on_error) break;
      } catch (err) {
        results.push({
          step: i + 1,
          session: stepSession,
          action: stepAction,
          success: false,
          message: `执行错误: ${err}`,
        });
        if (!step.continue_on_error) break;
      }
    }

    const successCount = results.filter(r => r.success).length;
    const summary = `完成 ${successCount}/${results.length} 步`;
    const details = results.map(r =>
      `[${r.step}] ${r.session}/${r.action}: ${r.success ? '✅' : '❌'} ${r.message}`
    ).join('\n');

    return createToolResponse(
      successCount === results.length,
      `${summary}\n\n${details}`,
      { payload: { results, successCount, totalCount: results.length, contextData } }
    );
  }

  // ── 监听变化（后端轮询） ──────────────────────────────────────────────────

  private async executeWatch(
    params: Record<string, unknown>,
    session: string,
    ctx: ToolContext,
  ): Promise<ToolResponse> {
    const tab = String(params.tab ?? "");
    const watchType = String(params.watch_type ?? "change");
    const target = String(params.watch_target ?? params.target ?? "body");
    const timeout = parseInt(String(params.timeout ?? "60000"));
    const pollInterval = parseInt(String(params.poll_interval ?? "2000"));
    const extractJs = String(params.extract_js ?? "");

    const startTime = Date.now();
    let lastContent = "";
    let pollCount = 0;

    // 首先获取初始内容
    try {
      const initialState = await this.getStateContent(session, tab, target, watchType, extractJs, ctx);
      lastContent = initialState;
      
      // 对于 selector/text 类型，如果一开始就匹配，立即返回
      if (watchType === "selector" && lastContent === "found") {
        return createToolResponse(true,
          `✅ 检测到元素 "${target}" (0ms, 初始状态已存在)`,
          { payload: { matched: true, target, extracted: lastContent } }
        );
      }
      if (watchType === "text" && target && lastContent.includes(target)) {
        return createToolResponse(true,
          `✅ 检测到文本 "${target}" (0ms, 初始状态已包含)`,
          { payload: { matched: true, text: target, extracted: lastContent } }
        );
      }
    } catch {
      // 初始状态获取失败，继续尝试
    }

    while (Date.now() - startTime < timeout) {
      await sleep(pollInterval);
      pollCount++;

      try {
        const currentContent = await this.getStateContent(session, tab, target, watchType, extractJs, ctx);

        // 对于 text/selector 类型，检查是否匹配
        if (watchType === "selector" && currentContent === "found") {
          return createToolResponse(true,
            `✅ 检测到元素 "${target}" (${Date.now() - startTime}ms, ${pollCount} 次轮询)`,
            { payload: { matched: true, target, extracted: currentContent } }
          );
        }
        
        if (watchType === "text" && target && currentContent.includes(target)) {
          return createToolResponse(true,
            `✅ 检测到文本 "${target}" (${Date.now() - startTime}ms, ${pollCount} 次轮询)`,
            { payload: { matched: true, text: target, extracted: currentContent } }
          );
        }

        // 对于 change 类型，检查内容是否变化
        if (watchType === "change" && lastContent && currentContent !== lastContent) {
          const duration = Date.now() - startTime;
          return createToolResponse(true,
            `✅ 检测到变化 (${duration}ms, ${pollCount} 次轮询)\n\n` +
            `【变化前】\n${truncate(lastContent, 500)}\n\n` +
            `【变化后】\n${truncate(currentContent, 500)}`,
            {
              payload: {
                changed: true,
                duration,
                pollCount,
                previous: lastContent,
                current: currentContent,
                extracted: currentContent,
              }
            }
          );
        }

        // 对于 value 类型，检查值是否非空
        if (watchType === "value" && currentContent && currentContent !== "undefined") {
          return createToolResponse(true,
            `✅ 检测到值 "${currentContent}" (${Date.now() - startTime}ms, ${pollCount} 次轮询)`,
            { payload: { matched: true, value: currentContent, extracted: currentContent } }
          );
        }

        lastContent = currentContent;
      } catch (err) {
        // 轮询出错，继续尝试
      }
    }

    // 超时
    return createToolResponse(false,
      `⏱️ 超时 (${timeout}ms, ${pollCount} 次轮询)\n\n最后内容:\n${truncate(lastContent, 1000)}`,
      { payload: { changed: false, timeout: true, pollCount, lastContent } }
    );
  }

  // ── 获取区域内容（用于 watch） ──────────────────────────────────────────────

  private async getStateContent(
    session: string,
    tab: string,
    target: string,
    watchType: string,
    extractJs: string,
    ctx: ToolContext,
  ): Promise<string> {
    // 辅助函数：从结果中提取 value
    const extractValue = (result: { success: boolean; message: string; payload?: Record<string, unknown> }): string => {
      // 如果命令执行失败，抛出异常
      if (!result.success) {
        throw new Error(`命令执行失败: ${result.message}`);
      }
      
      const envelope = result.payload?.envelope as OpencliEnvelope | undefined;
      const rawText = result.payload?.rawText as string | undefined;
      
      // 优先从 envelope.value 获取
      if (envelope?.value !== undefined && envelope?.value !== null) {
        return String(envelope.value);
      }
      // 尝试从 envelope.content 获取
      if (envelope?.content) {
        return envelope.content;
      }
      // 使用原始文本（如果是 eval 返回的纯文本）
      if (rawText && !rawText.includes("操作完成") && !rawText.includes("退出码")) {
        return rawText;
      }
      return "";
    };

    // 如果有自定义提取 JS，使用 eval
    if (extractJs) {
      const result = await this.runOpencliAsync(
        ["eval", extractJs, ...(tab ? ["--tab", tab] : [])],
        session, ctx, "eval"
      );
      return extractValue(result);
    }

    // 根据 watchType 选择不同的获取方式
    switch (watchType) {
      case "change":
      case "text": {
        // 获取页面文本内容（用于检测文本变化或搜索特定文本）
        const js = "document.body.innerText.substring(0, 5000)";
        const result = await this.runOpencliAsync(
          ["eval", js, ...(tab ? ["--tab", tab] : [])],
          session, ctx, "eval"
        );
        return extractValue(result);
      }

      case "value": {
        const js = `document.querySelector('${target}')?.value || ''`;
        const result = await this.runOpencliAsync(
          ["eval", js, ...(tab ? ["--tab", tab] : [])],
          session, ctx, "eval"
        );
        return extractValue(result);
      }

      case "selector": {
        const js = `document.querySelector('${target}') ? 'found' : 'not_found'`;
        const result = await this.runOpencliAsync(
          ["eval", js, ...(tab ? ["--tab", tab] : [])],
          session, ctx, "eval"
        );
        return extractValue(result);
      }

      default:
        throw new Error(`未知 watchType: ${watchType}`);
    }
  }

  // ── 异步执行 OpenCLI 命令 ──────────────────────────────────────────────────

  private async runOpencliAsync(
    args: string[],
    session: string,
    ctx: ToolContext,
    action: string,
  ): Promise<{ success: boolean; message: string; payload?: Record<string, unknown> }> {
    const fullArgs = ["browser", session, ...args];

    try {
      const { stdout, stderr } = await execFileAsync("opencli", fullArgs, {
        cwd: ctx.projectRoot,
        timeout: EXEC_TIMEOUT,
        maxBuffer: EXEC_BUFFER,
        encoding: "utf-8",
      });

      const stdoutStr = stdout?.trim() ?? "";
      const stderrStr = stderr?.trim() ?? "";
      const { envelope, rawText } = parseOpencliOutput(stdoutStr || stderrStr);

      let message: string;
      if (envelope) {
        message = truncate(formatEnvelope(envelope), MSG_LIMIT);
      } else {
        message = truncate(rawText || "操作完成", MSG_LIMIT);
      }

      return {
        success: true,
        message,
        payload: { envelope, raw_stdout: stdoutStr, raw_stderr: stderrStr, rawText },
      };
    } catch (error: unknown) {
      const err = error as { code?: number; stdout?: string; stderr?: string };
      const stdoutStr = err.stdout?.trim() ?? "";
      const stderrStr = err.stderr?.trim() ?? "";
      const { envelope, rawText } = parseOpencliOutput(stdoutStr || stderrStr);

      let message: string;
      if (envelope) {
        message = truncate(formatEnvelope(envelope), MSG_LIMIT);
      } else {
        message = truncate(rawText || `操作失败，退出码: ${err.code}`, MSG_LIMIT);
      }

      return {
        success: false,
        message,
        payload: { exit_code: err.code, envelope, raw_stdout: stdoutStr, raw_stderr: stderrStr, rawText },
      };
    }
  }

  // ── 单个 OpenCLI 调用 ──────────────────────────────────────────────────────

  private runOpencli(
    args: string[],
    session: string,
    ctx: ToolContext,
    action: string,
  ): Promise<ToolResponse> {
    return new Promise((resolve) => {
      const fullArgs = ["browser", session, ...args];

      execFile("opencli", fullArgs, {
        cwd: ctx.projectRoot,
        timeout: EXEC_TIMEOUT,
        maxBuffer: EXEC_BUFFER,
        encoding: "utf-8",
      }, (error, stdout, stderr) => {
        const exitCode = error ? (error.code ?? 1) : 0;
        const stdoutStr = stdout?.trim() ?? "";
        const stderrStr = stderr?.trim() ?? "";

        const { envelope, rawText } = parseOpencliOutput(stdoutStr || stderrStr);

        // ⚠️ screenshot 特殊处理：无 path 时返回 base64，通过 images 传给 LLM
        if (action === "screenshot" && !args.some(a => a.startsWith("/") || a.startsWith("."))) {
          // stdout 可能是纯 base64 或包含 base64 的 JSON
          let base64Data = "";
          if (envelope && typeof (envelope as Record<string, unknown>).image === "string") {
            base64Data = (envelope as Record<string, unknown>).image as string;
          } else if (stdoutStr && !stdoutStr.startsWith("{")) {
            // 纯 base64 输出
            base64Data = stdoutStr.replace(/\s/g, "");
          }

          if (base64Data && base64Data.length > 100) {
            const formatted = envelope ? formatEnvelope(envelope) : "截图完成";
            resolve(createToolResponse(true, `${formatted}\n\n[screenshot 退出码: ${exitCode}]`, {
              images: [{ mimeType: "image/png", data: base64Data }],
              payload: { exit_code: exitCode, envelope },
            }));
            return;
          }
        }

        let message: string;
        if (envelope) {
          const formatted = formatEnvelope(envelope);
          message = truncate(formatted, MSG_LIMIT);
          if (message !== formatted) {
            message += `\n(输出已截断，原始 ${rawText.length} 字符)`;
          }
        } else {
          const raw = rawText || (exitCode === 0 ? "操作完成（无输出）" : `操作失败，退出码: ${exitCode}`);
          message = truncate(raw, MSG_LIMIT);
          if (message !== raw) {
            message += `\n(输出已截断，原始 ${raw.length} 字符)`;
          }
        }

        message += `\n\n[${args[0]} 退出码: ${exitCode}]`;

        resolve(
          createToolResponse(exitCode === 0, message, {
            payload: { exit_code: exitCode, envelope, raw_stdout: stdoutStr, raw_stderr: stderrStr },
          }),
        );
      });
    });
  }
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `\n\n...(截断: 原始 ${text.length} 字符)`;
}
