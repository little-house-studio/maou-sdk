/**
 * defineSubagent —— 四类衍生 agent 的声明 API。
 *
 * @example
 * export default defineSubagent({
 *   kind: "task",
 *   name: "web-search",
 *   description: "网页搜索",
 *   toolPreset: "web_search",
 *   permission: "readonly",
 * });
 */

import {
  type SubagentKind,
  type SubagentPermission,
  type SubagentStorageScope,
  type SubagentModelConfig,
  type TaskToolPresetName,
  type SubagentKindDefaults,
  SUBAGENT_KIND_DEFAULTS,
  mergeKindDefaults,
  resolveSubagentTools,
  helperUsesExecutor,
} from "./subagent-kinds.js";

// ─── 输入配置 ──────────────────────────────────────────────────────────────

export interface DefineSubagentConfig {
  kind: SubagentKind;
  /** 名称：helper/task/project 必填；fork 可选（默认 母名-序号） */
  name?: string;
  displayName?: string;
  description?: string;

  /** 是否持久化上下文（helper 默认 false；为 true 时进 Executor + 管理列表） */
  persistContext?: boolean;
  /** 是否开启 multi-round loop（helper 默认 false） */
  enableLoop?: boolean;
  /** fork 时是否完整复制母 session（默认 fork=true，其余 false） */
  inheritFullContext?: boolean;

  /** 权限 */
  permission?: SubagentPermission;
  /** 显式工具白名单；null/不填走预设或继承 */
  tools?: string[] | null;
  /** task 类先天白名单预设 */
  toolPreset?: TaskToolPresetName;

  /** 子工程 / 范围根路径（project 必填） */
  path?: string;
  /** 路径外额外审核路径列表（project） */
  auditPaths?: string[];

  /** 系统提示词（helper/project 必填；可指向文件由物化层写） */
  systemPrompt?: string;

  /** 模型 */
  model?: SubagentModelConfig;
  roundLimit?: number;

  storageScope?: SubagentStorageScope;
  /** 临时目录（.tmp/）：可回档可快删 */
  ephemeral?: boolean;

  /** 母 agent 名（物化路径用） */
  parentAgentName?: string;
  /** 母 agent 工具列表（继承时） */
  parentTools?: string[];

  /** hook 名列表（目录 hook/ 下脚本） */
  hooks?: string[];

  /** 透传 agent.json 额外字段 */
  extra?: Record<string, unknown>;
}

// ─── 解析结果 ──────────────────────────────────────────────────────────────

export interface DefinedSubagent {
  kind: SubagentKind;
  name: string;
  displayName: string;
  description: string;
  defaults: SubagentKindDefaults;
  /** 解析后的最终策略 */
  resolved: {
    persistContext: boolean;
    enableLoop: boolean;
    inheritFullContext: boolean;
    permission: SubagentPermission;
    tools: string[];
    roundLimit: number;
    overRoundPolicy: "wrap_up" | "hard_stop";
    storageScope: SubagentStorageScope;
    ephemeral: boolean;
    /** 是否走 SubagentExecutor */
    useExecutor: boolean;
    /** 是否出现在 agent 管理列表（killed 除外） */
    listInManager: boolean;
    path?: string;
    auditPaths: string[];
    systemPrompt?: string;
    model: SubagentModelConfig;
  };
  parentAgentName?: string;
  hooks: string[];
  extra: Record<string, unknown>;
  /** 写入 agent.json 的规范化对象 */
  toAgentJson(): Record<string, unknown>;
}

function requireName(kind: SubagentKind, name?: string): string {
  if (name && name.trim()) return name.trim();
  if (kind === "fork") return `fork-${Date.now().toString(36)}`;
  throw new Error(`defineSubagent(${kind}): name 必填`);
}

/**
 * 声明一个 subagent。不做 IO；物化请用 materializeSubagent()。
 */
export function defineSubagent(config: DefineSubagentConfig): DefinedSubagent {
  const kind = config.kind;
  const base = mergeKindDefaults(kind, {
    enableLoop: config.enableLoop,
    persistContext: config.persistContext,
    inheritFullContext: config.inheritFullContext,
    permission: config.permission,
    tools: config.tools === undefined ? undefined : config.tools,
    toolPreset: config.toolPreset,
    roundLimit: config.roundLimit,
    storageScope: config.storageScope,
    ephemeralDir: config.ephemeral,
  } as Partial<SubagentKindDefaults>);

  const name = requireName(kind, config.name);
  if ((kind === "project") && !config.path?.trim()) {
    throw new Error(`defineSubagent(project): path 必填`);
  }
  if ((kind === "helper" || kind === "project") && !config.systemPrompt?.trim()) {
    // 允许物化时再写文件，但警告：解析层仍允许空，materialize 会校验模板
  }

  const enableLoop = config.enableLoop ?? base.enableLoop;
  const persistContext = config.persistContext ?? base.persistContext;
  const tools = resolveSubagentTools({
    kind,
    enableLoop,
    tools: config.tools,
    toolPreset: config.toolPreset,
    parentTools: config.parentTools,
  });

  const useExecutor =
    kind === "helper" ? helperUsesExecutor(persistContext) : base.requiresExecutor;

  // helper：仅持久化才进管理列表；其它 kind 用默认；killed 由 list API 再滤
  const listInManager = kind === "helper" ? persistContext : base.listInManager;

  const ephemeral =
    config.ephemeral ??
    (!persistContext || base.ephemeralDir);

  const resolved: DefinedSubagent["resolved"] = {
    persistContext,
    enableLoop,
    inheritFullContext: config.inheritFullContext ?? base.inheritFullContext,
    permission: config.permission ?? base.permission,
    tools,
    roundLimit: config.roundLimit ?? base.roundLimit,
    overRoundPolicy: base.overRoundPolicy,
    storageScope: config.storageScope ?? base.storageScope,
    ephemeral,
    useExecutor,
    listInManager,
    path: config.path?.trim(),
    auditPaths: config.auditPaths ?? [],
    systemPrompt: config.systemPrompt,
    model: {
      thinking: false,
      ...config.model,
    },
  };

  const displayName = config.displayName ?? name;
  const description = config.description ?? `${kind} subagent: ${name}`;

  return {
    kind,
    name,
    displayName,
    description,
    defaults: base,
    resolved,
    parentAgentName: config.parentAgentName,
    hooks: config.hooks ?? [],
    extra: config.extra ?? {},
    toAgentJson() {
      return {
        name,
        display_name: displayName,
        role: kind,
        scope: "subagent",
        subagent_kind: kind,
        description,
        status: "active",
        round_limit: resolved.roundLimit,
        enable_loop: resolved.enableLoop,
        persist_context: resolved.persistContext,
        inherit_full_context: resolved.inheritFullContext,
        permission: resolved.permission,
        tools: resolved.tools,
        tool_preset: config.toolPreset,
        path: resolved.path,
        audit_paths: resolved.auditPaths,
        storage_scope: resolved.storageScope,
        ephemeral: resolved.ephemeral,
        list_in_manager: resolved.listInManager,
        use_executor: resolved.useExecutor,
        over_round_policy: resolved.overRoundPolicy,
        model: resolved.model,
        parent_agent: config.parentAgentName,
        hooks: config.hooks ?? [],
        ...config.extra,
      };
    },
  };
}

/** 类型守卫 */
export function isDefinedSubagent(v: unknown): v is DefinedSubagent {
  return (
    !!v &&
    typeof v === "object" &&
    "kind" in v &&
    "toAgentJson" in v &&
    typeof (v as DefinedSubagent).toAgentJson === "function"
  );
}

export { SUBAGENT_KIND_DEFAULTS };
