/**
 * Subagent 类型系统 —— 四类衍生 agent 的默认策略与白名单预设。
 *
 * 类型：
 *   fork    — 从母 agent 完整复制上下文的子分支（todo 分支等）
 *   helper  — 事件触发的小任务；默认单轮、无 tool；持久化的才进 SubagentExecutor 管理列表
 *   task    — 专业子任务（搜索/报告等），独立上下文 + loop，独立/预设工具白名单
 *   project — 路径驻扎的小型 coding agent，path 严格 + 域外审核
 *
 * @see docs 约定：kill 的 agent 不出现在管理列表；临时模板目录可回档可快删
 */

// ─── Kind ──────────────────────────────────────────────────────────────────

export type SubagentKind = "fork" | "helper" | "task" | "project";

/** 权限档位 */
export type SubagentPermission =
  /** 只读工具 */
  | "readonly"
  /** 路径/白名单范围内读写 + 终端；范围外拒绝或需审 */
  | "scoped_write"
  /** 与母 agent 相同 */
  | "inherit_parent"
  /** 子工程：范围内自由，路径外需审核 */
  | "project_scoped_audit"
  /** 子工程：允许路径外执行（高危） */
  | "project_unrestricted";

/** 存储位置：嵌套在母 agent 下 / 与母同级 / 共享池 */
export type SubagentStorageScope =
  /** agents/<parent>/subagents/<name>/ （默认） */
  | "nested"
  /** agents/<name>/ 与母同级，可被多个母 agent 引用 */
  | "peer"
  /** agents/.shared/<name>/ 显式共享池 */
  | "shared";

/** 生命周期 */
export type SubagentLifecycleStatus =
  | "active"
  | "idle"
  | "running"
  | "killed";

// ─── 工具白名单预设（task 类先天白名单）────────────────────────────────────

export const TASK_TOOL_PRESETS = {
  /** 只读探索 */
  explore: ["reader", "glob", "grep", "find_code", "todo_finish"] as const,
  /** 网页搜索 */
  web_search: ["search_internet", "reader", "todo_finish"] as const,
  /** 报告撰写（可写报告文件） */
  report: ["reader", "glob", "grep", "write_file", "edit_file", "todo_finish"] as const,
  /** 文件搜索偏重 */
  file_search: ["glob", "grep", "find_code", "reader", "todo_finish"] as const,
  /** 编码范围内（子工程模板默认） */
  coding_scoped: [
    "reader",
    "write_file",
    "edit_file",
    "glob",
    "grep",
    "find_code",
    "use_terminal",
    "todo_manage",
    "todo_finish",
  ] as const,
  /** 空：辅助单轮强制无工具 */
  none: [] as const,
} as const;

export type TaskToolPresetName = keyof typeof TASK_TOOL_PRESETS;

// ─── 配置 ──────────────────────────────────────────────────────────────────

export interface SubagentModelConfig {
  /** preset 名 / model id；helper 默认走 helper/fast 小模型 */
  preset?: string | number;
  /** 是否思考，默认 false（尤其 helper） */
  thinking?: boolean;
  /** 上下文窗口覆盖 */
  maxContext?: number;
}

export interface SubagentKindDefaults {
  kind: SubagentKind;
  /** 是否允许 multi-round agent loop */
  enableLoop: boolean;
  /** 默认是否持久化上下文/目录 */
  persistContext: boolean;
  /** 默认是否完整复制母 session 上下文（fork 时） */
  inheritFullContext: boolean;
  /** 默认权限 */
  permission: SubagentPermission;
  /** 默认工具：null = 继承母；[] = 无；string[] = 白名单 */
  tools: string[] | null;
  /** 默认 task 预设名（若 tools 未显式给） */
  toolPreset?: TaskToolPresetName;
  /** 默认 round 上限；0 = 无限；helper 建议 1 */
  roundLimit: number;
  /** 超轮次策略 */
  overRoundPolicy: "wrap_up" | "hard_stop";
  /** 是否出现在 agent 管理列表（killed 永远不出现） */
  listInManager: boolean;
  /** 必须进 SubagentExecutor 的条件：helper 仅 persist=true */
  requiresExecutor: boolean;
  /** 默认存储 scope */
  storageScope: SubagentStorageScope;
  /** 是否用轻量 .tmp 目录（可回档可快删） */
  ephemeralDir: boolean;
}

/** 四类默认策略表 */
export const SUBAGENT_KIND_DEFAULTS: Record<SubagentKind, SubagentKindDefaults> = {
  fork: {
    kind: "fork",
    enableLoop: true,
    persistContext: true,
    inheritFullContext: true,
    permission: "inherit_parent",
    tools: null, // 继承母
    roundLimit: 0,
    overRoundPolicy: "wrap_up",
    listInManager: true,
    requiresExecutor: true,
    storageScope: "nested",
    ephemeralDir: false,
  },
  helper: {
    kind: "helper",
    enableLoop: false,
    persistContext: false,
    inheritFullContext: false,
    permission: "readonly",
    tools: [], // 单轮强制无 tool（即使配置了也不传给 AI）
    toolPreset: "none",
    roundLimit: 1,
    overRoundPolicy: "wrap_up",
    // 仅 persistContext=true 的 helper 进管理列表 / Executor
    listInManager: false,
    requiresExecutor: false, // 运行时再看 persist
    storageScope: "nested",
    ephemeralDir: true,
  },
  task: {
    kind: "task",
    enableLoop: true,
    persistContext: true,
    inheritFullContext: false,
    permission: "scoped_write",
    tools: null,
    toolPreset: "explore",
    roundLimit: 30,
    overRoundPolicy: "wrap_up",
    listInManager: true,
    requiresExecutor: true,
    storageScope: "nested",
    ephemeralDir: false,
  },
  project: {
    kind: "project",
    enableLoop: true,
    persistContext: true,
    inheritFullContext: false,
    permission: "project_scoped_audit",
    tools: null,
    toolPreset: "coding_scoped",
    roundLimit: 50,
    overRoundPolicy: "wrap_up",
    listInManager: true,
    requiresExecutor: true,
    storageScope: "nested",
    ephemeralDir: false,
  },
};

// ─── 解析工具列表 ──────────────────────────────────────────────────────────

/**
 * 解析最终工具白名单。
 * helper + 单轮：即使 options 写了 tools，也强制 []（规则 6）。
 *
 * 优先级：
 *   1. helper 单轮 → []
 *   2. 显式 tools 数组
 *   3. toolPreset（显式或 kind 默认），除非 tools === null（强制继承母）
 *   4. defaults.tools 数组
 *   5. 继承 parentTools / ["*"]
 */
export function resolveSubagentTools(opts: {
  kind: SubagentKind;
  enableLoop?: boolean;
  tools?: string[] | null;
  toolPreset?: TaskToolPresetName;
  parentTools?: string[];
}): string[] {
  const defaults = SUBAGENT_KIND_DEFAULTS[opts.kind];
  const loop = opts.enableLoop ?? defaults.enableLoop;

  // 辅助 + 单轮：禁止把 tool 交给 AI
  if (opts.kind === "helper" && !loop) {
    return [];
  }

  // 显式白名单数组
  if (Array.isArray(opts.tools)) {
    return [...opts.tools];
  }

  // 预设（tools === null 表示强制继承母，跳过预设）
  if (opts.tools !== null) {
    const presetName = opts.toolPreset ?? defaults.toolPreset;
    if (presetName && TASK_TOOL_PRESETS[presetName]) {
      return [...TASK_TOOL_PRESETS[presetName]];
    }
  }

  // kind 默认固定列表
  if (Array.isArray(defaults.tools)) {
    return [...defaults.tools];
  }

  // 继承母（defaults.tools === null 或显式 tools === null）
  return opts.parentTools ? [...opts.parentTools] : ["*"];
}

/** helper 是否应进入 SubagentExecutor / 管理列表 */
export function helperUsesExecutor(persistContext: boolean): boolean {
  return persistContext === true;
}

/** 合并 kind 默认与用户覆盖（忽略 undefined，避免冲掉默认值） */
export function mergeKindDefaults(
  kind: SubagentKind,
  overrides: Partial<SubagentKindDefaults> = {},
): SubagentKindDefaults {
  const cleaned: Partial<SubagentKindDefaults> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) {
      (cleaned as Record<string, unknown>)[k] = v;
    }
  }
  return { ...SUBAGENT_KIND_DEFAULTS[kind], ...cleaned, kind };
}

// ─── Fork 运行时策略（供 SubagentExecutor 使用）────────────────────────────

/**
 * 从 ForkOptions 风格入参解析出 fork 运行时策略。
 * kind 缺省时返回 null（兼容旧调用，不改行为）。
 */
export interface ForkKindPolicy {
  kind: SubagentKind;
  enableLoop: boolean;
  persistContext: boolean;
  inheritFullContext: boolean;
  /** 是否强制剥离 tools（helper 单轮） */
  stripTools: boolean;
  tools: string[];
  permission: SubagentPermission;
  roundLimit: number;
  overRoundPolicy: "wrap_up" | "hard_stop";
  /**
   * softRequestBudget：roundLimit>0 时用 roundLimit；
   * 0（无限）时返回 undefined，由 executor 默认值接管。
   */
  softRequestBudget?: number;
  /** 是否允许进入 SubagentExecutor（helper 仅 persist） */
  useExecutor: boolean;
  listInManager: boolean;
  path?: string;
  auditPaths: string[];
  /** 临时目录（.tmp） */
  ephemeral: boolean;
  /** 合并进 configOverrides 的字段 */
  configOverrides: Record<string, unknown>;
}

export interface ResolveForkKindInput {
  kind?: SubagentKind | string;
  enableLoop?: boolean;
  persistContext?: boolean;
  inheritFullContext?: boolean;
  stripToolsIfSingleRound?: boolean;
  tools?: string[] | null;
  toolPreset?: TaskToolPresetName;
  permission?: SubagentPermission;
  roundLimit?: number;
  path?: string;
  auditPaths?: string[];
  softRequestBudget?: number;
  configOverrides?: Record<string, unknown>;
  parentTools?: string[];
  ephemeral?: boolean;
}

/**
 * 解析 fork 的 kind 策略。无 kind 时返回 null。
 *
 * 规则：
 * - helper + 单轮：tools 强制 []（即使 options 写了 tools）
 * - helper + !persist：useExecutor=false（调用方应改走 AuxModelCaller）
 * - fork：inheritFullContext 默认 true
 * - roundLimit>0 → softRequestBudget = roundLimit（可被显式 softRequestBudget 覆盖）
 */
export function resolveForkKindPolicy(
  input: ResolveForkKindInput,
): ForkKindPolicy | null {
  if (!input.kind) return null;
  const kind = input.kind as SubagentKind;
  if (!SUBAGENT_KIND_DEFAULTS[kind]) return null;

  const base = SUBAGENT_KIND_DEFAULTS[kind];
  const enableLoop = input.enableLoop ?? base.enableLoop;
  const persistContext = input.persistContext ?? base.persistContext;
  const inheritFullContext =
    input.inheritFullContext ?? base.inheritFullContext;
  const stripTools =
    kind === "helper" &&
    !enableLoop &&
    (input.stripToolsIfSingleRound !== false);

  const tools = resolveSubagentTools({
    kind,
    enableLoop: stripTools ? false : enableLoop,
    tools: stripTools ? [] : input.tools,
    toolPreset: input.toolPreset,
    parentTools: input.parentTools,
  });

  const roundLimit = input.roundLimit ?? base.roundLimit;
  const useExecutor =
    kind === "helper" ? helperUsesExecutor(persistContext) : base.requiresExecutor;
  const listInManager =
    kind === "helper" ? persistContext : base.listInManager;

  const softRequestBudget =
    input.softRequestBudget !== undefined
      ? input.softRequestBudget
      : roundLimit > 0
        ? roundLimit
        : undefined;

  const permission = input.permission ?? base.permission;
  const path = input.path?.trim() || undefined;
  const auditPaths = input.auditPaths ?? [];
  const ephemeral =
    input.ephemeral ??
    (!persistContext || base.ephemeralDir);

  const configOverrides: Record<string, unknown> = {
    ...(input.configOverrides ?? {}),
    subagent_kind: kind,
    enable_loop: enableLoop,
    persist_context: persistContext,
    inherit_full_context: inheritFullContext,
    permission,
    tools,
    round_limit: roundLimit,
    over_round_policy: base.overRoundPolicy,
    list_in_manager: listInManager,
    ephemeral,
  };
  if (path) configOverrides.path = path;
  if (auditPaths.length) configOverrides.audit_paths = auditPaths;
  // helper 单轮：明确清空 tools，防止 overrides 回写
  if (stripTools) {
    configOverrides.tools = [];
    configOverrides.enable_loop = false;
  }

  return {
    kind,
    enableLoop: stripTools ? false : enableLoop,
    persistContext,
    inheritFullContext,
    stripTools,
    tools: stripTools ? [] : tools,
    permission,
    roundLimit,
    overRoundPolicy: base.overRoundPolicy,
    softRequestBudget,
    useExecutor,
    listInManager,
    path,
    auditPaths,
    ephemeral,
    configOverrides,
  };
}
