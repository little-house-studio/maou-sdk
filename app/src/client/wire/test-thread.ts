/**
 * Wire 单测用的最小对话样例（thread / markdown / context / tool-card）。
 */
import type { DraftApproval, DraftMessage, DraftSession } from "./types";

export const SAMPLE_APPROVAL: DraftApproval = {
  id: "appr-1",
  summary: "Agent 请求执行可能危险的终端命令",
  command: "rm -rf ./dist && npm run build",
  risk: "high",
  agentName: "coding",
};

const A1_BODY = [
  "好的。先把模块拆开，再用假数据把布局跑通。",
  "",
  "无序列表：",
  "",
  "- 侧栏：agent / 会话",
  "- 中栏：上下文 + 悬浮 Tasks / Composer",
  "- 底栏：终端 · 待办 · 日志",
  "",
  "有序列表：",
  "",
  "1. 扫路由注册",
  "2. 对照 attach 参数",
  "3. 汇总类型错误",
  "",
  "行内：**粗体**、*斜体*、`inline code`、[链接占位](https://example.com)",
  "",
  "```ts",
  "export type DraftMessage = {",
  "  id: string;",
  "  role: MessageRole;",
  "  body: string;",
  "};",
  "```",
].join("\n");

const RAW: DraftMessage[] = [
  { id: "fc-sys-open", role: "system", body: "沙箱=ask · 模型=gpt-5" },
  { id: "fc-u1", role: "user", body: "帮我做一个布局草稿。" },
  { id: "fc-a1", role: "assistant", body: A1_BODY },
  {
    id: "fc-th1",
    role: "thinking",
    body: "计划：扫路由 → 列工具调用",
    thinking: { durationMs: 640, collapsed: true },
    meta: { durationMs: 640 },
  },
  {
    id: "fc-tool-term",
    role: "tool",
    tag: "use_terminal",
    body: 'src/server/create-server.ts:412:  app.ws("/ws/agent-terminal"…',
    clickable: true,
    tool: {
      name: "use_terminal",
      description: "rg agent-terminal in server",
      args: JSON.stringify({
        description: "rg agent-terminal in server",
        command: 'rg -n "agent-terminal" src/server',
        terminal_id: "term-9",
      }),
      result:
        'src/server/create-server.ts:412:  app.ws("/ws/agent-terminal"…\nsrc/server/agent-terminals.ts:88: export function attach…',
      done: true,
      durationMs: 420,
    },
  },
  {
    id: "fc-tool-run",
    role: "tool",
    tag: "run_terminal",
    body: "exit 2",
    clickable: true,
    tool: {
      name: "run_terminal",
      description: "tsc client --noEmit",
      args: JSON.stringify({
        description: "tsc client --noEmit",
        command: "npx tsc -p tsconfig.client.json --noEmit",
      }),
      result: "$ npx tsc -p tsconfig.client.json --noEmit\nexit 2",
      done: true,
      isError: true,
      durationMs: 2100,
    },
  },
  {
    id: "fc-err1",
    role: "err",
    body: "类型错误：类型「DraftMeta」上不存在属性「pendingApproval」。",
  },
  {
    id: "fc-a4-clean",
    role: "assistant",
    body: "干净助手气泡。",
  },
  {
    id: "fc-sys-mid",
    role: "system",
    body: "孤儿 tool / err 组",
  },
  {
    id: "fc-orphan-tool",
    role: "tool",
    tag: "search_code",
    body: "matches: 12",
    clickable: true,
    tool: {
      name: "search_code",
      description: "query: wire-shell",
      args: JSON.stringify({
        description: "query: wire-shell",
        query: "wire-shell",
      }),
      result: "matches: 12",
      done: true,
      durationMs: 55,
    },
  },
  {
    id: "fc-orphan-th",
    role: "thinking",
    body: "孤儿组内 thinking",
    thinking: { durationMs: 120, collapsed: true },
  },
  {
    id: "fc-orphan-err",
    role: "err",
    body: "host 离线。",
  },
  {
    id: "fc-a5",
    role: "assistant",
    body: "收尾说明。",
  },
];

function stamp(msgs: DraftMessage[]): DraftMessage[] {
  const base = Date.UTC(2026, 6, 31, 6, 30, 0);
  let t = base;
  let round = 0;
  return msgs.map((m, i) => {
    t += 12_000 + (i % 4) * 2500;
    if (m.role === "user") {
      return {
        ...m,
        meta: {
          ts: t,
          authorLabel: "user",
          usageInput: 180 + i * 55,
          kind: "human_user",
          ...m.meta,
        },
      };
    }
    if (m.role === "assistant") {
      round += 1;
      const streaming = m.id === "fc-a5";
      return {
        ...m,
        meta: {
          ts: t,
          authorLabel: "agent:coding",
          round,
          durationMs: streaming ? undefined : 640 + i * 90,
          usageOutput: streaming ? undefined : 36 + i * 14,
          streaming,
          ...m.meta,
        },
      };
    }
    return { ...m, meta: { ts: t, ...m.meta } };
  });
}

export const THREAD_MESSAGES: DraftMessage[] = stamp(RAW);

/** Clone with id prefix so session-scoped tests keep unique ids. */
export function threadMessages(prefix: string): DraftMessage[] {
  return THREAD_MESSAGES.map((m) => ({
    ...m,
    id: `${prefix}-${m.id}`,
    tool: m.tool ? { ...m.tool } : undefined,
    meta: m.meta ? { ...m.meta } : undefined,
    thinking: m.thinking ? { ...m.thinking } : undefined,
  }));
}

export const SAMPLE_SESSIONS: DraftSession[] = [
  {
    id: "s-1",
    title: "搭建对话工作台外壳",
    agent: "coding",
    timeLabel: "2 分钟前",
  },
  {
    id: "s-1::fork::a",
    title: "调研 JS NPC 方法全貌",
    agent: "coding",
    timeLabel: "1 分钟前",
    parentSessionId: "s-1",
  },
];
