/**
 * Centralized draft fixtures + pure helpers.
 * Panels must not invent scenario data — load via these APIs.
 */
import type {
  DraftAgent,
  DraftApproval,
  DraftBgTask,
  DraftMessage,
  DraftMeta,
  DraftScenario,
  DraftSession,
  ScenarioId,
} from "./types";

/** Required catalog entries for layout QA (tests assert completeness). */
export const REQUIRED_SCENARIO_IDS: readonly ScenarioId[] = [
  "normal",
  "empty_thread",
  "busy",
  "pending_approval",
  "mixed_roles",
  "long_overflow",
  "empty_sessions",
] as const;

const BASE_META: DraftMeta = {
  projectPath: "~/maou-sdk/webui",
  projectLabel: "maou-sdk/webui",
  agentName: "coding",
  sandboxMode: "yolo",
  provider: "openai",
  model: "gpt-5",
  tokenLabel: "12.4k / 128k",
};

/**
 * 系统 Agent：仅 ops 及其附属子 agent。
 * 项目 Agent：coding 及其附属（explore / research / tester）挂在具体项目下。
 */
const DEFAULT_AGENTS: DraftAgent[] = [
  {
    id: "system:ops",
    name: "ops",
    displayName: "ops",
    role: "运维",
    status: "idle",
    group: "system",
    overview: "系统运维助手",
  },
  {
    id: "system:ops::monitor",
    name: "monitor",
    displayName: "monitor",
    role: "监控",
    status: "idle",
    group: "system",
    parent: "ops",
    overview: "进程与服务监控",
  },
  {
    id: "system:ops::cleanup",
    name: "cleanup",
    displayName: "cleanup",
    role: "清理",
    status: "done_read",
    group: "system",
    parent: "ops",
    overview: "缓存与产物清理",
  },
  {
    id: "project:/Users/mac/Documents/vscodeProject/maou-sdk:coding",
    name: "coding",
    displayName: "coding",
    role: "编码",
    status: "idle",
    group: "project",
    projectPath: "/Users/mac/Documents/vscodeProject/maou-sdk",
    projectName: "maou-sdk",
    overview: "~/…/maou-sdk",
  },
  {
    id: "project:/Users/mac/Documents/vscodeProject/maou-sdk:explore",
    name: "explore",
    displayName: "explore",
    role: "检索",
    status: "idle",
    group: "project",
    parent: "coding",
    projectPath: "/Users/mac/Documents/vscodeProject/maou-sdk",
    projectName: "maou-sdk",
    overview: "项目内代码探索",
  },
  {
    id: "project:/Users/mac/Documents/vscodeProject/maou-sdk:research",
    name: "research",
    displayName: "research",
    role: "调研",
    status: "done_read",
    group: "project",
    parent: "coding",
    projectPath: "/Users/mac/Documents/vscodeProject/maou-sdk",
    projectName: "maou-sdk",
    overview: "资料调研子 agent",
  },
  {
    id: "project:/Users/mac/Documents/vscodeProject/maou-sdk:tester",
    name: "tester",
    displayName: "tester",
    role: "测试",
    status: "idle",
    group: "project",
    parent: "coding",
    projectPath: "/Users/mac/Documents/vscodeProject/maou-sdk",
    projectName: "maou-sdk",
    overview: "项目测试子 agent",
  },
  {
    id: "project:/Users/mac/Documents/vscodeProject/maou-agent:coding",
    name: "coding",
    displayName: "coding",
    role: "编码",
    status: "idle",
    group: "project",
    projectPath: "/Users/mac/Documents/vscodeProject/maou-agent",
    projectName: "maou-agent",
    overview: "~/…/maou-agent",
    stale: true,
  },
];

const DEFAULT_PROJECT_CODING =
  "project:/Users/mac/Documents/vscodeProject/maou-sdk:coding";

const DEFAULT_BG: DraftBgTask[] = [
  {
    id: "bg-1",
    title: "索引 workspace 文件",
    status: "done",
    agent: "coding",
  },
  {
    id: "bg-2",
    title: "等待终端审批",
    status: "queued",
    agent: "coding",
  },
];

const BUSY_AGENTS: DraftAgent[] = DEFAULT_AGENTS.map((a) => {
  if (a.id === DEFAULT_PROJECT_CODING) {
    return { ...a, status: "running" as const, overview: "正在改 draft shell" };
  }
  if (a.id === "project:/Users/mac/Documents/vscodeProject/maou-sdk:explore") {
    return { ...a, status: "running" as const };
  }
  if (a.id === "system:ops") {
    return { ...a, status: "blocked" as const, overview: "待审批终端命令" };
  }
  if (a.id === "system:ops::monitor") {
    return { ...a, status: "running" as const };
  }
  // 项目下 idle 子会折叠为提示行
  return { ...a };
});

const BUSY_BG: DraftBgTask[] = [
  {
    id: "bg-1",
    title: "扫描 agent-terminals",
    status: "running",
    agent: "coding",
  },
  {
    id: "bg-2",
    title: "类型检查 client",
    status: "queued",
    agent: "coding",
  },
  {
    id: "bg-3",
    title: "上一任务完成",
    status: "done",
    agent: "ops",
  },
];

/** Flat paths → VS Code–style tree. Trailing `/` = empty folder. ` *` = modified (M). */
const DEFAULT_FILES = [
  "maou-agent/templates/",
  "maou-agent/test/",
  "maou-agent/.gitignore *",
  "maou-agent/.mcp.json",
  "maou-agent/app.js",
  "maou-agent/CLAUDE.md",
  "maou-agent/CODEBUDDY.md",
  "maou-agent/index.html",
  "maou-agent/maou-agent.code-workspace",
  "maou-agent/package-lock.json",
  "maou-agent/package.json *",
  "maou-agent/pelican-bicycle.html",
  "maou-agent/README.md",
  "maou-agent/records.json",
  "maou-agent/skills-lock.json",
  "maou-agent/snippet-description",
  "maou-agent/styles.css",
  "maou-agent/todo.md *",
  "maou-agent/tsconfig.json",
  "maou-example/.claude/",
  "maou-example/.maou/",
  "maou-example/.sqry/",
  "maou-example/pelican-bike/",
  "maou-example/tavern/",
  "maou-example/.gitignore",
  "maou-example/README.md",
  "maou-sdk/_toolinit_test/",
  "maou-sdk/.cache/",
  "maou-sdk/.claude/",
  "maou-sdk/.github/",
  "maou-sdk/.maou/",
  "maou-sdk/webui/src/client/App.tsx",
  "maou-sdk/webui/src/client/drafts/DraftShell.tsx",
  "maou-sdk/webui/src/client/drafts/fixtures.ts",
  "maou-sdk/webui/src/client/styles.css",
  "maou-sdk/webui/package.json",
  "maou-sdk/webui/README.md",
];

const DEFAULT_TERM = [
  "$ pnpm --filter @little-house-studio/webui dev",
  "VITE v6  ready in 320 ms",
  "➜  Local:   http://127.0.0.1:5173/",
  "server listening on :8787",
  "",
  "[草稿] 模拟终端 — 无真实 PTY",
];

const LONG_BODY = [
  "这是一段用于测试溢出与换行的长回复。",
  "",
  "```ts",
  "export function veryLongIdentifierThatShouldNotBreakTheLayout(",
  "  leftPanelWidth: number,",
  "  rightRailWidth: number,",
  "  threadMaxWidth = 48 /* rem */",
  ") {",
  "  return Math.max(0, window.innerWidth - leftPanelWidth - rightRailWidth);",
  "}",
  "```",
  "",
  "下面是一段重复内容，用来把滚动区撑高：",
  ...Array.from({ length: 24 }, (_, i) => `· 第 ${i + 1} 行 — 滚动溢出示例`),
  "",
  "末尾还有一个超长无空格 token：",
  "x".repeat(180),
].join("\n");

const APPROVAL_RM: DraftApproval = {
  id: "appr-1",
  summary: "Agent 请求执行可能危险的终端命令",
  command: "rm -rf ./dist && npm run build",
  risk: "high",
  agentName: "coding",
};

/**
 * Full scenario catalog — each case is a self-contained Work-shell fixture.
 */
export const SCENARIO_CATALOG: readonly DraftScenario[] = [
  {
    id: "normal",
    label: "正常会话",
    description: "多轮用户/助手对话 + 侧栏多个会话",
    initialSessionId: "s-normal-1",
    sessions: [
      {
        id: "s-normal-1",
        title: "搭建 Codex 风格外壳",
        agent: "coding",
        timeLabel: "2 分钟前",
      },
      {
        id: "s-normal-2",
        title: "打磨 Markdown 工作台",
        agent: "coding",
        timeLabel: "1 小时前",
      },
      {
        id: "s-normal-3",
        title: "探索 monorepo 结构",
        agent: "ops",
        timeLabel: "昨天",
      },
    ],
    messagesBySession: {
      "s-normal-1": [
        {
          id: "n1",
          role: "user",
          body: "帮我做一个和当前 WebUI 一样的布局草稿，方便后面再接真实逻辑。",
        },
        {
          id: "n2",
          role: "assistant",
          body: "好的。侧栏、顶栏、会话列表、对话区、右侧终端/文件会拆成独立模块，先用场景假数据把布局跑通。\n\n- 侧栏：agent / 会话\n- 中栏：上下文 + 悬浮 Tasks / Composer\n- 底栏：终端 · 待办 · 日志",
        },
        {
          id: "n3",
          role: "user",
          body: "会话切换和新建也要能点。",
        },
        {
          id: "n4",
          role: "assistant",
          body: "可以。全部是**本地状态**；发送只会回显，不会请求后端。",
        },
      ],
      "s-normal-2": [
        {
          id: "n5",
          role: "user",
          body: "文档全屏工作台占位长什么样？",
        },
        {
          id: "n6",
          role: "assistant",
          body: "中间整栏文档区 + 三块占位卡（树 / 编辑器 / 大纲）。",
        },
      ],
      "s-normal-3": [
        {
          id: "n7",
          role: "system",
          body: "会话来自场景目录 · 正常会话",
        },
        {
          id: "n8",
          role: "assistant",
          body: "ops 助手会话示例：可检查助手标签与侧栏元数据。",
        },
      ],
    },
    meta: { ...BASE_META },
    flags: {
      agentBusy: false,
      pendingApproval: null,
      showFiles: true,
      showDiff: false,
      statusHint: "草稿 · 仅本地",
      usageLabel: "12.4k / 128k",
    },
    fileTree: DEFAULT_FILES,
    termLines: DEFAULT_TERM,
    agents: DEFAULT_AGENTS,
    initialAgentId: "project:/Users/mac/Documents/vscodeProject/maou-sdk:coding",
    bgTasks: DEFAULT_BG,
  },
  {
    id: "empty_thread",
    label: "空对话",
    description: "有会话但消息为空 — 显示空状态提示",
    initialSessionId: "s-empty-1",
    sessions: [
      {
        id: "s-empty-1",
        title: "全新任务",
        agent: "coding",
        timeLabel: "刚刚",
      },
      {
        id: "s-empty-2",
        title: "也是空的",
        agent: "coding",
        timeLabel: "3 分钟前",
      },
    ],
    messagesBySession: {
      "s-empty-1": [],
      "s-empty-2": [],
    },
    meta: { ...BASE_META, sandboxMode: "ask" },
    flags: {
      agentBusy: false,
      pendingApproval: null,
      showFiles: false,
      showDiff: false,
      statusHint: "空对话 · 开始输入",
      usageLabel: "0 / 128k",
    },
    fileTree: DEFAULT_FILES.slice(0, 3),
    termLines: ["$ # 尚无进程", "[草稿] 终端为空"],
    agents: DEFAULT_AGENTS,
    initialAgentId: "project:/Users/mac/Documents/vscodeProject/maou-sdk:coding",
    bgTasks: [],
  },
  {
    id: "busy",
    label: "助手忙碌",
    description: "运行中角标 + 流式条 + 思考/工具行",
    initialSessionId: "s-busy-1",
    sessions: [
      {
        id: "s-busy-1",
        title: "重构终端中枢",
        agent: "coding",
        timeLabel: "进行中",
      },
    ],
    messagesBySession: {
      "s-busy-1": [
        {
          id: "b1",
          role: "user",
          body: "把 terminal-hub 的 attach 路径理一下，边改边跑测试。",
        },
        {
          id: "b2",
          role: "assistant",
          body: "先定位 `create-server` 里的 WS 路由，再核对 **write/stop** 接口。\n\n步骤：\n1. 搜路由注册\n2. 对照 attach 参数",
        },
        {
          id: "b3",
          role: "thinking",
          body: "正在扫描 `harness/server.ts` · agent-terminals · create-server…",
        },
        {
          id: "b4",
          role: "tool",
          tag: "use_terminal",
          body: "terminal_id=term-draft-9\n$ rg -n \"agent-terminal\" src/server",
          clickable: true,
        },
      ],
    },
    meta: { ...BASE_META, model: "gpt-5-thinking" },
    flags: {
      agentBusy: true,
      pendingApproval: null,
      showFiles: true,
      showDiff: false,
      statusHint: "助手运行中…",
      usageLabel: "48.1k / 128k",
    },
    fileTree: DEFAULT_FILES,
    termLines: [
      "$ rg -n \"agent-terminal\" src/server",
      "src/server/create-server.ts:412:  app.ws(\"/ws/agent-terminal\"…",
      "src/server/agent-terminals.ts:88: export function attach…",
      "",
      "[流式] 助手仍在写入…",
    ],
    agents: BUSY_AGENTS,
    initialAgentId: "project:/Users/mac/Documents/vscodeProject/maou-sdk:coding",
    bgTasks: BUSY_BG,
  },
  {
    id: "pending_approval",
    label: "待审批",
    description: "对话顶部审批横幅（高风险命令）",
    initialSessionId: "s-appr-1",
    sessions: [
      {
        id: "s-appr-1",
        title: "清理构建产物",
        agent: "coding",
        timeLabel: "1 分钟前",
      },
    ],
    messagesBySession: {
      "s-appr-1": [
        {
          id: "a1",
          role: "user",
          body: "清一下 dist 再重新 build。",
        },
        {
          id: "a2",
          role: "assistant",
          body: "需要执行清理命令，已提交**审批请求**。",
        },
        {
          id: "a3",
          role: "tool",
          tag: "use_terminal",
          body: "等待审批 · rm -rf ./dist && npm run build",
        },
      ],
    },
    meta: { ...BASE_META, sandboxMode: "ask" },
    flags: {
      agentBusy: true,
      pendingApproval: APPROVAL_RM,
      showFiles: true,
      showDiff: false,
      statusHint: "等待审批",
      usageLabel: "6.2k / 128k",
    },
    fileTree: ["dist/", "package.json", "tsconfig.json"],
    termLines: [
      "$ # 已拦截，等待审批",
      "command: rm -rf ./dist && npm run build",
      "[草稿] 允许一次 / 始终允许 / 拒绝 / 黑名单",
    ],
    agents: DEFAULT_AGENTS,
    initialAgentId: "project:/Users/mac/Documents/vscodeProject/maou-sdk:coding",
    bgTasks: DEFAULT_BG,
  },
  {
    id: "mixed_roles",
    label: "角色混排",
    description: "用户 / 助手 / 系统 / 工具 / 错误 / 思考 样式混排",
    initialSessionId: "s-mix-1",
    sessions: [
      {
        id: "s-mix-1",
        title: "角色样式一览",
        agent: "coding",
        timeLabel: "12 分钟前",
      },
      {
        id: "s-mix-2",
        title: "第二条混排会话",
        agent: "ops",
        timeLabel: "40 分钟前",
      },
    ],
    messagesBySession: {
      "s-mix-1": [
        {
          id: "x1",
          role: "system",
          body: "沙箱=ask · 模型=gpt-5 · 草稿假数据",
        },
        { id: "x2", role: "user", body: "跑一下类型检查，失败的话把错误贴出来。" },
        {
          id: "x3",
          role: "thinking",
          body: "计划：tsc 客户端 → tsc 服务端 → 汇总错误",
        },
        {
          id: "x4",
          role: "tool",
          tag: "run_terminal",
          body: "$ npx tsc -p tsconfig.client.json --noEmit\nexit 2",
          clickable: true,
        },
        {
          id: "x5",
          role: "err",
          body: "类型错误：类型「DraftMeta」上不存在属性「pendingApproval」。",
        },
        {
          id: "x6",
          role: "assistant",
          body: "类型定义缺了审批字段。已在 `types.ts` 补上 `DraftApproval`，请再跑一遍检查。",
        },
        {
          id: "x7",
          role: "system",
          body: "工具结果已截断 · 省略 2.1k 字符",
        },
      ],
      "s-mix-2": [
        { id: "x8", role: "user", body: "ops 侧也要能看到错误样式。" },
        {
          id: "x9",
          role: "err",
          body: "ECONNREFUSED 127.0.0.1:8787 — 后端离线（纯草稿场景下属预期）。",
        },
      ],
    },
    meta: {
      ...BASE_META,
      provider: "anthropic",
      model: "claude-sonnet",
      sandboxMode: "normal",
    },
    flags: {
      agentBusy: false,
      pendingApproval: null,
      showFiles: true,
      showDiff: true,
      statusHint: "角色样式混排",
      usageLabel: "22.0k / 200k",
    },
    fileTree: [
      "src/client/drafts/types.ts",
      "src/client/drafts/fixtures.ts",
      "src/client/drafts/panels/ThreadPanel.tsx",
      "src/client/styles.css",
    ],
    termLines: [
      "$ npx tsc -p tsconfig.client.json --noEmit",
      "src/client/drafts/types.ts(12,3): error TS2300: …",
      "",
      "发现 1 个错误。",
    ],
    agents: DEFAULT_AGENTS,
    initialAgentId: "project:/Users/mac/Documents/vscodeProject/maou-sdk:coding",
    bgTasks: DEFAULT_BG,
  },
  {
    id: "long_overflow",
    label: "长内容溢出",
    description: "超长正文、无空格长 token、多行工具输出",
    initialSessionId: "s-long-1",
    sessions: [
      {
        id: "s-long-1",
        title: "压测布局溢出",
        agent: "coding",
        timeLabel: "5 分钟前",
      },
    ],
    messagesBySession: {
      "s-long-1": [
        {
          id: "l1",
          role: "user",
          body:
            "请生成很长的说明，并附带路径：" +
            "/Users/mac/Documents/vscodeProject/maou-sdk/webui/src/client/drafts/".repeat(
              3,
            ),
        },
        {
          id: "l2",
          role: "assistant",
          body: LONG_BODY,
        },
        {
          id: "l3",
          role: "tool",
          tag: "read_file",
          body: Array.from(
            { length: 40 },
            (_, i) =>
              `${String(i + 1).padStart(4, " ")}| // 超长文件转储，用于线程与侧栏溢出`,
          ).join("\n"),
        },
      ],
    },
    meta: { ...BASE_META },
    flags: {
      agentBusy: false,
      pendingApproval: null,
      showFiles: true,
      showDiff: false,
      statusHint: "溢出压测",
      usageLabel: "91k / 128k",
    },
    fileTree: [
      ...DEFAULT_FILES,
      "node_modules/react/index.js",
      "dist/client/assets/index-XXXXXXXX.js",
      "very/deeply/nested/path/to/a/file/with/a/long-name.tsx",
    ],
    termLines: [
      ...DEFAULT_TERM,
      ...Array.from(
        { length: 30 },
        (_, i) => `log[${i}] 终端滚动填充行`,
      ),
    ],
    agents: DEFAULT_AGENTS,
    initialAgentId: "project:/Users/mac/Documents/vscodeProject/maou-sdk:coding",
    bgTasks: DEFAULT_BG,
  },
  {
    id: "empty_sessions",
    label: "空会话列表",
    description: "侧栏无会话 —「新建任务」仍可用",
    initialSessionId: "",
    sessions: [],
    messagesBySession: {},
    meta: {
      ...BASE_META,
      provider: "",
      model: "",
      offline: true,
      sandboxMode: "yolo",
    },
    flags: {
      agentBusy: false,
      pendingApproval: null,
      showFiles: false,
      showDiff: false,
      statusHint: "无会话 · 请新建",
      usageLabel: "—",
    },
    fileTree: [],
    termLines: ["[草稿] 无终端会话"],
    agents: DEFAULT_AGENTS,
    initialAgentId: "project:/Users/mac/Documents/vscodeProject/maou-sdk:coding",
    bgTasks: [],
  },
] as const satisfies readonly DraftScenario[];

// ── Pure selectors / mutators (unit-testable without React) ──────────────

export function listScenarioIds(): ScenarioId[] {
  return SCENARIO_CATALOG.map((s) => s.id);
}

export function getScenario(id: ScenarioId): DraftScenario {
  const found = SCENARIO_CATALOG.find((s) => s.id === id);
  if (!found) {
    throw new Error(`Unknown draft scenario: ${id}`);
  }
  return found;
}

export function assertCatalogComplete(): {
  ok: true;
  ids: ScenarioId[];
} {
  const ids = listScenarioIds();
  for (const required of REQUIRED_SCENARIO_IDS) {
    if (!ids.includes(required)) {
      throw new Error(`Missing required scenario: ${required}`);
    }
  }
  for (const scenario of SCENARIO_CATALOG) {
    validateScenarioMessages(scenario);
  }
  return { ok: true, ids };
}

/** Empty array allowed only for empty_thread (and any session under empty_sessions). */
export function validateScenarioMessages(scenario: DraftScenario): void {
  if (scenario.id === "empty_sessions") {
    if (scenario.sessions.length !== 0) {
      throw new Error("empty_sessions must have zero sessions");
    }
    return;
  }
  for (const session of scenario.sessions) {
    const msgs = scenario.messagesBySession[session.id];
    if (msgs === undefined) {
      throw new Error(
        `Scenario ${scenario.id}: session ${session.id} has no messages entry`,
      );
    }
    if (scenario.id === "empty_thread") {
      if (msgs.length !== 0) {
        throw new Error(
          `empty_thread session ${session.id} must have empty message array`,
        );
      }
    }
  }
  if (
    scenario.initialSessionId &&
    !scenario.sessions.some((s) => s.id === scenario.initialSessionId)
  ) {
    throw new Error(
      `Scenario ${scenario.id}: initialSessionId not in sessions`,
    );
  }
}

export function messagesForSession(
  messagesBySession: Record<string, DraftMessage[]>,
  sessionId: string,
): DraftMessage[] {
  if (!sessionId) return [];
  return messagesBySession[sessionId] ?? [];
}

export function sessionTitle(
  sessions: DraftSession[],
  sessionId: string,
): string | null {
  return sessions.find((s) => s.id === sessionId)?.title ?? null;
}

/** Sessions belonging to one agent (by agent name, as stored on DraftSession.agent). */
export function sessionsForAgent(
  sessions: DraftSession[],
  agentName: string,
): DraftSession[] {
  const key = agentName.trim();
  if (!key) return [];
  return sessions.filter((s) => s.agent === key);
}

/**
 * When switching agents, keep active session if it belongs to the agent;
 * otherwise pick the first session for that agent (or "").
 */
export function pickSessionForAgent(
  sessions: DraftSession[],
  agentName: string,
  preferredSessionId: string,
): string {
  const owned = sessionsForAgent(sessions, agentName);
  if (owned.some((s) => s.id === preferredSessionId)) return preferredSessionId;
  return owned[0]?.id ?? "";
}

export type LocalDraftState = {
  scenarioId: ScenarioId;
  sessions: DraftSession[];
  activeSessionId: string;
  messagesBySession: Record<string, DraftMessage[]>;
  agentBusy: boolean;
  pendingApproval: DraftApproval | null;
  meta: DraftMeta;
  fileTree: string[];
  termLines: string[];
  statusHint: string;
  usageLabel: string;
  agents: DraftAgent[];
  activeAgentId: string;
  bgTasks: DraftBgTask[];
  showFiles: boolean;
  showDiff: boolean;
};

export function hydrateFromScenario(scenarioId: ScenarioId): LocalDraftState {
  const s = getScenario(scenarioId);
  return {
    scenarioId,
    sessions: s.sessions.map((x) => ({ ...x })),
    activeSessionId: s.initialSessionId,
    messagesBySession: cloneMessages(s.messagesBySession),
    agentBusy: s.flags.agentBusy,
    pendingApproval: s.flags.pendingApproval
      ? { ...s.flags.pendingApproval }
      : null,
    meta: { ...s.meta },
    fileTree: [...s.fileTree],
    termLines: [...s.termLines],
    statusHint: s.flags.statusHint ?? "草稿 · 仅本地",
    usageLabel: s.flags.usageLabel ?? s.meta.tokenLabel ?? "—",
    agents: s.agents.map((a) => ({ ...a })),
    activeAgentId: s.initialAgentId,
    bgTasks: s.bgTasks.map((t) => ({ ...t })),
    showFiles: s.flags.showFiles ?? true,
    showDiff: true,
  };
}

function cloneMessages(
  map: Record<string, DraftMessage[]>,
): Record<string, DraftMessage[]> {
  const out: Record<string, DraftMessage[]> = {};
  for (const [k, v] of Object.entries(map)) {
    out[k] = v.map((m) => ({ ...m }));
  }
  return out;
}

export function applyLocalSend(
  state: LocalDraftState,
  text: string,
  now = Date.now(),
): LocalDraftState {
  const trimmed = text.trim();
  if (!trimmed) return state;

  let activeSessionId = state.activeSessionId;
  let sessions = state.sessions;
  let messagesBySession = state.messagesBySession;

  if (!activeSessionId) {
    activeSessionId = `local-${now}`;
    const created: DraftSession = {
      id: activeSessionId,
      title: trimmed.slice(0, 42) || "未命名",
      agent: state.meta.agentName || "coding",
      timeLabel: "刚刚",
    };
    sessions = [created, ...sessions];
    messagesBySession = { ...messagesBySession, [activeSessionId]: [] };
  }

  const userMsg: DraftMessage = {
    id: `u-${now}`,
    role: "user",
    body: trimmed,
  };
  const echo: DraftMessage = {
    id: `a-${now}`,
    role: "assistant",
    body: `（草稿回显）收到：${trimmed}`,
  };
  const prev = messagesBySession[activeSessionId] ?? [];
  return {
    ...state,
    activeSessionId,
    sessions,
    messagesBySession: {
      ...messagesBySession,
      [activeSessionId]: [...prev, userMsg, echo],
    },
    // local send clears busy/approval for interactive draft feel
    agentBusy: false,
    pendingApproval: null,
    statusHint: "草稿 · 仅本地",
  };
}

const APPROVAL_DECISION_ZH: Record<
  "once" | "always" | "deny" | "blacklist",
  string
> = {
  once: "允许一次",
  always: "始终允许",
  deny: "拒绝",
  blacklist: "黑名单",
};

export function applyNewSession(
  state: LocalDraftState,
  now = Date.now(),
): LocalDraftState {
  const id = `s-new-${now}`;
  const next: DraftSession = {
    id,
    title: "未命名草稿",
    agent: state.meta.agentName || "coding",
    timeLabel: "刚刚",
  };
  return {
    ...state,
    sessions: [next, ...state.sessions],
    activeSessionId: id,
    messagesBySession: {
      ...state.messagesBySession,
      [id]: [
        {
          id: `${id}-sys`,
          role: "system",
          body: "新草稿会话 — 消息只保存在本地。",
        },
      ],
    },
    agentBusy: false,
    pendingApproval: null,
    statusHint: "草稿 · 仅本地",
  };
}

export function applyApprovalDecision(
  state: LocalDraftState,
  decision: "once" | "always" | "deny" | "blacklist",
): LocalDraftState {
  if (!state.pendingApproval) return state;
  const note: DraftMessage = {
    id: `appr-res-${Date.now()}`,
    role: "system",
    body: `审批结果：${APPROVAL_DECISION_ZH[decision]} · ${state.pendingApproval.command}`,
  };
  const sid = state.activeSessionId;
  const prev = sid ? (state.messagesBySession[sid] ?? []) : [];
  return {
    ...state,
    pendingApproval: null,
    agentBusy: decision === "deny" || decision === "blacklist" ? false : true,
    statusHint:
      decision === "deny" || decision === "blacklist"
        ? "审批已拒绝"
        : "已批准 · 运行中…",
    messagesBySession: sid
      ? { ...state.messagesBySession, [sid]: [...prev, note] }
      : state.messagesBySession,
  };
}

/** Re-export friendly aliases used by older draft imports. */
export const DRAFT_META = BASE_META;
