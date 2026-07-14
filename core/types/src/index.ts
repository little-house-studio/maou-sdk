/**
 * @little-house-studio/types — 基础层（共享类型 + 配置 + 工具函数）
 *
 * 原 @little-house-studio/types 已并入本包（按"core/ 文件夹不与 core 包撞名"的决定 A）。
 * 内容：
 * - 领域类型：工具(ToolCall/ToolDefinition/...)、会话(Session/Message)、流式事件(StreamEvent)
 * - 应用配置：AppConfig/ApiConfig/SecurityConfig/...
 * - 配置管理：ConfigStore（Zod 校验 + JSONC + 两级 deep-merge）
 * - 项目管理：getProjectsList/addProject/...
 * - 工具函数 + 常量（MAOU_VERSION/DEFAULT_PORT/...）
 * - 表情检测 detectExpression
 *
 * 依赖：jsonc-parser、zod（ConfigStore 用）。本包是基础层，不依赖其它 @little-house-studio 包。
 */

// ─── 领域类型（Session/Message/Tool/StreamEvent）────────────────────────────
export interface Session {
  id: string
  agentName: string
  title: string
  messages: Message[]
  createdAt: string
  updatedAt: string
}
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'
export interface Message {
  role: MessageRole
  content: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  timestamp: string
}
export interface JsonSchema {
  type: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  additionalProperties?: boolean
  description?: string
  minimum?: number
  maximum?: number
  items?: JsonSchema
  enum?: string[]
  [key: string]: unknown
}
export interface ToolDefinition {
  name: string
  aliases: string[]
  description: string
  parameters: JsonSchema
  allowedModes: string[] | null
  paramGuards?: Record<string, string>
  /**
   * 单轮内多个工具调用是否可并行执行。
   * true = 该工具无副作用/读操作，安全并发（如 read/glob/grep/find_code/lsp）；
   * 缺省/false = 串行（写文件、终端、有状态操作）。
   * AgentRuntime 会把连续的 parallelSafe 调用合并为并发组，其余按序执行，保持顺序语义。
   */
  parallelSafe?: boolean
  /**
   * 该工具调用后是否**终止** loop（不再进入下一轮）。
   * 缺省/false = 继续 loop（拿到结果 → 下一轮，标准行为）。
   * true = 收尾型工具（如 todo_finish）。
   * 规则：一轮内若**所有**被调工具都是 endsLoop，则结束 loop；只要有一个非 endsLoop 工具就继续。
   */
  endsLoop?: boolean
  /**
   * 该工具是否**阻塞** loop 等待真实结果。
   * 缺省/true = 阻塞（标准行为，loop 等工具返回后才进下一轮）。
   * false = 非阻塞（fire-and-forget 后台任务，如启动开发服务器、监听文件变化）：
   *   - runtime 立即提交占位 tool_result（"后台执行中"），不等待真实结果
   *   - loop 直接进入下一轮
   *   - 真实结果通过 StreamEvent 异步上报（如果工具支持）
   */
  blocking?: boolean
  /**
   * 该工具的执行超时时间（毫秒）。0 = 无超时。
   * 未设置时使用 ToolExecutor 的 defaultTimeoutMs（默认 0 = 无超时）。
   * 工具可自行覆盖，如 search_internet 可设 30_000（搜索不宜太久），
   * use_terminal 可设 0（命令可能跑很久）。
   */
  timeoutMs?: number
}
export interface ToolContext {
  sessionId: string
  projectRoot: string
  promptRoot: string
  sandboxRoot: string
  sandboxMode: string
  agentName: string
  agentMode: string
  pluginSettings: Record<string, unknown>
  workingDir: string
  /**
   * 路径沙箱（project/task subagent 由 runtime 注入）。
   * 文件工具走 resolveToolPath(ctx, path) 强制执行；无此字段时等同旧 single-root 行为。
   */
  pathGuard?: {
    mode: "inherit" | "hard" | "audit"
    roots: string[]
    auditRoots?: string[]
  }
  /** 工具输出压缩级别：off=不压；normal=保守(默认)；aggressive=更激进。由 AgentRuntime 从 agent.json 注入。 */
  compressionLevel?: "off" | "normal" | "aggressive"
  /**
   * maou 根目录（通常 ~/.maou）。由 AgentRuntime 注入。
   * use_skill / find_skill 等据此扫描全局 skills，勿用 sandboxRoot 顶替。
   */
  maouRoot?: string
  /**
   * Skill 扫描选项（Agent 层 skillOptions）。
   * includeSystemNpmSkills 默认 true → 扫描 ~/.agents/skills 等。
   */
  skillOptions?: {
    includeSystemNpmSkills?: boolean
    extraDirs?: string[]
    enabledSkills?: string[]
  }
  /**
   * 子 Agent 真并行执行器（由 AgentRuntime 注入；harness 提供 runFn）。
   *
   * agent_message 工具调此函数 fork 子 Agent 执行独立任务。
   * 缺省（undefined）→ agent_message 退回原 stub 行为（"暂未开放"）。
   */
  subagentExecutor?: SubagentExecutorLike
  /**
   * 调用主 Agent（监督模式专用）—— 由 harness 注入。
   *
   * supervisor_chat_main 工具调此函数把消息派给主 Agent，
   * 主 Agent 执行一轮 loop 后把最终输出通过 AsyncGenerator yield 事件，
   * 最后 return 主 Agent 的最终文本输出。
   *
   * 缺省（undefined）→ supervisor_chat_main 工具返回错误。
   */
  callMainAgent?: (message: string, abortSignal?: AbortSignal) => AsyncGenerator<StreamEvent, string>
  /**
   * 当前 session 是否处于监督模式（由 AgentRuntime 注入）。
   * supervisor 工具据此判断调用上下文是否合法。
   */
  isSupervisorSession?: boolean
  /**
   * 监督模式管理器（由 AgentRuntime 注入）。
   *
   * supervisor_task_control / supervisor_chat_main 工具通过它查询/更新绑定。
   * 用最小契约接口避免 tools → agent 的循环依赖；agent 包实现并注入 SUPERVISOR_MANAGER 单例。
   */
  supervisorManager?: SupervisorManagerLike
  /**
   * 辅助模型调用器（由 AgentRuntime 注入；harness 提供 AuxModelCaller）。
   *
   * llm_judge 工具调此函数让 agent 在循环中调用辅助 LLM 做判断
   * （安全检查 / 代码审查 / 路由判定 / 二次确认等）。
   *
   * 缺省（undefined）→ llm_judge 工具返回错误提示未启用。
   * 用最小契约接口避免 types → llm 的循环依赖；@little-house-studio/llm 的
   * AuxModelCaller 实现此契约，由 AgentRuntime 在 processToolCalls 中注入。
   */
  auxModelCaller?: AuxModelCallerLike
  /**
   * 当前 run 的主模型 preset（由 AgentRuntime 注入）。
   * llm_judge 工具在未单独配置辅助模型时回退用它调用主模型。
   */
  mainPreset?: unknown
  /**
   * 辅助模型 preset 解析函数（由 AgentRuntime 注入）。
   * 返回当前 agent 应使用的辅助模型 preset；未注入时 llm_judge 回退 mainPreset。
   */
  resolveHelperPreset?: (agentName: string, mainPreset: unknown) => unknown
  /**
   * 当前 agent 名称（由 AgentRuntime 注入）。
   * llm_judge 工具用它在调用 resolveHelperPreset 时传入。
   */
  runtimeAgentName?: string
  /**
   * yield 结果回调（由 SubagentExecutor.fork 注入到子 Agent 的 ToolContext）。
   *
   * 子 Agent 完成任务后调 yield 工具提交结构化结果，yield 工具通过此回调把
   * result + summary 上交给 fork；fork 检测到 yield 后结束子 Agent 循环。
   *
   * 仅在子 Agent 上下文中注入（主 Agent 为 undefined）。
   * yield 工具在未注入时返回错误提示（说明当前不是子 Agent 上下文）。
   * 用最小契约接口避免 types → tools 的循环依赖。
   */
  yieldResult?: (result: string, summary?: string) => void
  /**
   * Agent 间消息总线（由 AgentRuntime 注入 MessageBus 单例）。
   *
   * agent_manage 工具的 message/interrupt/insert action 通过它向队友投递消息
   * （带 from 说话人），主 Agent 循环通过 inbox 轮询收取。这是 agent 间通信的
   * 统一通道——替代原 TeamManager.sendMessage 的"入数组无消费端"实现。
   *
   * 缺省（undefined）→ agent_manage 退回原 TeamManager 内存队列行为。
   * 用最小契约接口避免 types → agent 的循环依赖。
   */
  messageBus?: MessageBusLike
}

/**
 * AuxModelCaller 的最小契约（types 包不依赖 llm 包）。
 * 真实实现见 @little-house-studio/llm 的 AuxModelCaller。
 *
 * llm_judge 工具通过此接口调用辅助模型做判断；runtime 负责把真实的
 * AuxModelCaller 实例注入到 ToolContext.auxModelCaller。
 */
export interface AuxModelCallerLike {
  callText(params: {
    preset: unknown
    systemPrompt: string
    userPrompt: string
    abortSignal?: AbortSignal
    context?: { sessionId?: string; tag?: string }
  }, fallbackPreset?: unknown): Promise<{
    content: string
    usage: unknown | null
    ok: boolean
    error?: string
    presetName: string
  }>
  callJson(params: {
    preset: unknown
    systemPrompt: string
    userPrompt: string
    abortSignal?: AbortSignal
    context?: { sessionId?: string; tag?: string }
  }, fallbackPreset?: unknown): Promise<{
    content: string
    usage: unknown | null
    ok: boolean
    error?: string
    presetName: string
    json: Record<string, unknown> | null
  }>
}

/**
 * SupervisorManager 的最小契约（types 包不依赖 agent 包）。
 * 真实实现见 @little-house-studio/agent 的 SUPERVISOR_MANAGER。
 */
export interface SupervisorManagerLike {
  getBySupervisor(supervisorSessionId: string): SupervisorBindingLike | undefined
  getByMain(mainSessionId: string): SupervisorBindingLike | undefined
  getByChat(chatKey: string): SupervisorBindingLike | undefined
  updateState(mainSessionId: string, state: SupervisorState): SupervisorBindingLike | undefined
  updatePlan(mainSessionId: string, plan: string): SupervisorBindingLike | undefined
  unbind(mainSessionId: string): SupervisorBindingLike | undefined
  isSupervisorSession(sessionId: string): boolean
  isSupervisorMode(mainSessionId: string): boolean
  list(): SupervisorBindingLike[]
}

export type SupervisorState =
  | "planning"
  | "confirming_plan"
  | "started"
  | "confirming"
  | "ended"

export interface SupervisorBindingLike {
  mainSessionId: string
  supervisorSessionId: string
  supervisorAgentName?: string
  mainAgentName?: string
  state: SupervisorState
  plan?: string
  createdAt: number
  chatKey?: string
  verifyRounds: number
  lastFailReason?: string
  sameReasonStreak: number
  lastVerifiedReportFingerprint?: string
  lastVerdict?: "pass" | "fail" | "loop"
}

/**
 * Agent 间消息总线的最小契约（types 包不依赖 agent 包）。
 * 真实实现见 @little-house-studio/agent 的 MessageBus。
 *
 * agent_manage 工具通过此接口向队友投递消息（带 from 说话人），
 * AgentRuntime 通过此接口轮询自己的 mailbox 收取队友消息。
 */
export interface MessageBusLike {
  /** 发送一条消息到目标 agent（非阻塞，带说话人 from）。 */
  send(to: string, body: string, from: string, opts?: { replyTo?: string }): { to: string; outcome: "delivered" | "buffered" | "failed"; error?: string }
  /** 排空（或 peek）目标 agent 的 mailbox。opts.peek=true 时只看不取。 */
  inbox(agentName: string, opts?: { peek?: boolean }): BusMessageLike[]
  /** 目标 agent 的未读消息数。 */
  unreadCount(agentName: string): number
  /** 广播到所有已知 agent。 */
  broadcast(body: string, from: string, opts?: { replyTo?: string }): { to: string; outcome: "delivered" | "buffered" | "failed"; error?: string }[]
  /** 注册一个 agent 名（使其可被 send/broadcast 命中）。 */
  register(agentName: string): void
  /** 注销一个 agent 名。 */
  unregister(agentName: string): void
}

/** 总线消息（说话人结构：from/to/body）。 */
export interface BusMessageLike {
  id: string
  from: string
  to: string
  body: string
  ts: number
  replyTo?: string
}

/**
 * SubagentExecutor 的最小契约（types 包不依赖 agent 包）。
 * 真实实现见 @little-house-studio/agent 的 SubagentExecutor。
 */
export interface SubagentExecutorLike {
  /** fork 单个子 Agent 执行任务。 */
  fork(taskId: string, task: string, options?: ForkOptions): Promise<SubagentResultLike>
  /** 并发 fork 一层 task（同层可并行）。 */
  forkLayer(tasks: Array<{ id: string; desc: string }>, options?: ForkOptions): Promise<SubagentResultLike[]>
}

/**
 * fork 子 Agent 时的选项。
 *
 * forkMode：
 *   - 'context_only'（默认）：子 Agent 继承主 Agent 的 agent 配置（同一个 agentName）
 *     仅 session 上下文独立（新 session、独立历史），agent 配置完全用主 Agent 的
 *   - 'context_and_config'：子 Agent 用独立 agent 配置
 *     必须传 agentName 指定使用哪个 agent（必须是 AgentRegistry 中已存在的 agent）
 *     若同时传 configOverrides，会创建临时 agent 文件（fork 自 agentName 配置 + 覆盖字段）
 *     临时 agent 仅对当前子 session 生效，子 session 结束后清理
 *
 * agentName：forkMode='context_and_config' 时必填
 * configOverrides：覆盖 agent.json 字段（如 system prompt / tool 白名单 / model 等）
 */
export interface ForkOptions {
  forkMode?: 'context_only' | 'context_and_config'
  /** 独立配置的 agent 名（forkMode='context_and_config' 时必填） */
  agentName?: string
  /**
   * Subagent 类型（agent 层四类模型）。
   * - fork：完整复制母 session 上下文
   * - helper：单轮无 tool；仅 persist 时进 Executor/管理列表
   * - task：专业子任务 + 独立/预设白名单
   * - project：路径驻扎小型 coding agent
   * 缺省：按既有 forkMode 行为（兼容旧调用）
   */
  kind?: 'fork' | 'helper' | 'task' | 'project'
  /**
   * 是否完整复制母 session 历史到子 session（fork 默认 true）。
   * runtime-facade 的默认 runFn 在 inheritFullContext=true 时完整复制母 session。
   */
  inheritFullContext?: boolean
  /**
   * helper 单轮时即使配置了 tools 也不下发给 AI（默认 true for helper）。
   */
  stripToolsIfSingleRound?: boolean
  /**
   * 是否持久化上下文（helper 默认 false；仅 true 时进 SubagentExecutor 管理列表）。
   * kind=helper 且 persistContext=false 时 fork 会拒绝（应走 AuxModelCaller）。
   */
  persistContext?: boolean
  /** 是否 multi-round loop（helper 默认 false） */
  enableLoop?: boolean
  /** 显式工具白名单；null/不填时按 kind 预设或继承母 */
  tools?: string[] | null
  /**
   * task/project 工具预设名：
   * explore | web_search | report | file_search | coding_scoped | none
   */
  toolPreset?: string
  /** 权限档位（见 agent 层 SubagentPermission） */
  permission?: string
  /** 轮次上限；>0 时映射 softRequestBudget；超限 wrap-up */
  roundLimit?: number
  /** 子工程驻扎路径（project 建议必填） */
  path?: string
  /** 路径外额外审核路径列表（project） */
  auditPaths?: string[]
  /** 临时覆盖 agent.json 字段（创建临时 agent 文件，子 session 结束清理） */
  configOverrides?: Record<string, unknown>
  /** 中断信号 */
  abortSignal?: AbortSignal
  /**
   * 当前递归深度（0 = 顶层父 Agent 直接 fork 子 Agent）。
   * 由 runtime/executor 内部维护并向下传递；调用方通常无需显式设置。
   * 到达 maxRecursionDepth 时 fork 被拒绝。
   */
  taskDepth?: number
  /**
   * 最大递归深度（默认 2）。
   * 子 Agent 再 fork 子 Agent 的层数上限。例如 maxRecursionDepth=2 表示
   * 父→子→孙 三层，孙再 fork 会被拒绝。
   * 0 = 禁止任何 fork（fork 自身即拒绝）。
   */
  maxRecursionDepth?: number
  /**
   * 本次 fork 的软请求预算（覆盖 executor 构造时的 defaultSoftRequestBudget）。
   * 超过后注入 wrap-up 提示，超过 1.5x 强制 abort。缺省 = 用 executor 默认值（90）。
   */
  softRequestBudget?: number
  /**
   * 本次 fork 的 wall-clock 超时（毫秒，覆盖 executor 构造时的 defaultMaxRuntimeMs）。
   * 超时后 abort。缺省 = 用 executor 默认值（0=禁用）。
   */
  maxRuntimeMs?: number
  /**
   * 进度回调（P1-6）。fork 执行期间周期性上报子 Agent 进度。
   * 调用方可通过此回调实时观察子 Agent 的工具调用 / token / 输出。
   */
  onProgress?: (progress: AgentProgress) => void
  /**
   * 是否继承父 Agent 的 MCP 工具（P2-4，默认 true）。
   *
   * true（默认）：fork 时把父 Agent 的 MCP 工具列表包装成 proxy 工具传给子 Agent，
   *   子 Agent 调用 proxy 工具时转发给父 Agent 的 MCP 连接（不重建连接）。
   * false：子 Agent 不继承父 Agent 的 MCP 工具（子 Agent 自己建连或无 MCP）。
   *
   * 父 Agent 的 MCP 工具列表通过 SubagentExecutor 的 parentMcpTools 字段注入
   * （由 harness/AgentRuntime 在装配 executor 时传入）。proxy 工具通过 runFn
   * 的 options.mcpProxyTools 传给子 Agent 运行时注册。
   */
  inheritMcp?: boolean
  /**
   * 是否在 git worktree 隔离环境里运行子 Agent（P2-2，默认 false）。
   *
   * true 时，SubagentExecutor.fork 会先调 IsolationRunner.createWorktree()
   * 创建一个独立 worktree，把子 Agent 的 projectRoot 设为 worktree 路径，
   * 让子 Agent 对工作区的改动与主工作区完全隔离。
   * 子 Agent 结束后，executor 根据 mergeBack/patchBack 选项决定如何回收改动：
   *   - 两者都未设 → removeWorktree（改动丢弃）
   *   - mergeBack=true → merge 回主分支后 removeWorktree
   *   - patchBack=true → 生成 patch 文件后 removeWorktree
   *
   * 仅对 forkMode='context_only' 有意义（子 Agent 继承主配置，但工作区隔离）；
   * 非 git 仓库下 isolated 会被忽略（降级为非隔离）。
   */
  isolated?: boolean
  /**
   * worktree 隔离的基线分支（P2-2，默认 "HEAD"）。
   * 仅 isolated=true 时生效。指定 worktree 的起点分支/commit。
   */
  isolationBaseBranch?: string
  /**
   * 隔离 worktree 结束后是否 merge 回主分支（P2-2，默认 false）。
   * 仅 isolated=true 时生效。true → mergeBack；false 且 patchBack 也未设 → removeWorktree。
   */
  mergeBack?: boolean
  /**
   * 隔离 worktree 结束后是否生成 patch 文件（P2-2，默认 false）。
   * 仅 isolated=true 且 mergeBack=false 时生效。
   */
  patchBack?: boolean
  /**
   * 是否后台 detached 运行子 Agent（P2-3，默认 false）。
   *
   * true 时，父 Agent 的 agent_message 工具调用立即返回（不阻塞等待子 Agent 完成），
   * fork 返回一个 taskId，父 Agent 可通过 agent_manage list 或 EventBus 查进度。
   * 子 Agent 后台运行，结果通过 SUBAGENT_EVENT_BUS 异步上报（lifecycle: fork_end）。
   *
   * detached=true 时 fork 返回的 SubagentResultLike.output 为占位提示（"已后台启动"），
   * ok=true，真实结果异步到达。
   */
  detached?: boolean
  /**
   * 输出 JSON Schema（P2-1）。用于校验子 Agent yield 提交的 result。
   *
   * 设置后，fork 会在子 Agent 调 yield 时用此 schema 校验 result：
   *   - result 是字符串：尝试 JSON.parse 后校验；解析失败则要求子 Agent 重新 yield
   *   - 校验通过 → fork 接受结果并结束子 Agent
   *   - 校验失败 → fork 注入错误反馈让子 Agent 重试（最多 MAX_YIELD_RETRIES 次）
   * 缺省（undefined）→ 不校验，yield 即接受。
   */
  outputSchema?: Record<string, unknown>
}

/**
 * 子 Agent 执行进度快照（P1-6 进度追踪）。
 *
 * fork 执行期间由 SubagentExecutor 从 runFn 的事件流里提取并上报，
 * 通过 ForkOptions.onProgress 回调送给调用方（不阻塞主流程）。
 */
export interface AgentProgress {
  /** 子 Agent taskId */
  taskId: string
  /** 子 sessionId */
  subSessionId: string
  /** 当前正在执行（或最近一次执行）的工具名 */
  currentTool?: string
  /** 最近 N 条工具调用记录（name + ok） */
  recentTools?: Array<{ name: string; ok: boolean }>
  /** 最近一条 assistant 文本输出（截断） */
  recentOutput?: string
  /** 累计 token 用量（input + output） */
  tokens?: number
  /** LLM 请求轮数（agent_round 计数） */
  requests?: number
  /** 累计费用估算（美元） */
  cost?: number
  /** 已运行毫秒数 */
  elapsedMs?: number
}

export interface SubagentResultLike {
  taskId: string
  subSessionId: string
  output: string
  ok: boolean
  error?: string
  elapsedMs: number
  /** 累计 token 用量（P1-2） */
  tokens?: number
  /** LLM 请求轮数（P1-2） */
  requests?: number
  /** 是否被中断（P1-2：超时/预算超限/runtime abort） */
  aborted?: boolean
  /** 中断原因（P1-2：'timeout' | 'budget' | 'abort_signal' | ...） */
  abortReason?: string
  /**
   * 子 Agent 通过 yield 工具提交的结构化结果（P2-1）。
   *
   * fork 结束后，若子 Agent 调过 yield 工具，此字段为子 Agent 提交的 result 原文；
   * 否则 undefined（output 字段仍为子 Agent 的最终 assistant 文本）。
   * 父 Agent 可据此拿到结构化产出，而非解析自然语言输出。
   */
  yieldedResult?: string
  /** yield 提交的简短摘要（P2-1，子 Agent 调 yield 时附带的 summary）。 */
  yieldedSummary?: string
  /**
   * yield 校验状态（P2-1）。
   * - 'passed'：通过 outputSchema 校验
   * - 'failed'：校验失败且重试次数耗尽（结果仍 salvage 返回）
   * - 'no_yield'：子 Agent 未调 yield 工具
   * - 'no_schema'：未设 outputSchema，yield 即接受
   */
  yieldStatus?: 'passed' | 'failed' | 'no_yield' | 'no_schema'
}

/**
 * MCP 工具描述符（P2-4）。
 *
 * 描述父 Agent 持有的一个 MCP 工具，用于 fork 时包装成子 Agent 可用的 proxy 工具。
 * 由 harness/AgentRuntime 从已建立的 MCP 连接中提取（连接名 + 工具 schema），
 * 注入到 SubagentExecutor.parentMcpTools。
 */
export interface McpToolDescriptor {
  /** proxy 工具名（注册到子 Agent 的 ToolRegistry）。建议 mcp__<conn>__<tool>。 */
  name: string
  /** 工具描述（来自 MCP server listTools） */
  description: string
  /** 工具参数 JSON Schema（来自 MCP server listTools） */
  parameters: JsonSchema
  /** 来源 MCP 连接名 */
  connectionName: string
  /** 原始 MCP 工具名（MCP server 端的真实名，可能与 name 不同） */
  originalName: string
}

/**
 * MCP 工具调用器（P2-4）。
 *
 * proxy 工具执行时调此函数把调用转发给父 Agent 的 MCP 连接。
 * harness/AgentRuntime 注入真实实现（调用 McpClient.callTool）。
 * 缺省（undefined）→ proxy 工具返回错误提示 MCP 未连接。
 */
export interface McpToolInvoker {
  /**
   * 转发工具调用到父 Agent 的 MCP 连接。
   * @param connectionName MCP 连接名
   * @param toolName MCP server 端工具名
   * @param args 工具参数
   * @returns 工具响应文本（或错误信息）
   */
  (connectionName: string, toolName: string, args: Record<string, unknown>): Promise<string>
}

export interface ToolResponse {
  ok: boolean
  message: string
  displayEvents: Record<string, unknown>[]
  payload: Record<string, unknown>
  background: boolean
  images: { mimeType: string; data: string }[]
}
export interface ToolCall {
  id: string
  name: string
  parameters: Record<string, unknown>
}
export interface ToolResult {
  toolCallId: string
  name: string
  output: string
  success: boolean
  error: string
  elapsed: number
}
export interface StreamEvent {
  type: string
  content?: string
  delta?: string
  round?: number
  message?: string
  session?: Session
  tool?: ToolCall | { name: string }
  ok?: boolean
  usage?: Record<string, unknown>
  [key: string]: unknown
}

// ─── LLM 配置类型（@deprecated 权威定义在 @little-house-studio/llm；此处保留供 AppConfig 用）──
/** @deprecated 用 @little-house-studio/llm 的 APIPreset */
export type LLMProtocol = 'openai' | 'anthropic' | 'openai-responses'
/** @deprecated */
export type StructuredOutputMode = 'json_object' | 'json_schema'
/** @deprecated 用 @little-house-studio/llm 的 APIPreset */
export interface LLMPreset {
  name: string
  url: string
  key: string
  model: string
  maxTokens: number
  maxContext?: number
  protocol: LLMProtocol
  stream: boolean
  supportsVision: boolean
  supportsReasoning: boolean
  nativeToolCalling: boolean
  nativeStructuredOutput: boolean
  structuredOutputMode?: StructuredOutputMode
  reasoningParams?: Record<string, unknown>
}
/** @deprecated 用 @little-house-studio/llm 的 LLMUsage */
export interface LLMUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
}
/** @deprecated 用 @little-house-studio/llm 的 Pricing */
export interface Pricing {
  inputPrice: number
  outputPrice: number
  cacheHitPrice: number
  currency: string
}
/** @deprecated 用 @little-house-studio/llm 的 ModelCallResult */
export interface ModelCallResult {
  rawResponse: string
  content: string
  parsed: Record<string, unknown>
  retryIndex: number
  validationError: string
  attemptDiagnostics: Record<string, unknown>[]
  nativeToolCalls: Record<string, unknown>[]
  usage?: LLMUsage
  rawRequest?: Record<string, unknown>
  rawResponseData?: Record<string, unknown>
  rawSseEvents: string[]
}

// ─── 应用配置类型 ───────────────────────────────────────────────────────────
export interface AgentConfig {
  name: string
  role?: string
  label?: string
  description?: string
  permissions?: Record<string, unknown>
  outputSpec?: Record<string, unknown>
}
export interface ContextSettings {
  thresholdPercent: number
  keepRecentPercent: number
}
export interface PluginSettings {
  plugins?: Record<string, { enabled: boolean }>
  signalRender?: { imagePath?: string; imageFit?: string }
  [key: string]: unknown
}
export interface SecurityConfig {
  /**
   * 终端/工具沙箱模式（与 CLI 审批 mode 相关，常见值）：
   * - normal：危险命令可走审批
   * - auto：策略自动放行部分命令
   * - yolo：尽量不拦终端
   * - sandbox / strict / isolated：命令落到隔离 sandboxRoot
   */
  sandboxMode: string
  /** 危险终端命令是否要求用户审批（normal 模式下尤甚） */
  dangerousCommandsRequireApproval: boolean
  allowedHosts?: string[]
  blockedCommands?: string[]
}

/**
 * 按用途绑定 preset：值为 preset 的 name，或 presets 数组下标。
 * 全系列产品共用；未配置的角色回退到 main / defaultPreset。
 */
export interface ApiModelRoles {
  /** 主对话 / agent loop */
  main?: string | number
  /** 快速/便宜：压缩、分类、简单判定 */
  fast?: string | number
  /** 多模态看图 */
  vision?: string | number
  /** 辅助（loop 检测、llm_judge 等）；未设则用 helperPreset → fast → main */
  helper?: string | number
  /** 允许扩展自定义角色 */
  [role: string]: string | number | undefined
}

export interface ApiConfig {
  presets: LLMPreset[]
  defaultPreset: number
  /**
   * 全局辅助模型 preset 索引（可选，兼容旧配置）。
   * 优先使用 roles.helper；再 helperPreset；再 main。
   * 优先级：agent.json helperModel > roles.helper > helperPreset > main
   */
  helperPreset?: number
  /**
   * 模型角色映射（推荐）。
   * 例：{ "main": 0, "fast": "cheap-qwen", "vision": "gpt-4o" }
   */
  roles?: ApiModelRoles
  agentRoundLimit: number
  contextSettings: ContextSettings
  pluginSettings?: PluginSettings
}
export interface AppConfig {
  api: ApiConfig
  security?: SecurityConfig
  ui?: Record<string, unknown>
}
export interface HealthResponse {
  ok: boolean
  uptime: number
  sessionsCount: number
  diskUsagePct: number
  version: string
}
export interface PromptNode {
  path: string
  content: string
  children: PromptNode[]
}
export interface CompiledPrompt {
  system: string
  roles: Record<string, string>
  tree: PromptNode
}
export interface ParsedResponse {
  content: string
  toolCalls: ToolCall[]
  structuredOutput?: Record<string, unknown>
  reasoning?: string
}
export type EventType =
  | 'message:user' | 'message:assistant' | 'message:system' | 'message:tool'
  | 'session:create' | 'session:destroy' | 'tool:call' | 'tool:result'
  | 'stream:start' | 'stream:delta' | 'stream:end' | 'stream:error'
  | 'agent:start' | 'agent:stop' | 'config:reload' | 'error'
export type EventHandler = (event: StreamEvent) => void

// ─── 运行时：配置管理 / 项目管理 / 工具函数 / 表情检测（原 core 包）──────────
export { ConfigStore } from './config-store.js'
export {
  MAOU_DIR_NAME,
  MAOU_CONFIG_FILE,
  resolveUserMaouRoot,
  resolveUserConfigPath,
  resolveUserThemesDir,
  resolveUserAgentsDir,
  resolveUserHistoryPath,
  resolveUserLastSessionPath,
  resolveProjectMaouRoot,
  resolveProjectSessionsDir,
} from './maou-paths.js'
export {
  findPresetByRef,
  resolveApiRolePreset,
  listConfiguredApiRoles,
} from './api-roles.js'
export type { ApiModelRole, PresetRef } from './api-roles.js'
export { getProjectsList, addProject, removeProject, autoDiscover } from './project-manager.js'
export type { ProjectEntry, ProjectListItem } from './project-manager.js'
export {
  MAOU_VERSION,
  isWithinPath,
  coerceBool,
  escapeHtml,
  nowIso,
  isConnectionError,
  DEFAULT_PORT,
  MAX_BODY_SIZE,
  MAX_FILE_PROXY_SIZE,
  URL_PROXY_TIMEOUT_MS,
  SSE_PING_INTERVAL_MS,
  DEFAULT_HOST,
} from './utils.js'
export { detectExpression } from './expression.js'
export { Profiler } from './profiler.js'
export type { SpanRecord, SpanSummary, ProfileReport } from './profiler.js'
