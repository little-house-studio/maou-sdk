# Maou SDK 术语表

> 本文件汇总 SDK 全部包的专有名词、核心类、接口、函数、概念术语，每条按 `英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径（相对 SDK 根）` 五列给出。同概念多文件出现仅列首次定义处，跨包同名概念各自保留并注明所在包。

## 目录

- [1. types + llm 包](#1-types--llm-包)
  - [1.1 A-C](#11-a-c)
  - [1.2 D-F](#12-d-f)
  - [1.3 G-I](#13-g-i)
  - [1.4 J-L](#14-j-l)
  - [1.5 M-O](#15-m-o)
  - [1.6 P-R](#16-p-r)
  - [1.7 S-U](#17-s-u)
  - [1.8 V-Z](#18-v-z)
- [2. tools + terminal-engine 包](#2-tools--terminal-engine-包)
  - [2.1 A-C](#21-a-c)
  - [2.2 D-F](#22-d-f)
  - [2.3 G-I](#23-g-i)
  - [2.4 J-L](#24-j-l)
  - [2.5 M-O](#25-m-o)
  - [2.6 P-R](#26-p-r)
  - [2.7 S-U](#27-s-u)
  - [2.8 V-Z](#28-v-z)
- [3. context + prompt 包](#3-context--prompt-包)
  - [3.1 A-C](#31-a-c)
  - [3.2 D-F](#32-d-f)
  - [3.3 G-I](#33-g-i)
  - [3.4 J-L](#34-j-l)
  - [3.5 M-O](#35-m-o)
  - [3.6 P-R](#36-p-r)
  - [3.7 S-U](#37-s-u)
  - [3.8 V-Z](#38-v-z)
- [4. agent + coding-agent 包](#4-agent--coding-agent-包)
  - [4.1 A-C](#41-a-c)
  - [4.2 D-F](#42-d-f)
  - [4.3 G-I](#43-g-i)
  - [4.4 J-L](#44-j-l)
  - [4.5 M-O](#45-m-o)
  - [4.6 P-R](#46-p-r)
  - [4.7 S-U](#47-s-u)
  - [4.8 V-Z](#48-v-z)
- [5. hub + cli + 其他引擎包](#5-hub--cli--其他引擎包)
  - [5.1 A-C](#51-a-c)
  - [5.2 D-F](#52-d-f)
  - [5.3 G-I](#53-g-i)
  - [5.4 J-L](#54-j-l)
  - [5.5 M-O](#55-m-o)
  - [5.6 P-R](#56-p-r)
  - [5.7 S-U](#57-s-u)
  - [5.8 V-Z](#58-v-z)

---

## 1. types + llm 包

`core/types/src/`（6 文件：index / config-store / expression / profiler / project-manager / utils）+ `core/llm/src/`（41 文件：顶层 24 + adapters/ 15 + oauth/ 8 + protocol/ 6 + registry/ 4 + image/ 1 + tools/ 1）。

### 1.1 A-C

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| account.ts:queryBalance | 余额查询 | 查询厂商剩余 API 余额 | 账户能力扫描/额度监控 | core/llm/src/account.ts |
| account.ts:scanModels | 模型扫描 | 跨协议拉取厂商可用模型列表 | 配置向导/模型发现 | core/llm/src/account.ts |
| AdapterMap | 适配器映射表 | 协议名→适配器工厂的全局映射 | 协议路由内部 | core/llm/src/adapters/router.ts |
| addProject | 添加项目 | 把项目注册到 ~/.maou/projects.json | 项目清单管理 | core/types/src/project-manager.ts |
| AgentConfig | Agent 配置 | 单个 agent 的元数据（name/role/permissions/outputSpec） | agent 定义文件解析 | core/types/src/index.ts |
| agentLoop | agentLoop 循环 | LLM 层内置的极简"调模型→执行工具→续跑"循环 | SDK 用户快速搭 agent | core/llm/src/agent-loop.ts |
| AgentLoopAnyTool | agentLoop 工具联合 | 朴素工具或 TypeBox 类型安全工具的并集 | agentLoop 入参类型 | core/llm/src/agent-loop.ts |
| AgentLoopContext | agentLoop 上下文 | 钩子可读写的当前步上下文（step/messages/toolCallCount） | 循环钩子注入 | core/llm/src/agent-loop.ts |
| AgentLoopEvent | agentLoop 事件 | 循环对外 yield 的事件（text/toolCall/step 等） | 流式接收 agent 输出 | core/llm/src/agent-loop.ts |
| AgentLoopHooks | agentLoop 钩子 | shouldContinue/beforeStep/onModelResponse 等可选钩子 | 自定义循环策略 | core/llm/src/agent-loop.ts |
| AgentLoopParams | agentLoop 参数 | preset/tools/prompt/maxSteps/stream 等入参 | 启动 agentLoop | core/llm/src/agent-loop.ts |
| AgentLoopResult | agentLoop 结果 | 循环结束返回的汇总（messages/stopReason/usage） | 取最终结果 | core/llm/src/agent-loop.ts |
| AgentLoopStepResult | 单步结果 | 一轮模型+工具的结果快照 | afterStep 钩子入参 | core/llm/src/agent-loop.ts |
| AgentLoopStopReason | 停止原因 | done/max_steps/aborted/error | 终止判定 | core/llm/src/agent-loop.ts |
| AgentLoopTool | 朴素工具 | 不依赖 TypeBox 的工具定义（name+parameters+execute） | agentLoop 工具注册 | core/llm/src/agent-loop.ts |
| ApiConfig | API 配置 | LLM 预设/role 路由/上下文设置等应用级配置 | ~/.maou/config.json 的 api 段 | core/types/src/index.ts |
| APIPreset | API 预设 | 模型+url+key+protocol 等调用配置 | LLMClient/ChatSession 入参 | core/llm/src/adapters/types.ts |
| APIProtocol | API 协议 | openai/anthropic/responses/google/... 等枚举 | 协议路由 | core/llm/src/adapters/types.ts |
| AppConfig | 应用配置 | 顶层配置（api/security/ui 三段） | ConfigStore 校验根 schema | core/types/src/index.ts |
| AnthropicCompat | Anthropic 兼容标志 | 急流式/长缓存/cache_control 等适配开关 | Anthropic 系代理适配 | core/llm/src/adapters/compat.ts |
| AnthropicMessagesAdapter | Anthropic Messages 适配器 | 实现 Claude Messages API 的协议适配器 | 接 Anthropic 模型 | core/llm/src/adapters/anthropic.ts |
| applyOAuthToPreset | 注入 OAuth 令牌 | 把订阅 token 填进 preset 并打 oauth 标记 | 订阅登录后调用 | core/llm/src/oauth/index.ts |
| AssistantMessage | 助手消息 | 含 thinking+文本+工具调用的富 assistant 消息 | stream/complete 跨厂商交接 | core/llm/src/stream.ts |
| assistantTurnToText | 助手轮次转文本 | 把富 assistant 轮次压成跨厂商文本 | 跨厂商 handoff | core/llm/src/handoff.ts |
| Attachment | 附件 | image/video/audio/document 的 base64 多模态附件 | ChatSession.send 携带 | core/llm/src/chat-session.ts |
| attemptDiagnostics | 重试诊断 | 每次重试的诊断记录数组 | 调试/JSON 验证回溯 | core/llm/src/caller.ts |
| AuthorizeRequest | 授权请求 | OAuth start 阶段产出的 url+state+codeVerifier | 订阅登录两步流程 | core/llm/src/oauth/types.ts |
| autoDiscover | 自动发现项目 | 扫描 .maou/ 子目录补入项目清单 | 项目初始化向导 | core/types/src/project-manager.ts |
| AzureOpenAIAdapter | Azure OpenAI 适配器 | 委托 OpenAI 逻辑、仅改认证头/URL | 接 Azure 部署 | core/llm/src/adapters/azure-openai.ts |
| base.ts:base 入口 | 按需注册入口 | 不自动注册适配器、tree-shake 友好的子入口 | 浏览器/边缘打包 | core/llm/src/base.ts |
| BalanceResult | 余额查询结果 | supported/balance/currency/used | 账户能力展示 | core/llm/src/account.ts |
| base64url | base64url 编码 | 去 padding、+/ 替换为-_ 的 URL 安全编码 | PKCE 编码 | core/llm/src/oauth/pkce.ts |
| BASE_RETRY_DELAY | 重试基础延迟 | 指数退避基数（1 秒） | LLMClient 退避 | core/llm/src/client.ts |
| BEDROCK_EVENTSTREAM_CONTENT_TYPE | Bedrock 流式 content-type | application/vnd.amazon.eventstream 标识 | Bedrock 二进制流分流 | core/llm/src/client.ts |
| BedrockAdapter | Bedrock 适配器 | AWS Converse API 适配器，含 SigV4 签名 | 接 Bedrock 上的 Claude/Llama | core/llm/src/adapters/bedrock.ts |
| buildParamGuards | 构建参数守卫 | 从工具注册表派生参数校验规则 | 工具调用前修补 | core/llm/src/caller.ts |
| buildValidationDiagnostic | 构建校验诊断 | 汇总 JSON 校验失败的字段/原因/修复 | JSON 验证回溯 | core/llm/src/protocol/json-validation.ts |
| BuildDiagnosticOptions | 诊断构建选项 | extractedJsonText/data/repairInfo 等输入 | buildValidationDiagnostic 入参 | core/llm/src/protocol/json-validation.ts |
| buildRequest | 预览请求 | 不发网络、构造 url/headers/body | ChatSession 调试 | core/llm/src/chat-session.ts |
| CacheControl | 缓存控制 | ephemeral/1h TTL 的 Anthropic cache_control 标记 | Anthropic Prompt Caching | core/llm/src/adapters/anthropic.ts |
| caller.ts:ModelCaller | 模型调用管道 | 封装流式/非流式+JSON 校验+重试 | AgentRuntime 中层调用 | core/llm/src/caller.ts |
| CallerStreamEvent | 调用器流事件 | type+data 的流式事件壳 | AgentRuntime 消费 | core/llm/src/caller.ts |
| CATALOG | 内置模型目录 | 撰写时各厂商公开价的种子数据 | registry 初始化 | core/llm/src/registry/catalog.ts |
| ChatDelta | 聊天流式增量 | delta/thinking/tool_call/field_complete 等类型 | sendStream yield | core/llm/src/chat-session.ts |
| ChatMessage | 聊天消息 | role+content+attachments+toolCalls+usage | ChatSession 历史元素 | core/llm/src/chat-session.ts |
| ChatResponse | 聊天响应 | send 返回的 content+toolCalls+usage | 非流式对话 | core/llm/src/chat-session.ts |
| ChatSession | 对话会话 | 高层入口，组合 LLMClient+ModelCaller | 99% 场景的对话入口 | core/llm/src/chat-session.ts |
| checkContextFit | 上下文契合检查 | ok/needCompress/overflow 三态判定 | 压缩阈值决策 | core/llm/src/token-count.ts |
| clampEffortLevel | effort 级别 clamp | 把级别限制到 [min,max] 区间 | compat 适配思考范围 | core/llm/src/reasoning.ts |
| classifyError | 错误分类 | network/timeout/rate_limit/auth 等推断 | POST 日志归类 | core/llm/src/post-logger.ts |
| clearAdapters | 清空适配器注册表 | 测试用清理 | 单元测试 | core/llm/src/adapter-registry.ts |
| clearFauxProviders | 清空 Faux | 移除全部 mock 响应 | 测试隔离 | core/llm/src/faux.ts |
| clearProviders | 清空 provider 注册 | 测试用清空 registry | 单元测试 | core/llm/src/registry/index.ts |
| clearTokens | 清除令牌 | 删除某 provider 的 OAuth 令牌 | 注销登录 | core/llm/src/oauth/store.ts |
| CLAUDE_CODE_TOOL_MAP | Claude Code 工具映射表 | 本项目名→Bash/Read/Edit 等 16 条 | Stealth Mode 默认表 | core/llm/src/stealth.ts |
| CloudflareAdapter | Cloudflare 适配器 | Workers AI 适配器，替换 {CLOUDFLARE_ACCOUNT_ID} | 接 Cloudflare Workers AI | core/llm/src/adapters/cloudflare.ts |
| coerceBool | 安全布尔解析 | true/"1"/"yes"/数字→布尔 | 配置文件读取 | core/types/src/utils.ts |
| coerceText | 文本强转 | string/string[]/{text}/{content} 统一为 string | 适配器解析多形态响应 | core/llm/src/adapters/shared.ts |
| collectSSE | 收集 SSE | 把流收集成数组的工具 | 测试/批量 | core/llm/src/sse.ts |
| CompiledPrompt | 编译后提示 | system+roles+tree 的编译产物 | PromptCompiler 输出 | core/types/src/index.ts |
| CompressedBody | 压缩载体 | gzip+base64 自描述结构 | POST 日志存原始 body | core/llm/src/raw-codec.ts |
| complete | 一次性完成 | 调模型返回完整 AssistantMessage | 非流式调用 | core/llm/src/stream.ts |
| completeAnthropicLogin | 完成 Anthropic 登录 | 用 code 换 token 第二步 | 订阅登录流程 | core/llm/src/oauth/anthropic.ts |
| completeApiUrl | 补全 API URL | 按协议补全 /v1/messages 等路径 | LLMClient 构建请求 | core/llm/src/adapters/types.ts |
| completeGeminiCliLogin | 完成 Gemini 登录 | 换 token 第二步 | Gemini CLI 订阅 | core/llm/src/oauth/google.ts |
| completeOpenAICodexLogin | 完成 Codex 登录 | 换 token 第二步 | ChatGPT 订阅登录 | core/llm/src/oauth/openai-codex.ts |
| computeCost | 计算成本 | 按 usage+pricing 算 input/output/cache 花费 | getTotalUsage 成本统计 | core/llm/src/compute-cost.ts |
| ConcurrencyLimiter | 并发限制器 | 信号量实现的同时最多 N 个请求 | 多用户并发保护 | core/llm/src/rate-limit.ts |
| ConfigStore | 配置存储 | 用户级+项目级 JSONC 深合并+Zod 校验 | 启动时加载应用配置 | core/types/src/config-store.ts |
| ConnectionTestResult | 连接测试结果 | ok/model/latencyMs | PresetManager.testConnection | core/llm/src/chat-session.ts |
| Context | 会话上下文 | systemPrompt+messages+tools 的扁平结构 | stream/complete 入参 | core/llm/src/stream.ts |
| ContextSettings | 上下文设置 | thresholdPercent+keepRecentPercent | 压缩阈值配置 | core/types/src/index.ts |
| CostBreakdown | 成本明细 | inputCost/outputCost/cacheSavings/totalCost | 成本统计返回 | core/llm/src/compute-cost.ts |
| createProxyFetch | 创建代理 fetch | 走 http_proxy 的 fetch 包装 | 企业代理出口 | core/llm/src/proxy.ts |
| createStealthMapper | 创建伪装映射器 | 工具名↔Claude Code 名可逆映射 | Stealth Mode | core/llm/src/stealth.ts |
| createWebSocketFetch | 创建 WS fetch | 把 WebSocket 适配成 SSE fetch | WebSocket 协议接入 | core/llm/src/transport.ts |
| CustomPreset | 自定义预设 | 用户层面向配置文件的模型配置 | LLMConfig 持久化 | core/llm/src/llm-config.ts |
| CustomProvider | 自定义厂商 | 持久化的厂商配置 | LLMConfig 文件结构 | core/llm/src/llm-config.ts |

### 1.2 D-F

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| decodePostLogEntry | 解码 POST 日志条目 | 从压缩载体还原单条 POST 记录 | 日志读取 | core/llm/src/raw-codec.ts |
| decodeRawBody | 解码原始 body | gzip+base64 还原为字符串 | POST 日志读取 | core/llm/src/raw-codec.ts |
| decodeRawBodyAsObject | 解码为对象 | 还原并 JSON.parse 为对象 | 日志解析 | core/llm/src/raw-codec.ts |
| deepMerge | 深度合并 | source 覆盖 target 的递归合并 | ConfigStore 合并用户/项目配置 | core/types/src/config-store.ts |
| DEFAULT_API_VERSION | 默认 api-version | Azure API 版本默认 "2024-10-21" | Azure URL 拼接 | core/llm/src/adapters/azure-openai.ts |
| DEFAULT_CONFIG_PATH | 默认配置路径 | ~/.maou/llm-config.json | LLMConfig 默认位置 | core/llm/src/llm-config.ts |
| DEFAULT_HOST | 默认监听地址 | "127.0.0.1" | 服务监听默认 | core/types/src/utils.ts |
| DEFAULT_PORT | 默认端口 | 8099 | Harness 服务端口 | core/types/src/utils.ts |
| DEFAULT_REGION | 默认区域 | Bedrock 默认 us-east-1 | Bedrock 签名 | core/llm/src/adapters/bedrock.ts |
| deriveJsonSettings | 派生 JSON 设置 | 从 OUTPUT.jsonc 文本派生 JsonSettings | Prompt 编译阶段一次性 | core/llm/src/protocol/json-schema.ts |
| detectCompat | 检测兼容 | 按 baseUrl 关键词匹配厂商默认 compat | OpenAI 兼容厂商适配 | core/llm/src/adapters/compat.ts |
| detectContextOverflow | 检测上下文溢出 | 跨厂商错误文案识别上下文超长 | 压缩器触发条件 | core/llm/src/overflow.ts |
| detectExpression | 检测表情 | 从文本 emoji/关键词推断表情状态 | 桌面宠物/UI 表情 | core/types/src/expression.ts |
| detectToolCallFromPartialJson | 提前检测工具调用 | 在不完整 JSON 中嗅出工具名 | 流式工具调用预校验 | core/llm/src/protocol/json-scan.ts |
| DeviceCodeStart | 设备码启动结果 | verificationUri+userCode+deviceCode | GitHub Copilot 设备码登录 | core/llm/src/oauth/types.ts |
| dispose | 销毁会话 | abort+逆序执行清理回调 | ChatSession 资源释放 | core/llm/src/chat-session.ts |
| EFFORT_ORDER | effort 顺序 | none→low→medium→high→xhigh 列表 | clamp/比较级别 | core/llm/src/reasoning.ts |
| EffortLevel (reasoning) | Effort 级别 | none/low/medium/high/xhigh 五级 | 思考强度统一表示 | core/llm/src/reasoning.ts |
| EffortLevel (compat) | 兼容 Effort 级别 | compat 层使用的同义别名 | compat 矩阵内 | core/llm/src/adapters/compat.ts |
| EMOJI_MAP | emoji→状态映射 | 表情符号→状态名字典 | detectExpression 内部 | core/types/src/expression.ts |
| encodeRawBody | 编码原始 body | gzip+base64 压缩请求体 | POST 日志存储 | core/llm/src/raw-codec.ts |
| encodeSSEFrame | 编码 SSE 帧 | event+data 的 SSE 帧文本 | 浏览器推送 | core/llm/src/sse.ts |
| estimateContextTokens | 估算上下文 token | system+messages+tools schema 总 token | 发送前估算 | core/llm/src/token-count.ts |
| estimateTokens | 估算 token | 启发式中英混合 token 数 | UI 显示/压缩阈值 | core/llm/src/token-count.ts |
| EventHookContext | 错误钩子上下文 | attempt/error/category/waitedMs | onError 决策入参 | core/llm/src/client.ts |
| EventType | 应用事件类型 | message:*/session:*/tool:*/stream:* 等枚举 | 应用事件总线 | core/types/src/index.ts |
| exchangeCopilotToken | 换 Copilot token | 用 device code 换 access token | Copilot 设备码流程 | core/llm/src/oauth/github-copilot.ts |
| extractJsonCandidate | 提取 JSON 候选 | 从含围栏/注释的文本提 JSON | JSON 解析回退 | core/llm/src/protocol/json-extract.ts |
| extractJsonText | 提取 JSON 文本 | 简化版 JSON 文本提取 | 调试/快速提取 | core/llm/src/protocol/json-extract.ts |
| extractTokenCount | 提取 token 数 | 从错误文本抽"N tokens" | 溢出时算压缩比例 | core/llm/src/overflow.ts |
| fauxAssistantMessage | Faux 助手消息 | 把片段组装成 faux 响应 | 测试桩构造 | core/llm/src/faux.ts |
| fauxText | Faux 文本片段 | 构造 text 片段 | mock 输出 | core/llm/src/faux.ts |
| fauxThinking | Faux 思考片段 | 构造 thinking 片段 | mock 推理 | core/llm/src/faux.ts |
| fauxToolCall | Faux 工具调用片段 | 构造 tool 片段 | mock 工具调用 | core/llm/src/faux.ts |
| FauxPart | Faux 片段 | text/thinking/tool 联合 | mock 响应构造 | core/llm/src/faux.ts |
| FauxResponder | 动态响应器 | 按消息返回 faux 响应的函数 | 动态 mock | core/llm/src/faux.ts |
| FauxResponse | Faux 响应 | mock 的 content/reasoningContent/toolCalls | LLMClient faux 短路 | core/llm/src/faux.ts |
| FieldDetailSectionKeys | 字段详情段键 | "键与值详细说明"等候选 | OUTPUT.jsonc 解析 | core/llm/src/protocol/json-schema.ts |
| findFirstJsonObjectBounds | 查找首个 JSON 对象边界 | 跳过注释/字符串返回 [start,end] | JSON 提取 | core/llm/src/protocol/json-extract.ts |
| findModel | 跨厂商查找模型 | 跨 provider 按 id 找首个 | 模型查询 | core/llm/src/registry/index.ts |
| findEnvKeys | 查找环境变量 | 列出某 provider 已配置的 env 名 | 配置向导/key 发现 | core/llm/src/env.ts |
| formatCost | 格式化成本 | 把 CostBreakdown 转可读字符串 | UI 显示 | core/llm/src/compute-cost.ts |
| FORMAT_SECTION_KEYS | 格式段键 | "输出格式"等候选 | OUTPUT.jsonc 解析 | core/llm/src/protocol/json-schema.ts |

### 1.3 G-I

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| generateCodeVerifier | 生成 code_verifier | PKCE 43~128 字符随机串 | OAuth Authorization Code | core/llm/src/oauth/pkce.ts |
| generateImages | 生成图片 | 调 OpenAI Images API 出图 | 图片生成场景 | core/llm/src/image/index.ts |
| GeneratedImage | 单张生成图片 | b64/url/mimeType/revisedPrompt | 图片生成返回 | core/llm/src/image/index.ts |
| GenerateImagesParams | 生成参数 | model/prompt/n/size/quality | generateImages 入参 | core/llm/src/image/index.ts |
| GenerateImagesResult | 生成总结果 | images+model+raw | generateImages 返回 | core/llm/src/image/index.ts |
| getAdapter | 获取适配器 | 按协议名返回适配器实例（回退 openai） | ProtocolGateway 内部 | core/llm/src/adapters/router.ts |
| getAdapterRegistry | 获取适配器注册表 | 返回全局 adapter map | base 子入口注入 | core/llm/src/adapter-registry.ts |
| getAllModels | 列出全部模型 | 跨 provider 扁平化 | 模型目录展示 | core/llm/src/registry/index.ts |
| getEnvApiKey | 取环境 API key | 按候选顺序检索 provider 的 env | toAPIPreset 自动注入 key | core/llm/src/env.ts |
| getImageModel | 取图片模型 | 按名查图片模型 | 图片生成选模型 | core/llm/src/image/index.ts |
| getImageModels | 列图片模型 | 列出某 provider 图片模型 | 模型选择 UI | core/llm/src/image/index.ts |
| getImageProviders | 列图片 provider | 全部图片 provider 列表 | 图片生成选厂商 | core/llm/src/image/index.ts |
| getModel | 取模型 | 按 provider+id 取模型规格 | 模型查询 | core/llm/src/registry/index.ts |
| getModels | 列模型 | 列出某 provider 全部模型 | 模型目录 | core/llm/src/registry/index.ts |
| getOAuthApiKey | 取有效 token | 已登录返/过期自动刷新 | 订阅登录后取 key | core/llm/src/oauth/index.ts |
| getProvider | 取 provider | 按 id 取厂商元信息 | 厂商查询 | core/llm/src/registry/index.ts |
| getProviders | 列 provider | 全部已注册厂商 | 厂商列表 | core/llm/src/registry/index.ts |
| getProjectsList | 获取项目列表 | 返回路径存在的项目 | 项目切换 UI | core/types/src/project-manager.ts |
| getProxyDispatcher | 取代理 dispatcher | ProxyAgent 或 EnvHttpProxyAgent | createProxyFetch 内部 | core/llm/src/proxy.ts |
| GitHubCopilotAdapter | Copilot 适配器 | 复用 OpenAI Chat 协议+设备码登录 | 接 GitHub Copilot | core/llm/src/adapters/github-copilot.ts |
| GoogleGeminiAdapter | Gemini 适配器 | Google generateContent API 适配 | 接 Google Gemini | core/llm/src/adapters/google.ts |
| GoogleVertexAdapter | Vertex 适配器 | Vertex AI 端点+GCP 认证 | 接 Vertex AI 上的 Gemini | core/llm/src/adapters/google-vertex.ts |
| GuardrailResult | 校验结果 | ok+error+warnings+sanitizedAttachments | validateRequest 返回 | core/llm/src/guardrails.ts |
| guardrails.ts | 防傻瓜校验 | 发送前校验请求与模型能力匹配 | ChatSession.send 入口 | core/llm/src/guardrails.ts |
| HandoffOptions | 交接选项 | targetSupportsTools/thinking 等 | 跨厂商交接配置 | core/llm/src/handoff.ts |
| hasEnvAccess | 是否可访问 env | Bun.env/process.env 存在判定 | 浏览器安全降级 | core/llm/src/runtime-env.ts |
| hasEnvKey | 是否有 env key | provider 是否配置了 env | 配置检测 | core/llm/src/env.ts |
| HealthResponse | 健康检查响应 | ok/uptime/sessionsCount/diskUsagePct/version | /api/health 端点 | core/types/src/index.ts |
| ImageContent | 图片内容块 | base64+mimeType 的 vision 输入 | stream API 多模态 | core/llm/src/stream.ts |
| ImageModelSpec | 图片模型规格 | id/provider/sizes/pricePerImage | 图片模型目录 | core/llm/src/image/index.ts |
| ImageProviderSpec | 图片 provider 规格 | id/baseUrl/envKey/models | 图片厂商注册 | core/llm/src/image/index.ts |
| inferSingleMissingCloser | 推断单个缺失闭合符 | 根据栈推断补 } 或 ] | JSON 修复 | core/llm/src/protocol/json-scan.ts |
| InputModality | 输入模态 | text/image/audio/pdf/video | 模型能力声明 | core/llm/src/registry/types.ts |
| isLoggedIn | 是否已登录 | provider 是否有保存令牌 | 登录状态检测 | core/llm/src/oauth/index.ts |
| isBrowserLike | 是否浏览器环境 | 无 process.versions.node 判定 | 浏览器降级分支 | core/llm/src/runtime-env.ts |
| isConnectionError | 是否连接错误 | ECONNRESET/ECONNABORTED/EPIPE 等判定 | 重试决策 | core/types/src/utils.ts |
| isExpired | 令牌是否过期 | 比较 expiresAt 与当前时间 | OAuth 自动刷新 | core/llm/src/oauth/store.ts |
| isJsonObjectSchema | 是否 object schema | 判定 JSON Schema type=object | OUTPUT.jsonc 派生 | core/llm/src/protocol/json-repair.ts |
| isPlainObject | 是否纯对象 | 排除 null/Array 判定 | deepMerge 内部 | core/types/src/config-store.ts |
| isSensitiveHeader | 是否敏感 header | Authorization/x-api-key 等判定 | 日志脱敏 | core/llm/src/client.ts |
| isWithinPath | 路径包含检查 | candidate 必须在 root 内 | 沙箱路径校验 | core/types/src/utils.ts |
| iterTopLevelJsonFields | 遍历顶层 JSON 字段 | 返回 [字段列表, 是否闭合] | 流式字段提取 | core/llm/src/protocol/json-scan.ts |

### 1.4 J-L

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| JsonExtractionResult | JSON 提取结果 | candidateText/repairsApplied 等 | extractJsonCandidate 返回 | core/llm/src/protocol/json-extract.ts |
| JsonSchema | JSON Schema | type/properties/required 等递归结构 | 工具参数 schema | core/types/src/index.ts |
| JsonSettings | JSON 设置 | required_fields/predict_length/schema_template | 结构化输出派生 | core/llm/src/protocol/json-schema.ts |
| JsonValidation | JSON 校验管道 | 提取+修复+扫描+Schema 派生+校验 | 模型输出结构化校验 | core/llm/src/protocol/index.ts |
| LLMCallLogEntry | LLM 调用日志条目 | request/response/duration/error | 旧版 logger 回调 | core/llm/src/client.ts |
| LLMClient | LLM 客户端 | 底层 HTTP 调用+指数退避重试 | 三层 API 最底层 | core/llm/src/client.ts |
| LLMClientOptions | 客户端选项 | logger/postLogger/fetchImpl/onPayload 等 | LLMClient 构造 | core/llm/src/client.ts |
| LLMConfig | LLM 配置管理器 | 文件+运行时+种子三源 | 统一管理厂商/模型配置 | core/llm/src/llm-config.ts |
| LLMConfigFile | 配置文件结构 | version/active/providers/presets | 持久化文件 schema | core/llm/src/llm-config.ts |
| LLMConfigOptions | 配置选项 | configPath/presetsDir/loadSeed | LLMConfig 构造 | core/llm/src/llm-config.ts |
| LLMEventType | LLM 事件类型 | send/receive/first_token/thinking_start 等 | ChatSession.on 订阅 | core/llm/src/chat-session.ts |
| LLMLogger | LLM 日志器 | 兼容旧接口的回调类型 | setLogger 注入 | core/llm/src/client.ts |
| LLMPostLogger | POST 日志器 | 标准化记录回调类型 | setPostLogger 注入 | core/llm/src/client.ts |
| LLMPostLogContext | POST 日志上下文 | session_id/agent_name/round/retry 等 | normalizePostLogRecord 入参 | core/llm/src/post-logger.ts |
| LLMPostLogRecord | POST 日志记录 | version+event+request+response+usage 标准结构 | JSONL 持久化 | core/llm/src/post-logger.ts |
| LLMProtocol | LLM 协议（deprecated） | openai/anthropic/openai-responses 旧类型 | AppConfig 保留供旧码 | core/types/src/index.ts |
| LLMPreset | LLM 预设（deprecated） | 旧版 preset 结构 | AppConfig.api.presets | core/types/src/index.ts |
| LLMToolCall | 工具调用 | id+name+parameters+provider+type | 模型发起的工具调用 | core/llm/src/adapters/types.ts |
| LLMUsage | 用量统计 | prompt_tokens/completion_tokens/cache_read 等 | 成本计算/统计 | core/llm/src/adapters/types.ts |
| loadSeed | 加载种子数据 | 从外部注入初始厂商/模型 | LLMConfig 初始化 | core/llm/src/llm-config.ts |
| loadTokens | 加载令牌 | 从持久化读某 provider 令牌 | 启动时恢复登录 | core/llm/src/oauth/store.ts |
| loginAnthropic | 登录 Anthropic | 启动 OAuth 两步流程 | Claude Pro/Max 订阅 | core/llm/src/oauth/anthropic.ts |
| loginGitHubCopilot | 登录 Copilot | 设备码流程 | Copilot 订阅 | core/llm/src/oauth/github-copilot.ts |
| loginGeminiCli | 登录 Gemini CLI | OAuth 两步流程 | Gemini CLI 订阅 | core/llm/src/oauth/google.ts |
| loginOpenAICodex | 登录 Codex | OAuth 两步流程 | ChatGPT 订阅 | core/llm/src/oauth/openai-codex.ts |
| LoopDetector | 循环检测器 | 检测输出末尾重复模式 | ModelCaller 防死循环 | core/llm/src/caller.ts |

### 1.5 M-O

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| mapEffortLevel | 映射 effort 级别 | 按 reasoningEffortMap 转厂商值 | DeepSeek "max" 等映射 | core/llm/src/reasoning.ts |
| MAOU_VERSION | Maou 版本号 | "0.3.0" 与 package.json 同步 | 版本展示 | core/types/src/utils.ts |
| MAX_BODY_SIZE | 最大请求体 | 10MB | 请求体限制 | core/types/src/utils.ts |
| MAX_FILE_PROXY_SIZE | 文件代理上限 | 100MB | 文件代理下载 | core/types/src/utils.ts |
| MAX_RETRIES | 最大重试 | 8 次 | LLMClient 退避上限 | core/llm/src/client.ts |
| MAX_TOKENS_CAP | token 硬上限 | 1_000_000 | 适配器 clamp max_tokens | core/llm/src/adapters/shared.ts |
| Message | 消息（联合） | UserMessage\|AssistantMessage\|ToolResultMessage | stream API 消息 | core/llm/src/stream.ts |
| MessageRole | 消息角色 | user/assistant/system/tool | 应用层消息角色 | core/types/src/index.ts |
| migrateSession | 迁移会话 | 把 ChatSession 历史归一后切厂商 | 跨厂商切换 | core/llm/src/handoff.ts |
| MistralAdapter | Mistral 适配器 | Mistral Chat Completions 适配 | 接 Mistral 模型 | core/llm/src/adapters/mistral.ts |
| ModelCaller | 模型调用管道 | 流式+JSON 校验+循环检测+重试 | AgentRuntime 中层 | core/llm/src/caller.ts |
| ModelCallResult | 调用结果 | rawResponse/content/nativeToolCalls/usage/timing | ModelCaller 返回 | core/llm/src/caller.ts |
| ModelDelta | 模型增量 | delta+rawEvent+finishReason+thinking | chatStream yield | core/llm/src/adapters/types.ts |
| ModelInfo | 模型信息 | id+ownedBy+created | PresetManager.fetchModels | core/llm/src/chat-session.ts |
| ModelPricing | 模型定价 | input/output/cacheRead/cacheWrite 每百万 token | 成本计算 | core/llm/src/registry/types.ts |
| ModelResponse | 模型响应 | content+rawEvents+toolCalls+usage+timing | chat/chatStream 返回 | core/llm/src/adapters/types.ts |
| ModelSpec | 模型规格 | id/provider/protocol/input/output/reasoning 等 | registry 注册 | core/llm/src/registry/types.ts |
| normalizeApiProtocol | 标准化协议名 | 把别名归一为标准 protocol | 路由前归一 | core/llm/src/adapters/types.ts |
| normalizeForHandoff | 交接归一 | 把历史归一成任意厂商可消费的形态 | 跨厂商切换 | core/llm/src/handoff.ts |
| normalizeJsonSettings | 归一 JSON 设置 | 把任意输入归一为 JsonSettings | 运行时校验 | core/llm/src/protocol/json-schema.ts |
| normalizeKeys | 键归一 | 递归 snake_case→camelCase | ConfigStore 配置加载 | core/types/src/config-store.ts |
| normalizePostLogRecord | 标准化 POST 记录 | 把 LLMCallLogEntry 补齐为 LLMPostLogRecord | 日志管线 | core/llm/src/post-logger.ts |
| normalizeToolParametersSchema | 工具参数 schema 归一 | 保证返回 object schema | 适配器构建 tools | core/llm/src/adapters/shared.ts |
| NormalizePostLogOptions | 日志归一选项 | keepFullBody/bodySummaryMaxLen | 配置截断策略 | core/llm/src/post-logger.ts |
| nowIso | ISO 时间戳 | 当前时间的 ISO 字符串 | 日志/记录时间 | core/types/src/utils.ts |
| OAuthProvider | OAuth provider | anthropic/openai-codex/github-copilot/google | 订阅登录分发 | core/llm/src/oauth/types.ts |
| OAuthTokens | OAuth 令牌 | accessToken/refreshToken/expiresAt | 持久化登录态 | core/llm/src/oauth/types.ts |
| onCleanup | 注册清理回调 | 会话级资源释放钩子 | 关闭 WebSocket 等 | core/llm/src/chat-session.ts |
| onError | 错误钩子 | 返回 retry/fail/{delayMs} 决策 | 自定义重试/熔断 | core/llm/src/client.ts |
| onPayload | 请求拦截钩子 | 签名前改写 url/headers/body | 加埋点/代理改写 | core/llm/src/client.ts |
| onResponse | 响应拦截钩子 | 只读访问响应 status/headers | 审计/埋点 | core/llm/src/client.ts |
| OpenAICodexAdapter | Codex 适配器 | 复用 Responses 协议+OAuth 认证 | 接 OpenAI Codex | core/llm/src/adapters/openai-codex.ts |
| OpenAIChatAdapter | OpenAI Chat 适配器 | Chat Completions API 适配 | 接 OpenAI 兼容厂商 | core/llm/src/adapters/openai.ts |
| OpenAICompat | OpenAI 兼容标志 | supportsStore/thinkingFormat/structuredOutput 等 | 各家 OpenAI 兼容厂商适配 | core/llm/src/adapters/compat.ts |
| OpenAIResponsesAdapter | Responses 适配器 | 新版 OpenAI Responses API 适配 | 接 o3/o4-mini 等 | core/llm/src/adapters/openai-responses.ts |
| OutputModality | 输出模态 | text/image/audio | 模型能力声明 | core/llm/src/registry/types.ts |
| overflow.ts | 上下文溢出检测 | 跨厂商错误文案识别 | 压缩器触发条件 | core/llm/src/overflow.ts |
| OVERFLOW_PATTERNS | 溢出文案模式 | 20+ 跨厂商正则 | detectContextOverflow 内部 | core/llm/src/overflow.ts |

### 1.6 P-R

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| ParsedLLMResponse | 解析后响应 | content+toolCalls+finishReason+reasoningContent | 适配器非流式解析返回 | core/llm/src/adapters/types.ts |
| ParsedResponse | 解析响应 | content+toolCalls+structuredOutput+reasoning | 应用层解析结构 | core/types/src/index.ts |
| parseToolArguments | 解析工具参数 | JSON.parse→partial-json→_raw 回退 | 流式工具调用参数解析 | core/llm/src/adapters/shared.ts |
| PayloadHookContext | 请求钩子上下文 | url/headers/body/preset/protocol | onPayload 入参 | core/llm/src/client.ts |
| PayloadHookOverride | 请求覆盖值 | url/headers/body 可选覆盖 | onPayload 返回 | core/llm/src/client.ts |
| PluginSettings | 插件设置 | plugins 启用映射+signalRender | AppConfig.api.pluginSettings | core/types/src/index.ts |
| pollGitHubToken | 轮询 Copilot token | 设备码流程轮询换 token | Copilot 登录第二步 | core/llm/src/oauth/github-copilot.ts |
| Pricing | 定价 | inputPrice/outputPrice/cacheHitPrice/currency | computeCost 入参 | core/llm/src/compute-cost.ts |
| PROVIDER_ENV_KEYS | provider→env 映射 | 30+ 厂商候选环境变量名 | getEnvApiKey 检索 | core/llm/src/env.ts |
| ProfileReport | 性能报告 | label+totalMs+spans+records | Profiler.report 返回 | core/types/src/profiler.ts |
| Profiler | 性能埋点器 | 跨层低开销耗时统计 | agent loop 各阶段计时 | core/types/src/profiler.ts |
| ProjectEntry | 项目条目 | name+path+created_at/updated_at | projects.json 元素 | core/types/src/project-manager.ts |
| ProjectListItem | 项目列表项 | name+path+isActive | UI 列表展示 | core/types/src/project-manager.ts |
| PromptNode | 提示节点 | path+content+children 的树 | CompiledPrompt.tree | core/types/src/index.ts |
| ProtocolAdapter | 协议适配器接口 | buildHeaders/buildPayload/parseStream 等 | 自定义协议实现 | core/llm/src/adapters/types.ts |
| ProtocolGateway | 协议网关 | 懒加载+缓存协议→适配器 | LLMClient 路由 | core/llm/src/adapters/router.ts |
| ProviderSpec | provider 规格 | id/name/protocol/baseUrl/envKey/models | registry 注册 | core/llm/src/registry/types.ts |
| ProxyOptions | 代理选项 | uri/token | createProxyFetch 入参 | core/llm/src/proxy.ts |
| RAW_CODEC_ALGO | 原始编解码算法 | "gzip+base64" 标识 | 压缩自描述 | core/llm/src/raw-codec.ts |
| RAW_CODEC_MIN_BYTES | 最小压缩阈值 | 512 字节，小则不压 | 避免膨胀 | core/llm/src/raw-codec.ts |
| RateLimiter | 速率限制器 | 固定窗口每 windowMs 最多 N 个 | 免费额度防超 | core/llm/src/rate-limit.ts |
| reasoning.ts | 思考强度 | 统一 6 级 reasoning level | setReasoning 控制 | core/llm/src/reasoning.ts |
| ReasoningLevel | Reasoning 级别 | off/minimal/low/medium/high/xhigh | setReasoning 入参 | core/llm/src/reasoning.ts |
| reasoningBudget | 思考 token 预算 | 各级别对应的 budget_tokens | reasoning_paramsFor 派生 | core/llm/src/reasoning.ts |
| reasoningEffortMap | effort 映射表 | 把标准级别映射到厂商接受值 | DeepSeek "max" 等适配 | core/llm/src/adapters/compat.ts |
| reasoningLevelFromBudget | 预算反推级别 | 按 budget_tokens 数推断 ReasoningLevel | 归一/回显 | core/llm/src/reasoning.ts |
| reasoningParamsFor | 派生 reasoning_params | 产出 Anthropic 风格规范形 | setReasoning 写入 preset | core/llm/src/reasoning.ts |
| reasoningToEffort | Reasoning→Effort | off→none，其余原样 | compat 转换 | core/llm/src/reasoning.ts |
| reconstructPost | 重建 POST | 从压缩载体还原请求/响应 | 日志回放调试 | core/llm/src/raw-codec.ts |
| ReconstructedPost | 重建结果 | 还原后的请求+响应结构 | 日志回放 | core/llm/src/raw-codec.ts |
| registerAdapter | 注册适配器 | 写入全局 adapter 注册表 | base 子入口按需注册 | core/llm/src/adapter-registry.ts |
| registerFauxProvider | 注册 Faux | 预设 mock 响应列表 | 测试桩 | core/llm/src/faux.ts |
| registerImageProvider | 注册图片 provider | 注册自定义图片厂商 | 扩展图片生成 | core/llm/src/image/index.ts |
| registerModel | 注册模型 | 向已有 provider 追加模型 | 扩展模型目录 | core/llm/src/registry/index.ts |
| registerProvider | 注册 provider | 注册/覆盖厂商+模型 | 扩展厂商 | core/llm/src/registry/index.ts |
| repairMissingFields | 修复缺失字段 | 按 schema 默认值补字段 | JSON 字段级修复 | core/llm/src/protocol/json-repair.ts |
| repairPredictField | 修复 predict 字段 | 按 predict_length 截断/补全 | predict 字段强制对齐 | core/llm/src/protocol/json-repair.ts |
| repairToolCalls | 修复工具调用 | 按 paramGuards 过滤/修补 | 工具调用前校验 | core/llm/src/caller.ts |
| resolveAzureApiVersion | 解析 Azure api-version | preset.api_version 或默认 | Azure URL 拼接 | core/llm/src/adapters/azure-openai.ts |
| resolveAzureDeployment | 解析 Azure 部署名 | preset.deployment 或回退 model | Azure URL 拼接 | core/llm/src/adapters/azure-openai.ts |
| resolveCloudflareUrl | 解析 Cloudflare URL | 替换 {CLOUDFLARE_ACCOUNT_ID} 占位 | Cloudflare 端点拼接 | core/llm/src/adapters/cloudflare.ts |
| resolveCompat | 解析最终 compat | preset 显式优先+baseUrl 检测 | 适配器构建 payload | core/llm/src/adapters/compat.ts |
| ResponseFieldMapping | 响应字段映射 | content/reasoning/toolCalls 等自定义路径 | 奇葩厂商响应解析 | core/llm/src/adapters/types.ts |
| ResponseHookContext | 响应钩子上下文 | url/status/headers/preset | onResponse 入参 | core/llm/src/client.ts |
| resumeFrom | 续传 | 把部分 assistant 内容存为历史后续传 | 中断/出错后断点续传 | core/llm/src/chat-session.ts |
| retry | 重试 | 替换最后 assistant 重新发起 | 模型答不好时重来 | core/llm/src/chat-session.ts |
| RetryPolicy | 重试策略 | maxRetries/baseDelayMs/maxDelayMs/jitter | LLMClient 退避配置 | core/llm/src/client.ts |
| replayPost | 回放 POST | 用重建数据重发请求 | 日志回放复现 | core/llm/src/raw-codec.ts |
| refreshAnthropic | 刷新 Anthropic token | 用 refreshToken 续期 | 订阅令牌自动续期 | core/llm/src/oauth/anthropic.ts |
| refreshGitHubCopilot | 刷新 Copilot token | 续期 Copilot 令牌 | Copilot 自动续期 | core/llm/src/oauth/github-copilot.ts |
| refreshGeminiCli | 刷新 Gemini token | 续期 Gemini CLI 令牌 | Gemini 自动续期 | core/llm/src/oauth/google.ts |
| refreshOAuthToken | 刷新 OAuth token | 按 provider 分发刷新 | 通用续期入口 | core/llm/src/oauth/index.ts |
| refreshOpenAICodex | 刷新 Codex token | 续期 ChatGPT 令牌 | Codex 自动续期 | core/llm/src/oauth/openai-codex.ts |

### 1.7 S-U

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| sanitizeHeaders | header 脱敏 | 把敏感 header 替换为 *** | 日志输出前 | core/llm/src/client.ts |
| saveTokens | 保存令牌 | 持久化某 provider 令牌 | 登录后存储 | core/llm/src/oauth/store.ts |
| scanModels | 模型扫描 | 跨协议拉取厂商模型列表 | 配置向导/模型发现 | core/llm/src/account.ts |
| ScannedModel | 扫描到的模型 | id+provider+protocol | scanModels 返回元素 | core/llm/src/account.ts |
| schema_template | schema 模板 | JsonSettings 中的 JSON Schema 字符串 | 结构化输出注入 | core/llm/src/protocol/json-schema.ts |
| SecurityConfig | 安全配置 | sandboxMode/dangerousCommandsRequireApproval | AppConfig.security | core/types/src/index.ts |
| SENSITIVE_HEADERS | 敏感 header 集合 | Authorization/x-api-key 等脱敏白名单 | sanitizeHeaders 内部 | core/llm/src/client.ts |
| Session | 会话 | id+agentName+title+messages+timestamps | 应用层会话结构 | core/types/src/index.ts |
| setHistory | 替换历史 | 用外部消息数组替换 ChatSession 历史 | 跨厂商交接恢复 | core/llm/src/chat-session.ts |
| setJsonSchema | 设置结构化输出 | 注入 jsonSettings 强制 JSON | 结构化输出场景 | core/llm/src/chat-session.ts |
| setPostLogger | 注入 POST 日志器 | 运行时设置标准化记录回调 | Runtime 延迟初始化 | core/llm/src/client.ts |
| setPreset | 切换预设 | 运行时换 APIPreset | 多模型切换 | core/llm/src/chat-session.ts |
| setReasoning | 设置思考强度 | 写入规范形 reasoning_params | 控制推理深度 | core/llm/src/chat-session.ts |
| setTools | 设置工具 schema | 让模型可主动发起工具调用 | 原生工具调用 | core/llm/src/chat-session.ts |
| snakeToCamel | snake→camel | snake_case 转 camelCase | ConfigStore 键归一 | core/types/src/config-store.ts |
| SSE_HEADERS | SSE 头 | text/event-stream 标准头 | streamToSSE 输出 | core/llm/src/sse.ts |
| SSE_PING_INTERVAL_MS | SSE 心跳间隔 | 30 秒 | 长连接保活 | core/types/src/utils.ts |
| SSEOptions | SSE 选项 | heartbeatMs/eventName/withDelimiter | streamToSSE 配置 | core/llm/src/sse.ts |
| SpanRecord | span 记录 | name+startMs+durationMs+meta | Profiler 单条计时 | core/types/src/profiler.ts |
| SpanSummary | span 汇总 | totalMs/count/avgMs/maxMs/pct | Profiler 聚合 | core/types/src/profiler.ts |
| splitFirstJsonObjectRegion | 拆分首个 JSON 对象区 | [before, json, after] 三段 | JSON 提取 | core/llm/src/protocol/json-extract.ts |
| splitThinkingTags | 拆分思考标签 | 抽出 <thinking>...</thinking> 内容 | 跨厂商思考归一 | core/llm/src/handoff.ts |
| startAnthropicLogin | 启动 Anthropic 登录 | 生成 url+state+codeVerifier | OAuth 第一步 | core/llm/src/oauth/anthropic.ts |
| startGeminiCliLogin | 启动 Gemini 登录 | OAuth 第一步 | Gemini CLI 订阅 | core/llm/src/oauth/google.ts |
| startOpenAICodexLogin | 启动 Codex 登录 | OAuth 第一步 | ChatGPT 订阅 | core/llm/src/oauth/openai-codex.ts |
| Static | TypeBox 静态类型 | 从 schema 推断的 TS 类型 | 编译期类型推断 | core/llm/src/tools/index.ts |
| StealthMapper | 伪装映射器 | forwardName/restoreName/applySchemas | Stealth Mode 工具名改写 | core/llm/src/stealth.ts |
| stealth.ts | Stealth Mode | 工具名伪装成 Claude Code 规范 | 后端特殊优化识别 | core/llm/src/stealth.ts |
| StopReason | 停止原因 | stop/length/toolUse/error/aborted | stream API 终止原因 | core/llm/src/stream.ts |
| stream | stream API | 无状态流式调用入口 | 跨厂商流式对话 | core/llm/src/stream.ts |
| StreamEvent (adapters) | 协议层流事件 | delta+finishReason+usedReasoning+thinking | 适配器 parseStreamEvent 返回 | core/llm/src/adapters/types.ts |
| StreamEvent (stream API) | stream API 事件 | text/thinking/toolUse/usage/stop 等高层事件 | stream() yield | core/llm/src/stream.ts |
| StreamEvent (types) | 应用层流事件 | type+content+delta+round+session 通用结构 | 应用事件总线 | core/types/src/index.ts |
| StreamingField | 流式字段状态 | name+content+delta+complete | getStreamingFields 返回 | core/llm/src/stream-parser.ts |
| StreamJsonAccumulator | 流式 JSON 累加器 | 逐字段检测工具调用/结构化字段 | 流式结构化输出提取 | core/llm/src/stream-parser.ts |
| StreamModel | stream 模型参 | APIPreset\|ModelSpec 等可传入 stream 的"模型" | stream 入参 | core/llm/src/stream.ts |
| StreamOptions | stream 选项 | thinking/structuredOutput/signal/abort | stream() 配置 | core/llm/src/stream.ts |
| StreamParseOptions | 流式解析选项 | terminationMode/fallbackToChoiceTopLevel | 非标准流式格式适配 | core/llm/src/adapters/types.ts |
| StreamResult | stream 结果 | AsyncIterable+return AssistantMessage | stream() 返回值 | core/llm/src/stream.ts |
| streamStallMs | 流式停滞超时 | 长时间无新数据中止读取 | 防请求无限挂起 | core/llm/src/client.ts |
| streamToSSE | 流转 SSE | 把 StreamResult 转 SSE 帧流 | 浏览器推送 | core/llm/src/sse.ts |
| StringEnum | 字符串枚举辅助 | 编译期推断为联合字面量 | 工具参数枚举字段 | core/llm/src/tools/index.ts |
| stripJsonComments | 剥离 JSON 注释 | 移除 // 与 /* */ | JSONC 解析 | core/llm/src/protocol/json-repair.ts |
| stripTrailingCommas | 移除尾逗号 | 删除 ]}/} 前的逗号 | JSON 修复 | core/llm/src/protocol/json-repair.ts |
| stripMarkdownFence | 剥离 Markdown 围栏 | 去掉 \`\`\`json 包裹 | JSON 提取 | core/llm/src/protocol/json-repair.ts |
| StructuredField | 结构化字段 | key+rawValue+value+complete | 回调风格字段信息 | core/llm/src/stream-parser.ts |
| StructuredOutputCompat | 结构化输出兼容 | json_schema/json_object/qwen-response-format/none | 各家结构化输出差异 | core/llm/src/adapters/compat.ts |
| StructuredOutputMode | 结构化输出模式（deprecated） | json_object/json_schema | 旧 LLMPreset 字段 | core/types/src/index.ts |
| SubagentExecutorLike | 子 Agent 执行器契约 | fork/forkLayer 最小契约 | agent_message 工具注入 | core/types/src/index.ts |
| SubagentResultLike | 子 Agent 结果契约 | taskId+subSessionId+output+ok | SubagentExecutor 返回 | core/types/src/index.ts |
| subagentExecutor | 子 Agent 执行器字段 | ToolContext 的 fork 注入回调 | agent_message 工具 | core/types/src/index.ts |
| takeFauxResponse | 取 Faux 响应 | 按游标取下一条 mock 响应 | LLMClient faux 短路 | core/llm/src/faux.ts |
| thinkingFormat | 思考格式 | openai/deepseek/qwen/zai 等 10 种 | 各家思考字段适配 | core/llm/src/adapters/compat.ts |
| ThinkingContent | 思考内容块 | type+text 的推理内容 | stream API 跨厂商交接 | core/llm/src/stream.ts |
| ThinkingFormat | 思考格式（10 选 1） | openai/openrouter/deepseek 等 | compat.thinkingFormat | core/llm/src/adapters/compat.ts |
| ThinkingMode (handoff) | thinking 处理方式 | tag/strip/keep | 交接时思考内容处理 | core/llm/src/handoff.ts |
| TinyEmitter | 极简事件发射器 | on/off/once/emit 替代 node:events | ChatSession 浏览器可用 | core/llm/src/chat-session.ts |
| toAPIPreset | 模型转 APIPreset | 把 ModelSpec+envKey 转 APIPreset | 一键启动 ChatSession | core/llm/src/registry/index.ts |
| toOpenAIReasoningEffort | 转 OpenAI effort | xhigh→high，off→null | OpenAI 适配器注入 | core/llm/src/reasoning.ts |
| ToolCall | 工具调用（应用层） | id+name+parameters | 应用层 Message.toolCalls | core/types/src/index.ts |
| ToolCallBlock | 工具调用块 | id+name+parameters 的 stream API 形态 | AssistantMessage.content 元素 | core/llm/src/stream.ts |
| ToolCallProgress | 工具调用进度 | name+parameters+complete+raw | 流式工具调用累积 | core/llm/src/stream-parser.ts |
| ToolContext | 工具上下文 | sessionId/projectRoot/sandboxRoot/agentName 等 | 工具执行注入 | core/types/src/index.ts |
| ToolDefinition | 工具定义 | name+aliases+description+parameters+parallelSafe 等 | 工具注册 | core/types/src/index.ts |
| ToolResult | 工具结果 | toolCallId+name+output+success+error+elapsed | 应用层工具返回 | core/types/src/index.ts |
| ToolResultMessage | 工具结果消息 | role=tool+toolCallId+content | stream API 工具回填 | core/llm/src/stream.ts |
| ToolResponse | 工具响应 | ok+message+displayEvents+payload+images | 工具执行返回结构 | core/types/src/index.ts |
| tools/index.ts:defineTool | 定义工具 | TypeBox schema+execute 的类型安全工具 | agentLoop/ChatSession.setTools | core/llm/src/tools/index.ts |
| tools/index.ts:validateToolCall | 校验工具调用 | 强转+补默认+TypeCompiler 校验 | 工具执行前校验参数 | core/llm/src/tools/index.ts |
| tools/index.ts:ValidateResult | 校验结果 | ok+value+errors | validateToolCall 返回 | core/llm/src/tools/index.ts |
| toolSchemas | 批量转 schema | DefinedTool[]→ToolSchema[] | 适配器消费 | core/llm/src/tools/index.ts |
| ToolSchema | 工具 schema | name+description+parameters | 适配器消费的工具定义 | core/llm/src/tools/index.ts |
| transport.ts | WebSocket 传输 | 把 WS 适配成 SSE fetch | WebSocket 协议接入 | core/llm/src/transport.ts |
| truncateBodyForSummary | 截断 body 摘要 | 把 body 截到指定长度 | POST 日志 body_summary | core/llm/src/post-logger.ts |
| TSchema | TypeBox schema 基类 | 工具 schema 的类型根 | 类型安全工具 | core/llm/src/tools/index.ts |
| TObject | TypeBox object 类型 | 工具参数 schema 的对象形态 | defineTool 入参约束 | core/llm/src/tools/index.ts |

### 1.8 V-Z

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| validateParsedResponse | 校验解析响应 | 字段级修复（不重试） | ModelCaller autoFormat | core/llm/src/protocol/json-validation.ts |
| validateRequest | 防傻瓜校验 | 发送前校验请求与能力匹配 | ChatSession.send 入口 | core/llm/src/guardrails.ts |
| ValidateResult | 校验结果 | ok+value+errors | validateToolCall 返回 | core/llm/src/tools/index.ts |
| ValidationResult | 校验结果（协议层） | valid+canRetry+error+formatted+data+diagnostic | validateParsedResponse 返回 | core/llm/src/protocol/json-validation.ts |
| VENDOR_DEFAULTS | 厂商默认 compat | 按 baseUrl 匹配的预设 compat 表 | detectCompat 内部 | core/llm/src/adapters/compat.ts |
| wrapThinking | 包裹思考 | 把思考内容包成 <thinking> 文本 | 跨厂商交接归一 | core/llm/src/handoff.ts |
| WebSocketFetchOptions | WS fetch 选项 | url/cached/protocols/toFrames/isDone | createWebSocketFetch 配置 | core/llm/src/transport.ts |
| withLimiters | 限流器组合 | 组合多个 limiter 全满足才放行 | 多重限流 | core/llm/src/rate-limit.ts |

---

## 2. tools + terminal-engine 包

`core/tools/src/`（11 内置工具集 + 7 基础文件）+ `terminal-engine/src/`（8 Rust 模块：lib/error/filter/logger/persistence/registry/sandbox/terminal）。

### 2.1 A-C

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| AgentMismatch | Agent 归属不匹配错误 | 终端属于其他 Agent 时抛出 | 终端跨 Agent 操作鉴权 | terminal-engine/src/error.rs |
| AgentToolsDir | Agent 级工具目录 | 文件即 Agent 约定下的 ~/.maou/agents/<name>/tools/ | 自动发现并加载 agent 专属工具 schema | core/tools/src/registry.ts |
| AlreadyRunning | 终端正在运行错误 | 同名终端仍在运行不可重复创建 | 终端 ID 复用校验 | terminal-engine/src/error.rs |
| applyNeverWorse | Never-worse 守卫 | 压缩后若不比原短则回退原样，防摄入层反向膨胀 | 工具输出压缩兜底 | core/tools/src/compress/output-compressor.ts |
| approval | 审批策略构建器 | always/once/when/never 四种策略的工厂集 | 文件即工具的人机审批配置 | core/tools/src/define-tool.ts |
| ApprovalDecision | 审批决策类型 | 表示工具调用是否需要人类审批的布尔别名 | 审批策略返回值 | core/tools/src/define-tool.ts |
| ApprovalPredicate | 审批策略函数类型 | 接收工具名与入参返回是否需审批的谓词 | 自定义审批逻辑注入 | core/tools/src/define-tool.ts |
| atomicWrite | 原子写文件 | 先写临时文件再 rename，避免中途崩溃留半截文件 | edit_file/write_file 落盘 | core/tools/src/file/atomic-write.ts |
| auto (mode) | 自动审批模式 | 非名单命令交小模型审核，通过入白名单拒绝入黑名单 | 终端命令审批策略 | core/tools/src/terminal/terminal-policy.ts |
| bakedContent | 烘焙内容 | 首轮将所有 skill 列表注入到 user 消息的文本 | skill 上下文首轮注入 | core/tools/src/skill-context.ts |
| background | 后台运行模式 | 命令在后台执行并自动提醒完成/失败/超时 | use_terminal action=run 的参数 | core/tools/src/terminal/use_terminal/tool.ts |
| Bing | Bing 搜索 fallback | 国内兜底搜索源，应对 DDG 被墙 | search_internet 四层降级最末 | core/tools/src/internet/search_internet/tool.ts |
| BINARY_EXTENSIONS | 二进制扩展名集 | grep 在 Node 降级模式下跳过这些扩展名 | 防止读取二进制文件乱码 | core/tools/src/search/grep/tool.ts |
| blacklist | 黑名单 | 命令审批中拒绝执行的规则列表 | 终端命令拦截 | core/tools/src/terminal/terminal-policy.ts |
| BoardEntry | 看板条目 | 共享状态看板的单条键值记录结构 | 持久化追踪结构化状态 | core/tools/src/info/board/tool.ts |
| BoardStore | 看板存储 | 按 maouRoot 隔离的 records.json 读写封装 | 跨会话状态持久化 | core/tools/src/info/board/tool.ts |
| BoardTool | 共享状态看板工具 | list/get/add/replace/edit/del 键值状态 | 任务进度/计数器/角色属性存储 | core/tools/src/info/board/tool.ts |
| BrowserTool | 浏览器工具 | 基于 OpenCLI 控制真实浏览器复用已登录会话 | 网页自动化、UI 验证 | core/tools/src/browser/god_tool/use_browser/tool.ts |
| buildSafeEnv | 安全环境变量构建 | 按白名单过滤 process.env 并强制 TERM | PTY 子进程环境构造 | core/tools/src/terminal/pty.ts |
| check (action) | 诊断检查 | LSP 检查代码是否有错误，无 file 检查整工程 | 判断代码无错误状态的权威方式 | core/tools/src/code/lsp/tool.ts |
| cleanupAgent | Agent 终端清理 | kill 并移除某 agent 的全部终端 | session 开始时清理残留 | core/tools/src/terminal/registry.ts |
| cleanupAgentTerminals | 清理 Agent 终端函数 | runtime.ts 在 session 开始时调用清理 | 进程级终端清理 | core/tools/src/terminal/use_terminal/tool.ts |
| cleanupSession | 会话清理钩子 | 调用所有工具的 onSessionStart 钩子 | session 开始时清理 session-scoped 数据 | core/tools/src/registry.ts |
| cleanupWorkspaceLsp | 工作区 LSP 清理 | 关闭某项目工作区的语言服务器进程 | harness 退出或切项目时 | core/tools/src/code/lsp/tool.ts |
| clearBuffer | 清理 ring buffer | 清空终端输出环形缓冲与行拼接缓冲 | 复用已退出终端时 | core/tools/src/terminal/registry.ts |
| clearReadRegistry | 清理已读登记 | 删除某 session 的全部已读记录 | 会话结束/清理时调用 | core/tools/src/file/read-registry.ts |
| CommandBlocked | 命令被拦截错误 | 命令命中黑名单/沙箱时抛出 | 终端命令过滤 | terminal-engine/src/error.rs |
| CommandFilter | 命令过滤器 | 预设黑名单+自定义黑白名单的 regex 校验器 | 终端命令安全过滤 | terminal-engine/src/filter.rs |
| CommandNotWhitelisted | 命令不在白名单错误 | 白名单模式启用时命令未命中抛出 | 终端命令白名单模式 | terminal-engine/src/error.rs |
| compressOutput | 通用输出压缩 | 去噪→去重→超长截断头尾的保守压缩 | 工具结果进入 LLM 上下文前 | core/tools/src/compress/output-compressor.ts |
| CompressLevel | 压缩级别 | off/normal/aggressive 三档预设 | agent.json tool_compression 控制 | core/tools/src/compress/output-compressor.ts |
| CompressOptions | 压缩选项 | maxLines/headLines/tailLines/dedupe/stripAnsiCodes | 工具输出压缩参数 | core/tools/src/compress/output-compressor.ts |
| compressTerminalOutput | 终端输出语义压缩 | 按命令类型选策略，测试命令走失败项抽取 | use_terminal 摄入层压缩 | core/tools/src/compress/output-compressor.ts |
| compressTestOutput | 测试输出压缩 | 只保留失败相关行+摘要行，丢通过详情 | cargo test/pytest 等输出 | core/tools/src/compress/output-compressor.ts |
| countOccurrences | 统计出现次数 | 非重叠统计 needle 在 haystack 中的次数 | edit_file 唯一匹配校验 | core/tools/src/file/edit_file/tool.ts |
| CreateOptions | 终端创建选项（Rust） | id/agent_name/cwd/cols/rows/description | portable-pty spawn 终端 | terminal-engine/src/terminal.rs |
| CreateTerminalOptions | 创建终端选项（NAPI） | 导出给 JS 的终端创建参数结构 | napi run/run_background 入参 | terminal-engine/src/lib.rs |
| createOrReuse | 创建或复用终端 | 同名已退出终端换新 PTY，否则新建 | use_terminal id 复用语义 | core/tools/src/terminal/registry.ts |
| createToolResponse | 创建工具响应 | 构造默认 ok/message/extras 的 ToolResponse | 所有工具返回结果构造 | core/tools/src/base.ts |

### 2.2 D-F

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| DEFAULT_CHUNK_LIMIT | 默认单字段最大字符数 | 8000 字符（约 2K~4K token） | truncateMiddle 默认上限 | core/tools/src/browser/god_tool/use_browser/_util.ts |
| decideCommand | 决策命令处理 | 返回 allow/deny/ask/review 的策略决策 | 终端命令审批门 | core/tools/src/terminal/terminal-policy.ts |
| dedupeConsecutive | 折叠连续重复行 | 重复行折叠成 `行 [×N]` 计数形式 | 工具输出无损去重 | core/tools/src/compress/output-compressor.ts |
| defineTool | 定义文件即工具 | 对标 Vercel Eve，.ts 文件即工具 API | agent/tools/ 目录下的工具定义 | core/tools/src/define-tool.ts |
| DefinedToolAdapter | 文件即工具适配器 | 实现 Tool 抽象类，封装 Zod 校验+执行 | 注册到 ToolRegistry 的工具实例 | core/tools/src/define-tool.ts |
| DefineToolConfig | defineTool 配置 | description/inputSchema/outputSchema/needsApproval/toModelOutput | 文件即工具的全部配置 | core/tools/src/define-tool.ts |
| DynamicToolLoader | 动态工具加载器 | 扫描 agent/tools/ 目录动态 import .ts 工具 | 文件即 Agent 约定的工具发现 | core/tools/src/dynamic-tool-loader.ts |
| DynamicToolLoadResult | 加载结果 | loaded/failed/skipped 三类工具名 | 工具加载诊断 | core/tools/src/dynamic-tool-loader.ts |
| EmptyCommand / EmptyDescription | 命令/描述为空错误 | 终端创建时参数校验失败抛出 | 终端参数校验 | terminal-engine/src/error.rs |
| endsLoop | 结束循环标记 | 工具定义属性，标记调用后结束 agent loop | task_finish 工具 | core/tools/src/task/task_finish/tool.ts |
| ENV_WHITELIST | 环境变量白名单 | 允许透传到 PTY 子进程的环境变量集合 | 构建安全环境变量 | core/tools/src/terminal/pty.ts |
| errToString | 错误字符串提取 | 从 catch 的 unknown 值里取可读消息 | 工具 catch 块统一处理 | core/tools/src/browser/god_tool/use_browser/_util.ts |
| EventEmitFn | 事件发射器类型 | (event, data) => Record 的回调签名 | ToolExecutor 事件发射 | core/tools/src/executor.ts |
| execute | 工具执行方法 | Tool 抽象类必须实现的执行入口 | 所有工具调用 | core/tools/src/base.ts |
| executeAll | 批量执行工具调用 | 并行执行带并发控制（默认 10） | LLM 多工具调用 | core/tools/src/executor.ts |
| executeSingle | 单个工具调用 | 带权限检查和超时的单工具执行 | 工具执行管道 | core/tools/src/executor.ts |
| extractSignatures | 代码签名抽取 | 正则启发式抽函数/类/接口签名 | reader signatures 模式省 token | core/tools/src/compress/output-compressor.ts |
| FileEditRecord | 文件编辑记录 | 含 path/before/after/timestamp/toolCallId 的 diff 标记 | 支撑被影响文件的回退机制 | core/tools/src/file/file-edit-history.ts |
| FilterConfig | 过滤器配置 | 预设黑名单开关+自定义黑白名单+白名单模式 | 命令过滤器参数 | terminal-engine/src/filter.rs |
| FilterConfigNapi | 过滤器配置 NAPI | 导出给 JS 的 FilterConfig 结构 | napi set_filter 入参 | terminal-engine/src/lib.rs |
| find_code (CodeSearchTool) | 代码结构搜索工具 | 基于 sqry 搜函数/类/调用关系而非文本 | 谁调用了 X、循环依赖、死代码 | core/tools/src/code/find_code/tool.ts |
| find_skill (FindSkillTool) | 远程 skill 搜索与安装工具 | 从 skills.sh 搜索/安装 skill | 远程技能发现 | core/tools/src/skill/find_skill/tool.ts |
| findByToolCallId | 按 toolCallId 取编辑记录 | 关联上下文消息回退的精确查询 | 按 tool_call 回退编辑 | core/tools/src/file/file-edit-history.ts |
| fork_layer | 并发 fork 当前 ready task | 与 task_manage fork_layer 配合真并行 | 同层无依赖 task 并行执行 | core/tools/src/agent_team/agent_message/tool.ts |
| formatMetadata | 元数据格式化 | 拼接 key=value 元数据行只追加非空字段 | 工具结果 message 嵌入元数据 | core/tools/src/browser/god_tool/use_browser/_util.ts |
| from_persisted | 从持久化恢复 | 不恢复 PTY，仅元数据+ring buffer，running→interrupted | 进程重启恢复终端列表 | terminal-engine/src/terminal.rs |
| full (mode) | 完整读取模式 | reader 默认模式返回完整文件内容 | 读文件默认行为 | core/tools/src/reader/god_tool/reader/tool.ts |

### 2.3 G-I

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| generateAutoId | 自动生成终端 ID | auto_ + 6 位 hex 的随机 ID | 未指定 id 时生成临时终端名 | core/tools/src/terminal/registry.ts |
| getExecutionPlan | 生成执行计划 | 按 deps 拓扑排序返回可并行执行层级 | task_manage 渲染执行计划 | core/tools/src/task/task_manage/tool.ts |
| getSkillContent | 获取 skill 完整内容 | 按 name 取 SKILL.md 正文 | use_skill 工具加载 | core/tools/src/skill-context.ts |
| getTerminalReviewer | 获取小模型审核器 | 返回注入的 TerminalReviewer 或 null | auto 模式审核时取用 | core/tools/src/terminal/terminal-policy.ts |
| glob (GlobTool) | 文件名模式查找工具 | ripgrep 优先，Node 降级，按 mtime 排序 | 找文件路径 | core/tools/src/search/glob/tool.ts |
| globMatch | glob 模式匹配 | 支持 **, *, ? 的简易转正则 | Node 降级方案匹配 | core/tools/src/search/glob/tool.ts |
| god_tool | 上帝工具 | 各工具集的占位集成统一入口 schema | LLM schema 注入占位 | core/tools/src/skill/god_tool/skill/schema.json |
| grep (GrepTool) | 文件内容搜索工具 | ripgrep 透传，Node 降级，按文件归组 | 正则搜索代码 | core/tools/src/search/grep/tool.ts |
| groupGrepByFile | grep 按文件归组 | file:line:text 重组去重复路径前缀 | grep content 模式无损省 token | core/tools/src/compress/output-compressor.ts |
| hasRg | 检查 ripgrep 可用 | which rg 探测命令是否存在 | glob/grep 选实现 | core/tools/src/search/glob/tool.ts |
| hover (action) | 悬停信息 | 拿到符号的真实类型签名和文档 | LSP 语义查询 | core/tools/src/code/lsp/tool.ts |
| impact (action) | 修改影响范围 | 分析某符号修改后影响的依赖者 | 代码重构前评估 | core/tools/src/code/find_code/tool.ts |
| incrementalContent | 增量内容 | 检测 skill 变动后注入的 added/removed/updated 通知 | skill 上下文非首轮注入 | core/tools/src/skill-context.ts |
| init_engine | 初始化终端引擎（Rust napi） | 设置日志目录并启动 tracing | harness 启动时调用 | terminal-engine/src/lib.rs |
| initTerminalEngine | 初始化 Rust 终端引擎 | harness/server.ts 调用，失败时静默降级 | 进程启动 | core/tools/src/terminal/use_terminal/tool.ts |
| interrupted (state) | 已中断状态 | 进程重启恢复的 running 终端标记 | 持久化恢复 | core/tools/src/terminal/registry.ts |
| InternetSearchTool | 互联网搜索工具 | ddgr→DDG Lite→DDG Instant→Bing 四层降级 | 无需 API Key 的实时搜索 | core/tools/src/internet/search_internet/tool.ts |
| IPtyLike | 统一 PTY-like 接口 | pid/onData/onExit/write/kill/resize 抽象 | node-pty 与 spawn 降级统一 | core/tools/src/terminal/pty.ts |
| isAvailable | 可用性检查 | sqry/opencli 是否安装的探测 | 工具执行前检查依赖 | core/tools/src/code/find_code/tool.ts |
| isStaleSinceRead | 读后是否被外部改动 | 比较 mtime 检测读后被改 | 防盲改覆盖 | core/tools/src/file/read-registry.ts |

### 2.4 J-L

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| list (action) | 列出 | 列出全部资源（终端/笔记/看板/skill） | 各工具的查看操作 | core/tools/src/terminal/use_terminal/tool.ts |
| listAvailableSkills | 列出所有可用 skill | 扫描三层目录返回 SkillEntry 数组 | use_skill 未提供 name 时提示 | core/tools/src/skill-context.ts |
| listTerminals | 列出终端 | 供 runtime.ts 注入通知用 | 终端状态面板注入 | core/tools/src/terminal/use_terminal/tool.ts |
| LoadSkillTool | 加载专业知识工具 | 按 name 加载 SKILL.md 内容 | 处理不熟悉话题前加载 | core/tools/src/skill/use_skill/tool.ts |
| logger.rs | 结构化日志模块 | tracing + JSON 文件日志，可追溯 terminal_id/agent_name | 终端引擎审计 | terminal-engine/src/logger.rs |

### 2.5 M-O

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| MAX_BEFORE_CHARS | 单文件最大字符阈值 | 512KB，超出不存 before 防 OOM | undo 不可逆时的兜底 | core/tools/src/file/file-edit-history.ts |
| MAX_RECORDS_PER_SESSION | 单 session 最大记录数 | 50 条，超出丢弃最老 | 编辑历史内存控制 | core/tools/src/file/file-edit-history.ts |
| MAX_TERMINALS | 最大并行终端数 | 200 个，超限抛 MaxTerminalsReached | 终端引擎并发上限 | terminal-engine/src/registry.rs |
| markBlocked | 标记刚被拒/被问 | 记录时间戳供重复放行判定 | 误报兜底机制 | core/tools/src/terminal/terminal-policy.ts |
| mark_exited | 标记已退出（Rust） | running=false + state=Exited + 更新时间 | 命令正常结束 | terminal-engine/src/terminal.rs |
| mark_interrupted | 标记已中断（Rust） | 持久化恢复时把 running 转 interrupted | 进程重启恢复 | terminal-engine/src/terminal.rs |
| markRead | 登记已读 | 记录 mtimeMs 支撑先读后改 | read 工具读取后调用 | core/tools/src/file/read-registry.ts |
| ModelOutputValue | 模型输出值 | text/json/string 三种精简后输出形式 | toModelOutput 返回 | core/tools/src/define-tool.ts |
| nativeToolSchemas | 获取工具原生 schema | 优先 zodParameters 转换，否则 definition.parameters | 发送给 LLM | core/tools/src/base.ts |
| needsApproval | 是否需要人类审批 | DefineToolConfig 字段，bool 或 ApprovalPredicate | 文件即工具审批配置 | core/tools/src/define-tool.ts |
| needsApprovalFor | 检查是否需要审批 | 调用 ApprovalPredicate 返回 boolean | 工具执行前审批门 | core/tools/src/define-tool.ts |
| never (approval) | 从不审批 | 默认行为，直接放行 | 文件即工具默认 | core/tools/src/define-tool.ts |
| normalizeCommand | 规范化命令 | 去首尾空白、折叠中间空白 | 名单匹配前预处理 | core/tools/src/terminal/terminal-policy.ts |
| NotebookStore | 笔记存储 | 按 maouRoot 隔离的 notebooks.json + notebooks/ 读写 | 笔记文件持久化 | core/tools/src/notes/notebook/tool.ts |
| NotebookTool | 临时笔记工具 | create/read/write/mount/unmount/delete 笔记 | 任务相关重要事项防遗忘 | core/tools/src/notes/notebook/tool.ts |
| NotRunning | 终端已退出错误 | 已退出终端不能写入 | 终端写操作校验 | terminal-engine/src/error.rs |
| onSessionStart | 会话清理钩子 | 可选方法，session 开始时调用清理 session-scoped 数据 | 工具会话级状态重置 | core/tools/src/base.ts |
| once (approval) | 只在首次审批 | 首次后 approved=true 自动通过 | 一次性审批场景 | core/tools/src/define-tool.ts |

### 2.6 P-R

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| parallelSafe | 并行安全标记 | 工具定义属性，标记可并行执行 | 多工具调用调度 | core/tools/src/code/lsp/tool.ts |
| parseFrontmatter | 解析 YAML frontmatter | 从 SKILL.md 提取 --- 块的 meta | skill 文件解析 | core/tools/src/skill-context.ts |
| parseInstallSource | 解析安装源 | 支持 owner/repo@skill 与 GitHub URL | find_skill install 模式 | core/tools/src/skill/find_skill/tool.ts |
| parseSearchQuery | 解析搜索语法 | keywords/owner:/repo:/"精确" | find_skill search 模式 | core/tools/src/skill/find_skill/tool.ts |
| PathDenied | 路径被沙箱拒绝错误 | cwd 不在 allowed_paths 或在 denied_paths | 沙箱路径校验 | terminal-engine/src/error.rs |
| PersistedEntry | 持久化条目（TS） | 终端元数据落盘结构 | terminals.json 持久化 | core/tools/src/terminal/registry.ts |
| PersistedTerminal | 持久化终端结构（Rust） | 含 ring buffer 的完整终端序列化结构 | 原子持久化 | terminal-engine/src/terminal.rs |
| Persistence | 持久化管理器 | 临时文件→rename 原子写 + 加载恢复 | 终端元数据落盘 | terminal-engine/src/persistence.rs |
| persist_all | 持久化所有终端（Rust） | try_lock 跳过被持有锁防重入死锁 | 每次状态变更后调用 | terminal-engine/src/registry.rs |
| PolicyAction | 策略动作类型 | allow/deny/ask/review 四种 | 终端审批决策 | core/tools/src/terminal/terminal-policy.ts |
| PolicyDecision | 策略决策 | action+reason+matched 的决策对象 | 终端审批返回 | core/tools/src/terminal/terminal-policy.ts |
| PolicyFile | 策略文件 | mode+whitelist+blacklist 的 terminal-policy.json | 终端审批持久化 | core/tools/src/terminal/terminal-policy.ts |
| PRESET_BLACKLIST | 预设危险命令黑名单 | rm -rf /、mkfs、fork bomb 等不可移除 | 终端命令安全底线 | terminal-engine/src/filter.rs |
| preset_blacklist_enabled | 预设黑名单开关 | 是否启用预设危险命令拦截 | 过滤器配置 | terminal-engine/src/filter.rs |
| ProjectManageTool | 项目管理工具 | list/create/disband/members/add-agent/message | 全局 Agent 管理项目 | core/tools/src/project/project_manage/tool.ts |
| pty.ts | PTY 后端封装 | node-pty 优先，child_process.spawn 降级 | 终端 PTY 抽象层 | core/tools/src/terminal/pty.ts |
| PtySpawnFailed | PTY 创建失败错误 | portable-pty spawn 失败抛出 | 终端创建错误处理 | terminal-engine/src/error.rs |
| read (action) | 读取 | 读取本地文件/URL/图片 | reader 工具主入口 | core/tools/src/reader/god_tool/reader/tool.ts |
| ReadRecord | 已读记录 | 含 mtimeMs 用于检测读后被外部改动 | 先读后改安全语义 | core/tools/src/file/read-registry.ts |
| ReadTool | 读文件工具 | 支持 full/signatures 两种模式 | 读文件/网页/图片 | core/tools/src/reader/god_tool/reader/tool.ts |
| readBefore | 读取当前文件内容 | 文件不存在返回 null 表示新建 | record 时获取 before | core/tools/src/file/file-edit-history.ts |
| read-registry.ts | 已读文件登记表 | 支撑先读后改安全语义的进程内 Map | 盲改覆盖防护 | core/tools/src/file/read-registry.ts |
| recentlyBlocked | 最近被拒/被问 Map | agentName::cmd → 时间戳 | 重复放行窗口判定 | core/tools/src/terminal/terminal-policy.ts |
| record (file-edit-history) | 登记文件编辑 | 在 atomicWrite 之前存下 before 内容 | 支撑 undo 回退 | core/tools/src/file/file-edit-history.ts |
| recordReviewApprove | 小模型审核通过记录 | 入白名单 | auto 模式审核通过 | core/tools/src/terminal/terminal-policy.ts |
| recordReviewReject | 小模型审核拒绝记录 | 入黑名单+标记可重复放行 | auto 模式审核拒绝 | core/tools/src/terminal/terminal-policy.ts |
| refreshRead | 写入/编辑后刷新登记 | 写完即视为已读最新内容 | edit/write 后调用 | core/tools/src/file/read-registry.ts |
| REGISTRY | 全局注册表单例（Rust） | Lazy<Arc<TerminalRegistry>> | napi 函数访问入口 | terminal-engine/src/lib.rs |
| remove (action) | 删除终端 | kill+移除某 agent 的终端 | use_terminal manage rm | core/tools/src/terminal/use_terminal/tool.ts |
| restore (TaskManager) | 从持久化恢复状态 | 进程启动时从 task_plan.json 加载 | 任务清单恢复 | core/tools/src/task/task_manage/tool.ts |
| review (action) | 小模型审核 | auto 模式非名单命令交审核器 | 终端审批决策 | core/tools/src/terminal/terminal-policy.ts |
| ring buffer | 环形缓冲 | 按行存储终端输出，超 RING_MAX_LINES 丢弃最老 | 终端输出截断保留 | terminal-engine/src/terminal.rs |
| RING_MAX_LINES | ring buffer 最大行数 | 2000 行 | 终端输出上限 | terminal-engine/src/terminal.rs |
| run / run_background | 创建终端执行（Rust napi） | 前台阻塞/后台运行命令 | use_terminal 底层调用 | terminal-engine/src/lib.rs |
| RunResult | 运行结果 | ok/exit_code/output/duration_ms/terminal_id/error | napi 返回给 JS | terminal-engine/src/lib.rs |

### 2.7 S-U

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| safePath | 安全路径解析 | 防止 ../../etc/passwd 路径越界 | read/write/edit 共用 | core/tools/src/browser/god_tool/use_browser/_util.ts |
| Sandbox | V1 沙箱 | 路径限制+命令过滤+提示词注入 | 终端 cwd 路径校验 | terminal-engine/src/sandbox.rs |
| SandboxConfig | 沙箱配置 | enabled/allowed_paths/denied_paths/inject_prompt | 沙箱参数 | terminal-engine/src/sandbox.rs |
| SandboxConfigNapi | 沙箱配置 NAPI | 导出给 JS 的 SandboxConfig | napi set_sandbox 入参 | terminal-engine/src/lib.rs |
| search (action) | 按名搜符号 | 支持 kind/lang/exact/fuzzy 过滤 | find_code 主操作 | core/tools/src/code/find_code/tool.ts |
| searchOne | 单查询降级链 | ddgr→DDG Lite→DDG Instant→Bing | search_internet 单查询 | core/tools/src/internet/search_internet/tool.ts |
| searchWithNode | Node.js 原生搜索 | ripgrep 不可用时的降级实现 | grep 降级方案 | core/tools/src/search/grep/tool.ts |
| searchWithRg | ripgrep 搜索 | 透传 rg 参数 search | grep 优先实现 | core/tools/src/search/grep/tool.ts |
| selectLayer | 选出可并行执行的一层 task | deps 全 completed + 自身未完成的 ready task | task_manage fork_layer | core/tools/src/task/task_manage/tool.ts |
| selectNext | 选出下一个应执行的任务 | 向后兼容返回 ready 中 id 最小的一个 | task_finish 后推进 | core/tools/src/task/task_manage/tool.ts |
| setEnabledSkills | 设置启用 skill 列表 | 过滤扫描结果只保留启用项 | skill 上下文编译 | core/tools/src/skill-context.ts |
| setPersistCallback | 注入持久化回调 | 解耦 TaskManager 与 TaskSessionStore | runtime 注入 task_plan.json 同步 | core/tools/src/task/task_manage/tool.ts |
| setPersistPath | 设置持久化路径 | 同时加载已持久化的终端 | 进程启动恢复 | core/tools/src/terminal/registry.ts |
| set_sandbox | 设置沙箱配置（Rust napi） | 更新沙箱 allowed/denied paths | 运行时沙箱调整 | terminal-engine/src/lib.rs |
| set_filter | 设置命令过滤器（Rust napi） | 更新黑白名单与白名单模式 | 运行时过滤调整 | terminal-engine/src/lib.rs |
| setTerminalFilter | 设置命令过滤器 | 封装 engine.setFilter 的 best-effort | harness 配置注入 | core/tools/src/terminal/use_terminal/tool.ts |
| setTerminalPolicyRoot | 配置策略文件根目录 | harness 初始化时设置 ~/.maou | 策略文件路径定位 | core/tools/src/terminal/terminal-policy.ts |
| setTerminalReviewer | 注入小模型审核器 | auto 模式用，由 harness 注入 LLM 访问 | 终端命令自动审核 | core/tools/src/terminal/terminal-policy.ts |
| setTerminalSandbox | 设置沙箱配置 | 封装 engine.setSandbox 的 best-effort | harness 配置注入 | core/tools/src/terminal/use_terminal/tool.ts |
| shutdown | 关闭所有终端（Rust napi） | kill 全部 + 清空 + 持久化 | 进程退出清理 | terminal-engine/src/lib.rs |
| shutdownLspEngine | 关 LSP 引擎 | 调 lsp.shutdownAll 关语言服务器进程 | harness 退出时 | core/tools/src/code/lsp/tool.ts |
| shutdownTerminalEngine | 关闭所有终端 | 封装 engine.shutdown 的 best-effort | harness 进程退出 | core/tools/src/terminal/use_terminal/tool.ts |
| signatures (mode) | 签名模式 | 只返回函数/类/接口签名剥掉函数体 | 读大代码文件省 token | core/tools/src/reader/god_tool/reader/tool.ts |
| SkillChange | skill 变动 | added/removed/updated 三类变动 | 增量注入通知 | core/tools/src/skill-context.ts |
| SkillContextManager | skill 上下文管理器 | 烘焙首轮+增量注入变动 | skill 上下文编译 | core/tools/src/skill-context.ts |
| SkillContextResult | skill 上下文结果 | bakedContent+incrementalContent+currentSkills+hasChanges | compile 返回 | core/tools/src/skill-context.ts |
| SkillEntry | skill 条目 | name/description/version/content/sourcePath/source | skill 元数据 | core/tools/src/skill-context.ts |
| SkillScanner | skill 扫描器 | 三层目录扫描按优先级合并 | 发现可用 skill | core/tools/src/skill-context.ts |
| SkillSearchResult | skill 搜索结果 | id/owner/repo/skill/installs/url | find_skill search 返回 | core/tools/src/skill/find_skill/tool.ts |
| SKIP_DIRS | 跳过目录集 | node_modules/.git/dist 等自动忽略 | Node 降级方案 | core/tools/src/search/glob/tool.ts |
| SpawnPtyAdapter | spawn 降级适配器 | child_process 包装为 IPtyLike，无 PTY 能力 | node-pty 不可用时降级 | core/tools/src/terminal/pty.ts |
| SpawnPtyOptions | PTY 创建选项 | cwd/env/cols/rows | spawnPty 入参 | core/tools/src/terminal/pty.ts |
| spawnPty | 工厂函数创建 PTY | 优先 node-pty，失败降级 SpawnPtyAdapter | 终端 PTY 实例化 | core/tools/src/terminal/pty.ts |
| sqry | 代码结构搜索引擎 | 基于 sqry 二进制的代码图搜索 | find_code 底层引擎 | core/tools/src/code/find_code/tool.ts |
| status_panel | 终端状态面板（Rust napi） | 生成某 agent 的终端列表 markdown 表格 | 注入 before_user 提示 | terminal-engine/src/lib.rs |
| statusPanel | 状态面板文本 | TS 侧封装的引擎状态面板获取 | prompt 注入终端状态 | core/tools/src/terminal/use_terminal/tool.ts |
| stripNoise | 去 ANSI 转义码+回车噪声 | 去进度条/回车覆盖行+ANSI 码 | 工具输出去噪 | core/tools/src/compress/output-compressor.ts |
| strip_ansi | 剥离 ANSI 转义序列（Rust） | ESC [ ... letter / OSC 序列剥离 | 给 AI 看纯文本终端输出 | terminal-engine/src/lib.rs |
| SubagentTool | 子 Agent 工具 | fork/fork_layer 真并行执行子任务 | 并行任务拆分 | core/tools/src/agent_team/agent_message/tool.ts |
| SubagentExecutor | 子 Agent 执行器 | runtime 注入的 fork/forkLayer 实现接口 | 真并行子 Agent 执行 | core/tools/src/agent_team/agent_message/tool.ts |
| symbols (action) | 列文件符号 | LSP documentSymbols 返回文件内符号列表 | 代码结构概览 | core/tools/src/code/lsp/tool.ts |
| SymbolLite | 符号轻量表示 | kind/name/containerName/file/line | LSP 符号结果 | core/tools/src/code/lsp/tool.ts |
| TERMINAL_REGISTRY | 终端注册表单例（TS） | 全局 TerminalRegistry 实例 | 进程级终端管理 | core/tools/src/terminal/registry.ts |
| Terminal (TS class) | 终端实例 | 封装 PTY+ring buffer+状态机 | 常驻终端管理 | core/tools/src/terminal/registry.ts |
| Terminal (Rust struct) | 终端实例（Rust） | portable-pty 封装+独立线程读输出 | 终端引擎核心 | terminal-engine/src/terminal.rs |
| terminal_count | 终端数量（Rust napi） | 返回当前注册表终端总数 | 监控并发数 | terminal-engine/src/lib.rs |
| TerminalError | 终端错误类型枚举 | 覆盖 100% 终端操作错误场景 | 统一错误处理 | terminal-engine/src/error.rs |
| TerminalEvent | 终端事件 | terminal_id/event_type/data/exit_code/error/timestamp | napi 流式回调 | terminal-engine/src/lib.rs |
| TerminalInfo | 终端信息（Rust） | 返回给 JS 的终端元数据 | napi list 返回 | terminal-engine/src/registry.rs |
| TerminalInfoNapi | 终端信息 NAPI | TerminalInfo 的 napi 导出形式 | napi list 返回 | terminal-engine/src/lib.rs |
| TerminalMode | 终端模式 | normal/auto/yolo 三种审批模式 | 终端命令审批策略 | core/tools/src/terminal/terminal-policy.ts |
| TerminalRegistry (TS) | 终端注册表 | 进程内 Map 持久化+状态面板 | agent 级隔离终端管理 | core/tools/src/terminal/registry.ts |
| TerminalRegistry (Rust) | 终端注册表（Rust） | DashMap 并发安全支持 200 并行 | 终端引擎核心注册表 | terminal-engine/src/registry.rs |
| TerminalResult | Result 类型别名（Rust） | Result<T, TerminalError> | Rust 错误传播 | terminal-engine/src/error.rs |
| TerminalReviewer | 小模型审核器类型 | (command, ctx) => {approve, reason} | auto 模式注入 | core/tools/src/terminal/terminal-policy.ts |
| TerminalState (TS) | 终端状态 | running/exited/interrupted | 终端生命周期 | core/tools/src/terminal/registry.ts |
| TerminalState (Rust enum) | 终端状态（Rust） | Running/Exited/Interrupted/Killed | 终端引擎状态机 | terminal-engine/src/terminal.rs |
| TerminalTool | 终端工具 | run/manage/write 三种 action | 执行 shell 命令或管理常驻终端 | core/tools/src/terminal/use_terminal/tool.ts |
| Timeout | 超时错误 | 终端执行超时抛出含 timeout_ms | 前台命令超时控制 | terminal-engine/src/error.rs |
| to_persisted | 序列化为持久化结构（Rust） | 含 ring buffer 的完整序列化 | 原子持久化 | terminal-engine/src/terminal.rs |
| ToModelOutput | 工具输出精简函数 | 将完整输出精简为模型需要看到的内容 | 文件即工具输出裁剪 | core/tools/src/define-tool.ts |
| touch_viewed | 更新最后查看时间（Rust） | 记录 last_viewed_at | logs 操作后调用 | terminal-engine/src/terminal.rs |
| tracePath | 跟踪两符号间调用链 | find_code path action 起点→终点 | 调用路径分析 | core/tools/src/code/find_code/tool.ts |
| TRANSCRIPT_MAX | ring buffer 最大行数常量 | 2000 行 | TS 侧终端输出上限 | core/tools/src/terminal/registry.ts |
| truncateMiddle | 截断长文本 | 保留头部+尾部，中间标注省略字符数 | 工具结果超长截断 | core/tools/src/compress/output-compressor.ts |
| tryBing | Bing HTML 抓取 | 国内 fallback 解析 b_algo 卡片 | search_internet 最末降级 | core/tools/src/internet/search_internet/tool.ts |
| tryDdgr | ddgr CLI 搜索 | 优先调用本地 ddgr 命令 | search_internet 首选 | core/tools/src/internet/search_internet/tool.ts |
| tryDdgInstant | DDG Instant Answer API | DuckDuckGo 即时答案接口 | search_internet 第三降级 | core/tools/src/internet/search_internet/tool.ts |
| tryDdgLite | DDG Lite HTML | 抓取 lite.duckduckgo.com 解析链接 | search_internet 第二降级 | core/tools/src/internet/search_internet/tool.ts |
| try_wait_exit | 非阻塞检查退出（Rust） | child.try_wait 返回 Some/None | 轮询等待终端退出 | terminal-engine/src/terminal.rs |
| undo (file-edit-history) | 回退最近一次编辑 | 写回 before 内容，新建文件删除 | undo_edit 工具核心 | core/tools/src/file/file-edit-history.ts |
| undo_edit (UndoEditTool) | 撤销编辑工具 | 回退最近一次 edit_file/write_file | 文件操作回退 | core/tools/src/file/undo_edit/tool.ts |
| undoByToolCallId | 按 toolCallId 回退 | 关联上下文消息回退某次编辑 | 精确回退 | core/tools/src/file/file-edit-history.ts |
| unused (action) | 死代码检测 | find_code 检测未使用符号 | 代码清理 | core/tools/src/code/find_code/tool.ts |

### 2.8 V-Z

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| verifyAfterWrite | 写入后 LSP 自我验证 | 写文件后用 LSP 立刻检查是否引入错误 | 自我验证闭环 | core/tools/src/code/lsp_verify.ts |
| walkDir | 递归遍历目录 | 收集匹配文件按 mtime 排序 | glob Node 降级方案 | core/tools/src/search/glob/tool.ts |
| wasRead | 该文件是否被读过 | 查询 session 内某路径的已读登记 | edit/write 先读后改校验 | core/tools/src/file/read-registry.ts |
| when (approval) | 根据输入动态决定 | 接收 toolInput 返回是否审批 | 自定义审批条件 | core/tools/src/define-tool.ts |
| whitelist | 白名单 | 命令审批中直接放行的规则列表 | 终端命令快速通过 | core/tools/src/terminal/terminal-policy.ts |
| whitelist_mode | 白名单模式 | 仅白名单中的命令可执行 | 严格终端命令控制 | terminal-engine/src/filter.rs |
| workspace_symbols (action) | 全工程搜符号 | LSP workspaceSymbols 按 query 搜全工程 | 跨文件符号查找 | core/tools/src/code/lsp/tool.ts |
| write (Rust napi) | 写入终端 | 键盘输入模拟发送到运行中终端 | use_terminal action=write | terminal-engine/src/lib.rs |
| WriteFileTool | 写文件工具 | 创建或覆写文件，含先读后改+LSP 验证 | 创建/覆写文件 | core/tools/src/file/write_file/tool.ts |
| yolo (mode) | yolo 模式 | 无视黑白名单与风险全部执行 | 信任环境快速执行 | core/tools/src/terminal/terminal-policy.ts |
| zodToJsonSchema | Zod 转 JSON Schema | 使用 zod-to-json-schema 转换供 LLM 用 | 工具参数定义 | core/tools/src/schema-utils.ts |
| zodToToolSchema | Zod 转工具 schema | 包含 name/description/parameters 的完整 schema | 工具 nativeToolSchemas 生成 | core/tools/src/schema-utils.ts |

---

## 3. context + prompt 包

`core/context/src/`（17 文件 + types/ 2 文件）+ `core/prompt/src/`（9 文件）。

### 3.1 A-C

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| ActiveSession | 活跃会话 | agent 当前激活会话的状态记录（含 status/pausedAt/rollingSummary） | 多 agent 会话切换调度 | core/context/src/types.ts |
| appendMaouMessage | 追加 Maou 消息 | 以 MaouMessage 格式追加并自动转 SessionMessage 存储 | agent 回合结束落盘 | core/context/src/session-store.ts |
| appendMessage | 追加会话消息 | 向 JSONL 追加 type=message 事件并刷新 meta | 用户/助手/工具消息入会话 | core/context/src/session-store.ts |
| appendRawEntry | 追加原始日志 | 写入 LLM 调用 raw 条目并触发轮转/限流 | 调试与 post-log 回放 | core/context/src/session-store.ts |
| appendTrace | 追加 trace | 把调试 trace 事件写入会话 JSONL | model.usage/request 追踪 | core/context/src/session-store.ts |
| ARCHIVE_TRIGGER_PERCENT | 归档阈值 | token 占比≥90% 时升级到 archive_zone | 极端场景归档触发 | core/context/src/constants.ts |
| archiveStage | 归档阶段 | 大压缩后只剩任务块 ID+极简摘要的极端压缩产出 | 极端压缩阶段 | core/context/src/types/compression.ts |
| archiveCompressHarness | 归档压缩执行 | 保留 system/pinned + 每个 task 的 ID+摘要片段 | archiveStage 内部执行 | core/context/src/compressor.ts |
| assignTaskIds | 分配任务 ID | 按用户发言边界给历史消息打 t<seqId> 标签 | 压缩前分组 | core/context/src/compressor.ts |
| atomicWrite | 原子写入 | 先写 .tmp 再 rename 保证原子性 | JSONL/meta 落盘防损坏 | core/context/src/task-session-store.ts |
| atomicWriteJson | 原子写 JSON | 同 atomicWrite，序列化为 JSON | meta/state 落盘 | core/context/src/session-store.ts |
| AutoCompressConfig | 自动压缩配置 | enabled/mode/maxTokens + legacy/staged 子配置 | 配置压缩策略 | core/context/src/auto-compress.ts |
| AutoCompressResult | 自动压缩结果 | 含 compressed/stage/history/droppedSummary/taskBlocks | 一次压缩执行的产出 | core/context/src/auto-compress.ts |
| AutoCompressSession | 自动压缩会话 | 封装 history+policy+stage 的会话级压缩器 | 持续运行时自动压缩 | core/context/src/auto-compress.ts |
| backupBeforeCompress | 压缩前备份 | 把当前上下文快照到 backup 文件 | 压缩前数据保护 | core/context/src/harness-session-store.ts |
| BakeFile | 烘焙文件 | 监听文件变化并按 diff/snapshot/full 模式增量注入 | 注入 README/package.json 等动态文件 | core/context/src/bake-file.ts |
| BakeFileOptions | 烘焙选项 | tag/path/hint/mode/maxPendingDiffs | 创建 BakeFile | core/context/src/bake-file.ts |
| BakeMode | 烘焙模式 | listen/diff/snapshot/full 四种策略 | 控制注入粒度 | core/context/src/bake-file.ts |
| bake | 烘焙工厂 | 一行创建 BakeFile，默认 diff 模式 | 简易使用入口 | core/context/src/bake-file.ts |
| bakedContext | 烘焙上下文区 | 用户偏好、项目信息等不变区域 + 增量注入 | 注入稳定上下文 | core/context/src/types.ts |
| beforeUserContent | 用户前区 | BEFORE_USER.md 编译内容（首轮注入） | 注入用户消息前 | core/context/src/types.ts |
| buildMessages | 构建消息 | 按槽位顺序组装发送 LLM 的完整消息数组 | 每轮 LLM 调用前 | core/context/src/message-builder.ts |
| buildPlatformContext | 构建平台上下文 | 生成标准化平台上下文文本（含回复机制/输出约束） | 飞书/微信插件注入 | core/context/src/platform-context.ts |
| buildDroppedSummary | 构建丢弃摘要 | user/assistant 片段+taskSummary 拼装 | 生成 droppedSummary | core/context/src/compressor.ts |
| BuildMessagesParams | 消息构建参数 | systemPrompt/sessionMessages/userOpts/compressedHistory 等完整入参 | 调用 buildMessages | core/context/src/types.ts |
| BuildPlatformContextOptions | 平台上下文选项 | platformName/chatType/extraInstructions | 调用 buildPlatformContext | core/context/src/platform-context.ts |
| CharacterBook | 角色词典 | SillyTavern 兼容世界书（global + entries） | 触发词注入 | core/prompt/src/persona/types.ts |
| CharacterBookEntry | 词典条目 | keys/content/enabled/order/position | 词条定义 | core/prompt/src/persona/types.ts |
| CharacterCard | 角色卡 | 兼容 SillyTavern V2 + 扩展字段（人设/性格/外貌/背景/关系/词典） | 角色扮演 persona 数据结构 | core/prompt/src/persona/types.ts |
| CheckpointStore | 快照存储 | 会话快照创建/回滚/差异比较 | 风险操作前快照保护 | core/context/src/checkpoint-store.ts |
| CheckpointMeta | 快照元信息 | id/sessionId/label/messageCount/createdAt/autoCheckpoint | 列表展示快照 | core/context/src/types.ts |
| CheckpointDiff | 快照差异 | addedMessages/removedMessages/messageSnippets | 比较快照演进 | core/context/src/types.ts |
| collectRecentToolChain | 收集最近工具链 | 从末尾往前找 2 对 tool_call/tool_result | 大压缩保护最近工具调用 | core/context/src/compressor.ts |
| compactStage | 微压缩阶段 | 70% 触发，滑动窗口+标注压缩（无需 LLM） | 第一级压缩 | core/context/src/types/compression.ts |
| compactByCategory | 按类别压缩 | 按 user/assistant/tool_call 等生成短摘要 | 微压缩规则化压缩 | core/context/src/compressor.ts |
| CompilePersonaOptions | 编译角色卡选项 | includeFirstMessage/includeMesExample/includeCharacterBook/sectionOrder | 调用 compilePersona | core/prompt/src/persona/compiler.ts |
| CompileResult | 编译结果 | content/entryPath/elapsedMs/includedFiles/executedScripts/warnings | 预览渲染入参 | core/prompt/src/compiler/types.ts |
| compileDynamicContextTemplate | 编译动态上下文 | 纯模板组装 agent_status + terminal_status | 每轮动态注入 | core/prompt/src/dynamic/format-status.ts |
| compilePersona | 编译角色卡 | 把 CharacterCard 编译成 system prompt 片段 | 注入角色人设 | core/prompt/src/persona/compiler.ts |
| compilePersonas | 编译多角色卡 | 群聊场景多角色卡合并+关系网交叉引用 | 群聊 persona | core/prompt/src/persona/compiler.ts |
| compileProjectContext | 编译项目上下文 | 加载 .maou/context/ 三文件并拼成注入文本 | 注入项目级规则 | core/context/src/project-context.ts |
| compileSection | 编译单段落 | 按 PersonaSection 类型生成对应 # 段落 | 角色卡分块编译 | core/prompt/src/persona/compiler.ts |
| compressMaou | Maou 压缩器 | async 主入口，五阶段分阶段，操作 MaouMessage[] | 实际压缩执行 | core/context/src/compressor.ts |
| CompressMode | 压缩模式 | legacy（传统）/staged（分段）两种 | 配置压缩策略 | core/context/src/auto-compress.ts |
| CompressOptions | 压缩选项 | maxTokens/summarizer/sessionId/maxStage/activeTaskIds | 调用 compressMaou | core/context/src/compressor.ts |
| CompressPolicy | 压缩策略接口 | shouldCompress(history, config) 决定是否触发 | 自定义触发逻辑 | core/context/src/auto-compress.ts |
| CompressReport | 压缩报告 | stage/originalTokens/compressedTokens/taskBlocks/droppedSummary | 一次压缩的简报 | core/context/src/context-engine.ts |
| CompressMaouResult | Maou 压缩结果 | history/stage/droppedSummary/perTaskOriginals 等 | compressMaou 返回 | core/context/src/compressor.ts |
| CompressResult | 压缩结果（旧） | messages/compressed/stage/originalTokens 等 | maybeCompress 返回 | core/context/src/types.ts |
| CompressionConfig | 压缩配置 | enabled/stage/triggerThreshold | 配置压缩阶段 | core/context/src/types/compression.ts |
| CompressionResult | 压缩结果（types） | stage/originalTokens/compressedTokens/summary/taskBlocks | 压缩产出结构 | core/context/src/types/compression.ts |
| CompressionStage | 压缩阶段类型 | static/archive/summary/compact/active 五态 | 标记当前压缩级别 | core/context/src/types/compression.ts |
| ContextBuilder | 上下文构建器接口 | buildMessages + maybeCompress 抽象接口 | 替换实现 | core/context/src/types.ts |
| ContextEngine | 上下文引擎 | 编排 assignTaskIds+compress+persist+toLLMHistory 闭环 | runtime 上下文调度核心 | core/context/src/context-engine.ts |
| ContextEngineOptions | 引擎选项 | sessionId/harnessStore/taskStore/summarizer | 构造 ContextEngine | core/context/src/context-engine.ts |
| CONTEXT_THRESHOLD_PERCENT | 旧阈值常量 | v1 遗留，等价 MICRO_TRIGGER_PERCENT | 兼容外部引用 | core/context/src/constants.ts |
| CONTEXT_KEEP_RECENT_PERCENT | 旧保留百分比 | v1 遗留，新算法按 zone 决策 | 兼容外部引用 | core/context/src/constants.ts |
| createTaskBlock | 创建任务块 | 写入 type=block 条目（含 summary/outline/goal） | 归档任务原文 | core/context/src/task-session-store.ts |
| CreatePersonaOptions | 创建角色卡选项 | display_name/description/personality/scenario/appearance/background 等 | 调用 PersonaRegistry.create | core/prompt/src/persona/types.ts |

### 3.2 D-F

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| DEFAULT_AUTO_COMPRESS_CONFIG | 默认自动压缩配置 | enabled=true, maxTokens=65536, mode=staged | 不传配置时回退 | core/context/src/auto-compress.ts |
| DEFAULT_LEGACY_CONFIG | 默认传统配置 | triggerPercent=80, keepRecentRounds=3 | 传统模式默认值 | core/context/src/auto-compress.ts |
| DEFAULT_STAGED_CONFIG | 默认分段配置 | compact/summary/archive=70/80/90, activeWindow=40 | 分段模式默认值 | core/context/src/auto-compress.ts |
| DEFAULT_SUMMARIZER_PROMPT | 默认摘要提示词 | LLM 摘要任务的系统提示 | 生成结构化摘要 | core/context/src/auto-compress.ts |
| DEFAULT_AGENT_ROUND_LIMIT | 默认轮次上限 | 0=无限循环（v1 默认） | 限制 agent 循环 | core/context/src/constants.ts |
| DEFAULT_LOOP_THRESHOLD | 默认循环检测阈值 | 10 轮触发循环检测 | 防止死循环 | core/context/src/constants.ts |
| DEFAULT_PRIORITY_CONFIG | 默认优先级配置 | v1 遗留优先级规则 | 兼容外部引用 | core/context/src/constants.ts |
| DEFAULT_RULES | 默认提取规则 | 4 类正则模式（偏好/项目事实/错误/重要约定） | 默认记忆提取 | core/context/src/memory-extractor.ts |
| DiffEntry | diff 条目 | version+content 单条 diff 记录 | BakeFile 链式 diff | core/context/src/bake-file.ts |
| droppedSummary | 丢弃摘要 | 被压缩掉历史的结构化摘要文本 | 注入 prior_context_summary | core/context/src/types.ts |
| ensure | 确保会话 | 不存在则用指定 ID/agent 创建 | runtime 启动保证会话存在 | core/context/src/session-store.ts |
| estimateTokens | 估算 token | CJK 1 token/字，ASCII 4 chars/token | 压缩阈值判定 | core/context/src/token-estimate.ts |
| estimateTokensFromText | 文本估算 token | 同上但单字符串 | 单段文本 token 估算 | core/context/src/token-estimate.ts |
| executePythonScript | 执行 Python 脚本 | execFileSync + 双层缓存（进程内+文件 TTL 30 分钟） | {{>>script}} 脚本执行 | core/prompt/src/compiler/prompt-compiler.ts |
| exportCard / exportCards | 导出角色卡 | 导出为 SillyTavern V2 JSON（含 spec/spec_version） | 跨平台迁移 | core/prompt/src/persona/importer.ts |
| extractMemories | 提取记忆 | 用正则规则从 user 消息提取结构化记忆 | 会话结束自动沉淀 | core/context/src/memory-extractor.ts |
| ExtractionRule | 提取规则 | category/patterns/keyTemplate/valueTemplate/tags | 自定义记忆提取 | core/context/src/memory-extractor.ts |
| ExtractedMemory | 提取结果 | key/value/category/tags（未持久化前） | 提取后转 MemoryEntry | core/context/src/types.ts |
| fallbackSummary | 回退摘要 | 无 summarizer 时按 category 拼装的规则化摘要 | 摘要失败降级 | core/context/src/auto-compress.ts |
| findRecentRoundsBoundary | 找最近轮边界 | 从末尾往前数 X 轮 user 消息定位索引 | legacy 模式保留最近轮 | core/context/src/auto-compress.ts |
| forceCompress | 强制压缩 | 立即触发一次压缩 | 调试或手动压缩 | core/context/src/auto-compress.ts |
| forkSession | Fork 会话 | 复制源会话消息+元数据创建新会话 | 分支实验 | core/context/src/session-store.ts |
| forkAndSwitch | Fork 并切换 | Fork 源会话后切到新会话 | 多会话实验切换 | core/context/src/session-manager.ts |
| formatAgentStatus | 格式化角色状态 | 渲染 agent_status XML（排除 main 角色） | 动态注入 | core/prompt/src/dynamic/format-status.ts |
| formatRelationship | 格式化关系 | 关系类型中文化+好感度标签 | 角色卡关系网展示 | core/prompt/src/persona/compiler.ts |
| formatTerminalStatus | 格式化终端状态 | 渲染 terminal_status XML | 动态注入 | core/prompt/src/dynamic/format-status.ts |

### 3.3 G-I

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| getBySeqId | 按 seqId 回溯 | 返回该 id 及之前的所有 MaouMessage | 时间点回溯 | core/context/src/harness-session-store.ts |
| getBackup | 取备份上下文 | 读 harness_session_backup.json | 回溯用 | core/context/src/harness-session-store.ts |
| getCompressedZone | 取压缩区 | 读 compressed_zone.json（zone/summary/taskBlocks） | 恢复压缩状态 | core/context/src/harness-session-store.ts |
| getCurrent | 取当前上下文 | 读 harness_session.json 的 MaouMessage[] | 加载会话工作上下文 | core/context/src/harness-session-store.ts |
| getDroppedSummary | 取丢弃摘要 | 返回 lastCompressReport.droppedSummary | 注入 compressed_summary 槽 | core/context/src/context-engine.ts |
| getHistory | 取工作上下文 | 返回引擎当前 history | 调试/查看 | core/context/src/context-engine.ts |
| getLastCompressReport | 取最近压缩报告 | 返回 lastCompressReport | 查看上次压缩信息 | core/context/src/context-engine.ts |
| getRollingSummary | 取滚动摘要 | 返回 sessionId 对应的滚动摘要 | 跨会话上下文 | core/context/src/session-manager.ts |
| getScriptCache | 取脚本缓存 | 进程内+文件双层 TTL 30 分钟读取 | 加速重复脚本执行 | core/prompt/src/compiler/prompt-compiler.ts |
| getTaskBlock | 取任务块 | 读 JSONL 组装 MaouTaskBlock | 恢复任务原文 | core/context/src/task-session-store.ts |
| groupByTask | 按任务分组 | 按 taskIds 把消息归组（含 __no_task__） | 大压缩分批 | core/context/src/compressor.ts |
| HarnessSessionStore | Harness 会话存储 | 管理当前上下文 + 压缩前备份双份存储 | ContextEngine 落盘后端 | core/context/src/harness-session-store.ts |
| HarnessSessionStoreOptions | Harness 选项 | maouRoot（默认 ~/.maou） | 构造 HarnessSessionStore | core/context/src/harness-session-store.ts |
| importCard / importCards | 导入角色卡 | 从 JSON 字符串导入（支持 V2 + 简化格式） | 跨平台迁移 | core/prompt/src/persona/importer.ts |
| initFromSessionMessages | 从 SessionMessage 初始化 | 旧会话首次进入引擎时转换+assignTaskIds | 冷启动 | core/context/src/context-engine.ts |
| injectHook | 注入 hook 消息 | 把 source=hook 的 user 消息写入会话 | 钩子触发器 | core/context/src/session-store.ts |
| injectPendingToolInterrupts | 注入中断结果 | 检测未配对 tool_call，自动补 tool 消息 | 防止 API 报错 | core/context/src/session-store.ts |
| injectUserContext | 注入用户上下文 | BEFORE_USER/动态注入/实际用户消息合并 | 首轮/子轮消息注入 | core/context/src/message-builder.ts |

### 3.4 J-L

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| LegacyCompressConfig | 传统压缩配置 | triggerPercent/keepRecentRounds/summarizerPrompt/summaryModel | 配置 legacy 模式 | core/context/src/auto-compress.ts |
| legacyCompress | 传统压缩执行 | 超阈值→保留 X 轮→剩余 LLM 摘要 | legacy 模式压缩 | core/context/src/auto-compress.ts |
| LLMMessage | LLM 消息 | 发送给 LLM API 的标准格式（role/content/tool_calls/tool_call_id） | 适配器输入 | core/context/src/types/message.ts |
| LLMToolCall | LLM 工具调用 | LLM API 返回格式（id/name/arguments，区别于内部 ToolCall 的 parameters） | 适配 LLM 工具调用 | core/context/src/types/message.ts |
| listSessionsByAgent | 按 agent 列会话 | 过滤 SessionStore.list() 的结果 | 多会话切换 UI | core/context/src/session-manager.ts |
| listTasks | 列出任务 ID | 扫描 task_session/ 目录的 .jsonl 文件 | 查看 session 任务 | core/context/src/task-session-store.ts |
| loadMaouMessages | 加载 Maou 消息 | 自动从 SessionMessage 转换，支持 seqId 追踪 | 引擎冷启动 | core/context/src/session-store.ts |
| loadPendingTaskPlan | 加载未完成任务 | 过滤 status !== completed 的任务 | 恢复 TaskManager 内存 | core/context/src/task-session-store.ts |
| loadProjectContext | 加载项目上下文 | 读 USER.md/PROJECT.md/RULE.md 三文件 | 注入项目级规则 | core/context/src/project-context.ts |
| loadState / saveState | 加载/保存状态 | 持久化 active_sessions + rolling_summaries | 多会话状态恢复 | core/context/src/session-manager.ts |
| loadTaskPlan | 加载任务规划 | 读 task_plan.json，不存在返回空数组 | 进程启动恢复任务 | core/context/src/task-session-store.ts |

### 3.5 M-O

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| maouMessagesToLLM | 批量转 LLM 消息 | MaouMessage[] → LLMMessage[] | 一次性转换 | core/context/src/types/message.ts |
| maouToLLMMessage | 转 LLM 消息 | MaouMessage → LLMMessage（含 microCompact 摘要替换） | 发送 LLM 前 | core/context/src/types/message.ts |
| maouToSessionMessage | 转会话消息 | MaouMessage → SessionMessage（_maouMeta 无损保留注解） | 持久化存储 | core/context/src/types/message.ts |
| maouToRaw | 转 Raw 格式 | MaouMessage → Record<string,unknown>（旧签名兼容） | maybeCompress 输出 | core/context/src/compressor.ts |
| MaouContent | 内容块 | text + microCompact（按段独立压缩配置） | 一条消息多段独立压缩 | core/context/src/types/message.ts |
| MaouMessage | Maou 消息 | 结构化消息（seqId/taskIds/contents/category 等） | 上下文层核心数据结构 | core/context/src/types/message.ts |
| MaouMeta | Maou 注解载体 | 持久化到 SessionMessage._maouMeta，恢复时无损回填 | 存储 Maou 层注解 | core/context/src/types/message.ts |
| MaouTaskBlock | 任务块 | 多条消息共享的任务级元数据（含 summary/goal/outline/messages） | 任务级上下文隔离 | core/context/src/types/message.ts |
| makeSummaryMessage | 制摘要消息 | 包装成 prior_context_summary 注入消息 | 注入压缩产出 | core/context/src/compressor.ts |
| makeTaskSummaryMessage | 制任务摘要消息 | 单 task 独立摘要消息，按 seqId 时间排序 | 压缩区展示任务流程 | core/context/src/compressor.ts |
| maybeCompress | 兼容压缩器 | sync truncate-only，保持旧签名 | 旧路径兼容 | core/context/src/compressor.ts |
| maybeUpdateTitle | 自动更新标题 | 首条 user 消息取前 30 字符为标题 | 会话列表展示 | core/context/src/session-store.ts |
| MAX_ROUNDS | 循环安全上限 | 50 轮硬上限 | 防止无限循环 | core/context/src/constants.ts |
| MemoryEntry | 记忆条目 | id/key/value/category/tags/sourceSessionId/accessCount | 持久化记忆单元 | core/context/src/types.ts |
| MemoryRecallResult | 召回结果 | memories + formattedContext | 注入 structuredMemory 槽 | core/context/src/types.ts |
| MemoryStore | 记忆存储 | 结构化记忆持久化与召回（按关键词/分类/标签） | 跨会话上下文 | core/context/src/memory-store.ts |
| MessageMeta | 消息级元数据 | magId/role/category/summary/microCompact/prefix | 单条消息独有 | core/context/src/types/message.ts |
| MessagePriority | 消息优先级 | critical/important/normal（v1 遗留） | 兼容外部引用 | core/context/src/types.ts |
| MICRO_SINGLE_MSG_CHARS | 单条消息阈值 | 800 字符自动参与微压缩 | 自动压缩未标注长消息 | core/context/src/constants.ts |
| MICRO_SUMMARY_MAX_CHARS | 微压缩摘要上限 | 100 字符 | 限制摘要长度 | core/context/src/constants.ts |
| MICRO_TRIGGER_PERCENT | 微压缩阈值 | 70% 触发 compactStage | 第一级压缩触发 | core/context/src/constants.ts |
| microCompactAll | 微压缩全部 | 滑动窗口+标注压缩（无需 LLM） | compactStage 执行 | core/context/src/compressor.ts |
| migrateSessionMessage | 迁移旧字段 | created_at→createdAt 等字段名迁移 | 兼容旧 JSONL | core/context/src/session-store.ts |
| nextSeqId | 取下一 seqId | 返回当前最大 seqId+1 | 分配消息顺序 ID | core/context/src/session-store.ts |
| nextStage | 下一阶段 | 逐级递进只升一级 | progressive 模式 | core/context/src/auto-compress.ts |
| normalizeCard | 归一化角色卡 | 补全缺失字段，name 必填 | 导入时统一格式 | core/prompt/src/persona/importer.ts |

### 3.6 P-R

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| pauseCurrent | 暂停当前会话 | 状态置 paused，快照滚动摘要 | 多会话切换 | core/context/src/session-manager.ts |
| Pin | 引用片段 | path/snippet/reason（AI 主动 pin 的重要引用） | 任务关联文件追踪 | core/context/src/types/message.ts |
| pinMessage / unpinMessage | 固定/解固定消息 | 设置 pinned=true/false（压缩永不丢） | 保护关键消息 | core/context/src/session-store.ts |
| partitionMessages | 分区消息 | 拆 system/pinned/compressible/recentToolChain | 大压缩前分组 | core/context/src/compressor.ts |
| perTaskOriginals | 每 task 原文 | Map<taskId, MaouMessage[]>（大压缩产出） | 落盘 TaskSessionStore | core/context/src/compressor.ts |
| PersonaRegistry | 角色卡注册表 | 持久化到 ~/.maou/personas/<name>/card.json（项目级覆盖全局） | 角色卡管理 | core/prompt/src/persona/registry.ts |
| PersonaSection | 段落类型 | identity/appearance/personality/... 等 11 段 | 自定义段落顺序 | core/prompt/src/persona/compiler.ts |
| PersonaStats | 角色卡统计 | name/display_name/description/tags/created_at/source | 列表展示 | core/prompt/src/persona/types.ts |
| PersonaStatus | 角色状态 | name/role/status/team/description/parent | 动态注入 agent_status | core/prompt/src/dynamic/types.ts |
| PersonaStatusProvider | 角色状态提供者 | getStatus(): PersonaStatus[] 接口 | agent 层实现注入 | core/prompt/src/dynamic/types.ts |
| platformContextRegistry | 平台上下文注册表 | 全局单例，注册 PlatformContextProvider | 飞书/微信插件注册 | core/context/src/platform-context.ts |
| PlatformContextRegistry | 平台上下文注册表类 | register/unregister/get/list/build 方法 | 集中管理平台 provider | core/context/src/platform-context.ts |
| PlatformContextProvider | 平台上下文提供者 | platformId + buildContext(request) 接口 | 插件实现此接口 | core/context/src/platform-context.ts |
| PlatformContextRequest | 平台上下文请求 | sessionId/chatType/extras | 调用 buildContext | core/context/src/platform-context.ts |
| PreviewFormat | 预览格式 | html/markdown/terminal 三种 | 选择渲染输出 | core/prompt/src/preview/renderer.ts |
| PreviewOptions | 预览选项 | format/showMetadata/highlightIncludes | 配置 renderPreview | core/prompt/src/preview/renderer.ts |
| PriorityConfig | 优先级配置 | neverDrop/dropLast/respectPinned（v1 遗留） | 兼容外部引用 | core/context/src/types.ts |
| processContent | 处理文件内容 | 剥离 <description> 块和 # description 段落 | include 时清理注释 | core/prompt/src/compiler/prompt-compiler.ts |
| ProjectContext | 项目上下文 | userContext/projectContext/ruleContext 三字段 | 加载 .maou/context/ | core/context/src/project-context.ts |
| PromptCompiler | Prompt 编译器 | 递归解析 {{file.md}} + {{>>script}} + 剥离 description | 编译 SYSTEM.md 入口 | core/prompt/src/compiler/prompt-compiler.ts |
| PromptCompilerOptions | 编译器选项 | promptRoot/projectRoot/entrypoint/maxDepth/maxIterationsPerLevel | 构造 PromptCompiler | core/prompt/src/compiler/prompt-compiler.ts |
| PromptWatcher | Prompt 监听器 | 文件变化触发自动重编译（类 Vite HMR） | 调试时热重载 | core/prompt/src/preview/watcher.ts |
| purgeLegacyRawLogs | 清理旧 raw 日志 | 删除无 event/type 字段的孤儿行 | 维护 raw.jsonl | core/context/src/session-store.ts |

### 3.7 S-U

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| saveCompressedZone | 保存压缩区 | 写 compressed_zone.json（zone/summary/taskBlocks） | 压缩产出落盘 | core/context/src/harness-session-store.ts |
| saveCurrent | 保存当前上下文 | 写 harness_session.json | 每轮持久化 | core/context/src/harness-session-store.ts |
| saveMaouMessages | 保存 Maou 消息 | 清空 JSONL 后重写为 SessionMessage | 覆盖式持久化 | core/context/src/session-store.ts |
| saveTaskPlan | 保存任务规划 | 写 task_plan.json | 任务列表持久化 | core/context/src/task-session-store.ts |
| scriptCacheKey | 脚本缓存键 | sha1(scriptPath) | 缓存键计算 | core/prompt/src/compiler/prompt-compiler.ts |
| SessionData | 会话数据 | id/title/agentName/messages/trace 等完整字段 | 内存中会话表示 | core/context/src/session-store.ts |
| SessionListItem | 会话列表项 | id/title/messageCount/lastMsgAt | 列表展示 | core/context/src/session-store.ts |
| SessionManager | 会话管理器 | 多会话切换/暂停/恢复+滚动摘要持久化 | 多 agent 活跃会话调度 | core/context/src/session-manager.ts |
| SessionMessage | 会话消息 | 存储层格式（role/content/createdAt/pinned/toolCalls） | JSONL 行格式 | core/context/src/session-store.ts |
| SessionMeta | 会话元信息 | id/title/agent_name/created_at/last_prompt 等 | meta.json 结构 | core/context/src/session-store.ts |
| SessionStore | 会话存储 | 基于 JSONL 的会话持久化（含 meta/jsonl/raw） | runtime 会话后端 | core/context/src/session-store.ts |
| SessionTrace | 会话 trace | 调试用 trace 事件（任意 key） | model.usage 追踪 | core/context/src/session-store.ts |
| sessionMessagesToMaou | 批量转 Maou 消息 | SessionMessage[] → MaouMessage[]，自动分配 seqId | 一次性批量转换 | core/context/src/types/message.ts |
| sessionToMaouMessage | 转 Maou 消息 | SessionMessage → MaouMessage（优先从 _maouMeta 恢复） | 加载会话时转换 | core/context/src/types/message.ts |
| setActiveSession | 设置活跃会话 | 不暂停之前的（用于初始化） | runtime 启动绑定 | core/context/src/session-manager.ts |
| setAgentName | 设置 agent 名 | 中途 /agent 切换时改绑 | 会话切换 agent | core/context/src/session-store.ts |
| setLastPrompt / setLastRawResponse | 设最后 prompt/响应 | 写入 meta.last_prompt/last_raw_response | 调试用 | core/context/src/session-store.ts |
| shouldAutoCheckpoint | 是否自动快照 | tool_call/compression 总是快照，round_start 暂不启用 | 自动快照触发 | core/context/src/checkpoint-store.ts |
| shouldSkipCompress | 跳过压缩判定 | system/pinned/keepAfterCompress 永不压缩 | 微压缩保护 | core/context/src/compressor.ts |
| StagedCompressConfig | 分段压缩配置 | compact/summary/archive 阈值 + activeWindow + progressive | 配置 staged 模式 | core/context/src/auto-compress.ts |
| stagedCompress | 分段压缩执行 | 微压缩→大压缩→归档逐级递进 | staged 模式压缩 | core/context/src/auto-compress.ts |
| staticStage | 静态阶段 | 嵌入结构阶段（用户偏好/项目信息固定不变） | 不参与压缩 | core/context/src/types/compression.ts |
| SUMMARY_MAX_CHARS | 任务摘要上限 | 500 字符 | 限制 task 摘要 | core/context/src/constants.ts |
| SUMMARY_MAX_ENTRIES_PER_ROLE | 每角色条目上限 | 8 条（droppedSummary 用） | 限制摘要条数 | core/context/src/constants.ts |
| SUMMARY_SNIPPET_MAX_CHARS | 摘要片段上限 | 200 字符（droppedSummary 用） | 限制单条摘要片段 | core/context/src/constants.ts |
| SUMMARY_TRIGGER_PERCENT | 大压缩阈值 | 80% 触发 summaryStage | 第二级压缩触发 | core/context/src/constants.ts |
| summaryCompressHarness | 大压缩（Harness） | 按 task 分组+LLM 摘要+原文落盘 | summaryStage 执行 | core/context/src/compressor.ts |
| summaryCompressSync | 同步大压缩 | 不调 LLM 用 fallback 摘要 | maybeCompress 旧路径 | core/context/src/compressor.ts |
| summaryStage | 大压缩阶段 | 第一次压缩后保留内容过程摘要 | 第二级压缩 | core/context/src/types/compression.ts |
| Summarizer | 摘要器 | (input: {kind, taskId?, messages, prompt?}) => Promise<string> | 可插拔 LLM 摘要接口 | core/context/src/compressor.ts |
| summarizeTaskFallback | 任务摘要回退 | 无 summarizer 时的规则化摘要（user/assistant/tool 统计） | 摘要失败降级 | core/context/src/compressor.ts |
| SummaryModelConfig | 摘要模型配置 | model/baseUrl/apiKey/maxOutputTokens | 摘要用 LLM 配置 | core/context/src/auto-compress.ts |
| switchSession | 切换会话 | 暂停当前+激活目标+快照滚动摘要 | 多会话切换 | core/context/src/session-manager.ts |
| SwitchResult | 切换结果 | previousSession + newSession | 切换返回值 | core/context/src/types.ts |
| TASK_SUMMARY_MAX_CHARS | 任务块摘要上限 | 200 字符 | 限制 task_block 摘要 | core/context/src/constants.ts |
| TaskEntry | 任务 JSONL 条目 | type=block/message + data + created_at | 任务文件内部结构 | core/context/src/task-session-store.ts |
| TaskPlanEntry | 任务规划条目 | id/desc/deps/status/summary/relatedBlockIds | task_plan.json 单条 | core/context/src/task-session-store.ts |
| TaskSessionStore | 任务会话存储 | 任务级 JSONL 持久化（含 block + message + task_plan） | 大压缩后原文归档 | core/context/src/task-session-store.ts |
| TaskStatus | 任务状态 | pending/running/paused/done/failed/cancelled | 任务状态枚举 | core/context/src/types/message.ts |
| TaskSummary | 任务摘要 | taskId/status/summary/goal/outline/progress 等 | 大压缩产出结构 | core/context/src/types/compression.ts |
| TerminalStatusProvider | 终端状态提供者 | agentStatusPanel(agentName) 接口 | tools 层实现注入 | core/prompt/src/dynamic/types.ts |
| TokenThresholdPolicy | Token 阈值策略 | 按 token 占 maxTokens 百分比触发压缩 | 默认压缩策略 | core/context/src/auto-compress.ts |
| truncate | 截断 | 超长文本截断+… 后缀 | 摘要长度控制 | core/context/src/compressor.ts |

### 3.8 V-Z

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| updateSummary | 更新任务摘要 | 保留所有 message 条目，重写 block 条目 | 任务进展更新 | core/context/src/task-session-store.ts |
| UserMessageOptions | 用户消息选项 | beforeUserContent/dynamicInjections/systemPre/systemPost/bakedContext/compressedSummary | buildMessages 入参 | core/context/src/types.ts |
| WatchCallback | 监听回调 | (result: CompileResult) => void | 重编译完成通知 | core/prompt/src/preview/watcher.ts |
| WatchErrorCallback | 错误回调 | (error: Error) => void | 监听错误通知 | core/prompt/src/preview/watcher.ts |
| WatchOptions | 监听选项 | debounceMs/entrypoint/ignoreDotGit | 配置 PromptWatcher | core/prompt/src/preview/watcher.ts |

---

## 4. agent + coding-agent 包

`core/agent/src/`（25 源文件 + templates/agent 模板树）+ `agent/coding-agent/src/`（4 文件：index / cli/index / package.json / templates/project.json）。

### 4.1 A-C

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| abortCurrentRun | 中断当前运行 | 主动 abort 指定 session 的当前 run | 消息队列 interrupt 模式触发 | core/agent/src/agent/runtime.ts |
| abortSignal | 中断信号 | 透传到底层 fetch 真正中止网络请求 | 用户主动停止/队列打断 | core/agent/src/agent/runtime.ts |
| after_loop_complete | 循环完成后投递 | 等当前 agent.run() 返回后投递消息 | 飞书后台长任务不阻塞新消息 | core/agent/src/agent/message-queue.ts |
| after_round_complete | 轮次完成后投递 | 等当前 round 完成后投递消息 | 单轮工具执行期间排队消息 | core/agent/src/agent/message-queue.ts |
| after_task_complete | 任务完成后投递 | 等整个 task 表完成后再投递 | 多步任务最保守排队默认 | core/agent/src/agent/message-queue.ts |
| AgentEvent | Agent 事件 | SDK 流式事件数据结构 | 事件总线投递/前端流式渲染 | core/agent/src/agent_factory/types.ts |
| AGENT_EVENT_TYPES | Agent 事件类型集合 | 全部 25 种事件枚举集合 | hook 注册/事件过滤 | core/agent/src/agent_factory/types.ts |
| AgentEventType | Agent 事件类型联合 | AGENT_EVENT_TYPES 推导的类型 | 事件处理器类型约束 | core/agent/src/agent_factory/types.ts |
| AgentFactory | Agent 工厂 | 从预设创建 agent 并初始化 ROLE 目录 | 命令行新建 agent/批量初始化 | core/agent/src/agent/factory.ts |
| AgentFactoryConfig | Agent 工厂配置 | 含 name/role/preset/personality 等 | 工厂创建入参 | core/agent/src/agent/factory.ts |
| AgentHandle | Agent 句柄 | 通用绑定项目的 agent 句柄接口 | CLI/harness/测试统一调用 | core/agent/src/agent/handle.ts |
| AgentRegistry | Agent 注册表 | 扫描 ~/.maou/agents/<name>/ 发现 agent | 启动加载/约定扫描 | core/agent/src/agent/registry.ts |
| AgentRegistryStatusProvider | Agent 状态提供器 | 实现 PersonaStatusProvider 注入状态 | 动态上下文编译 | core/agent/src/dynamic-context.ts |
| AgentRuntime | Agent 运行时 | 异步生成器驱动的核心 agent 循环 | 服务端驱动一次对话/run | core/agent/src/agent/runtime.ts |
| AgentToolEntry | Agent 工具条目 | 自动发现的工具 schema | 加载 agent tools/ 目录 | core/agent/src/agent/registry.ts |
| AgentEntry | Agent 元数据条目 | agent.json 解析出的配置对象 | 注册表读写/前端展示 | core/agent/src/agent/registry.ts |
| allEndsLoop | 全部收尾工具判定 | 一轮内所有工具都是 endsLoop | 收尾型工具触发 loop 退出 | core/agent/src/agent/runtime.ts |
| ALL_HOOKS | 全部钩子集合 | 18 种 Hook 事件常量集合 | 钩子管理器初始化 | core/agent/src/agent/hooks.ts |
| afterIteration | 迭代后钩子 | 每轮迭代后回调 | 循环检测/计数更新 | core/agent/src/agent/agent-loop.ts |
| beforeIteration | 迭代前钩子 | 每轮迭代前回调 | 注入上下文/更新状态 | core/agent/src/agent/agent-loop.ts |
| ApiKeyAuth | API Key 认证 | key+value 放 header/query | 连接认证方式之一 | core/agent/src/agent/define-connection.ts |
| AppRuntimeOptions | 应用运行时选项 | Runtime 门面装配入参 | 各 agent 应用复用门面 | core/agent/src/agent/runtime-facade.ts |
| atomicWriteJson | 原子写 JSON | tmp+rename 保证写入原子性 | 并发写 agent.json 防损坏 | core/agent/src/agent/registry.ts |
| bake | 烘焙 | 预计算上下文注入内容生成 XML 块 | 长期偏好/可用工具列表预生成 | core/agent/src/agent/bake.ts |
| BakeEntry | 烘焙条目 | 单个烘焙内容含 baker 函数 | 注册可注入的上下文块 | core/agent/src/agent/bake.ts |
| BakeSystem | 烘焙系统 | 注册/烘焙/注入上下文的管理器 | system prompt 预计算注入 | core/agent/src/agent/bake.ts |
| BakeTrigger | 烘焙触发策略 | always/on_change/manual | 决定何时重新烘焙 | core/agent/src/agent/bake.ts |
| before_user | 用户输入前注入 | 每轮用户消息前注入的提示词 | 注入实时背景时间天气 | core/agent/templates/agent/prompt/before_user/before_user.md |
| buildMessages | 构建消息数组 | 拼装 system+history+dynamic 注入 | 每轮调 LLM 前准备 | core/agent/src/agent/runtime.ts |
| canDeliverSafely | 安全投递检查 | 防止在 tool_call/tool_result 中间插入 | 队列消息投递前自检 | core/agent/src/agent/message-queue.ts |
| captureSnapshot | 捕获快照 | 对话前存 diff .patch 文件 | 版本备份/回退 | core/agent/src/agent_factory/git-watcher.ts |
| ChannelAdapter | 通道适配器 | 处理特定通道收发逻辑接口 | 飞书/Slack 适配器实现 | core/agent/src/agent/define-channel.ts |
| ChannelConfig | 通道配置 | type/enabled/通道特定字段 | channels/ 目录 .json 文件 | core/agent/src/agent/channel-registry.ts |
| ChannelEntry | 通道条目 | registry 扫描出的通道定义 | 列出 agent 所有通道 | core/agent/src/agent/registry.ts |
| ChannelMessage | 通道消息 | 跨通道的消息数据结构 | 通道收发统一抽象 | core/agent/src/agent/define-channel.ts |
| ChannelRegistry | 通道注册表 | 扫描 channels/ 目录自动发现 | 启动加载通道配置 | core/agent/src/agent/channel-registry.ts |
| ChannelResponse | 通道响应 | 通道发送消息的返回 | 通道适配器 send 返回 | core/agent/src/agent/define-channel.ts |
| ChannelType | 通道类型 | http/feishu/slack/discord 等 | 定义通道种类 | core/agent/src/agent/define-channel.ts |
| checkAllTasksComplete | 检查任务全完成 | task 表是否全部完成 | task_complete 阶段投递依据 | core/agent/src/agent/runtime.ts |
| CODING_SYSTEM_PROMPT | 编程系统提示词 | 物化到 ROLE/SYSTEM.md 的编程 prompt | coding agent 人设注入 | agent/coding-agent/src/index.ts |
| CODING_TOOL_WHITELIST | 编程工具白名单 | reader/write_file/edit_file 等 | coding agent PERMISSION.jsonc | agent/coding-agent/src/index.ts |
| CodingAgent | 编程 Agent 句柄 | AgentHandle 类型别名 | coding agent 调用入口 | agent/coding-agent/src/index.ts |
| CodingAgentOptions | 编程 Agent 选项 | createCodingAgent 入参 | 装配编程 agent | agent/coding-agent/src/index.ts |
| CodingCliOptions | 编程 CLI 选项 | runCodingAgentCli 入参 | CLI 调试驱动 | agent/coding-agent/src/cli/index.ts |
| command/ 目录 | 指令脚本目录 | 文件名即指令名执行 /<name> | /new /clear 自定义指令 | core/agent/templates/agent/command/README.md |
| commitBackgroundToolCall | 提交后台工具调用 | 同步写占位 tool_result 不阻塞 loop | 后台 fire-and-forget 工具 | core/agent/src/agent/runtime.ts |
| CompactionConfig | 压缩配置 | threshold/preserveToolCalls/preserveRecentCount | defineAgent 配置压缩策略 | core/agent/src/agent/define-agent.ts |
| compileDynamicContext | 编译动态上下文 | 组装 agent/终端/task 状态注入 | 每轮刷新动态注入区 | core/agent/src/dynamic-context.ts |
| computeCost | 计算费用 | 按 input/output/cache token 算钱 | token tracker 记账 | core/agent/src/agent/token-tracker.ts |
| computeDailySummary | 计算日汇总 | 聚合当日 token 用量 | 日报告/仪表盘 | core/agent/src/agent/token-tracker.ts |
| conventionMode | 约定模式 | 生成 Eve 风格约定目录 | factory 创建 agent 选项 | core/agent/src/agent/factory.ts |
| ConnectionAuth | 连接认证 | token/oauth/api_key 联合类型 | MCP/OpenAPI 连接认证 | core/agent/src/agent/define-connection.ts |
| ConnectionRegistry | 连接注册表 | 扫描 connections/ 目录发现连接 | 加载 MCP/OpenAPI 连接 | core/agent/src/agent/define-connection.ts |
| ConnectionType | 连接类型 | mcp \| openapi | 连接种类标识 | core/agent/src/agent/define-connection.ts |
| ContextEngine 压缩闭环 | 压缩闭环 | sync→compress→toLLMHistory 三步 | 长 session 自动压缩历史 | core/agent/src/agent/runtime.ts |
| createAgent | 创建 Agent | 注册到 Registry + 初始化目录 | factory 创建方法 | core/agent/src/agent/factory.ts |
| createAgentFromTemplate | 从模板创建 Agent | 复制 templates/agent 整套结构 | 一键生成新 agent 目录 | core/agent/src/agent/template.ts |
| createAppLogger | 创建应用日志器 | pino 工厂（dev pretty/prod json） | LLM POST 日志结构化输出 | core/agent/src/agent/app-logger.ts |
| createCodingAgent | 创建编程 Agent | 物化定义+构建 Runtime 门面 | 编程场景入口 | agent/coding-agent/src/index.ts |
| createMessage | 创建消息工厂 | 填默认值的 Message 构造 | SDK 消息构造 | core/agent/src/agent_factory/types.ts |
| CronScheduler | Cron 调度器 | 解析 cron 表达式定时触发 | schedules/ 任务定时执行 | core/agent/src/agent/define-schedule.ts |

### 4.2 D-F

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| DEFAULT_CODING_AGENT_NAME | 默认编程 Agent 名 | 即 "coding" | coding agent 默认目录名 | agent/coding-agent/src/index.ts |
| DEFAULT_CODING_ROUND_LIMIT | 默认编程轮次上限 | 50 | coding agent round_limit | agent/coding-agent/src/index.ts |
| DEFAULT_MAX_QUEUE | 默认队列上限 | 64 条/session | 防内存膨胀 | core/agent/src/agent/message-queue.ts |
| DefaultAgentLoop | 默认 Agent 循环控制器 | 标准 "调 LLM→执行工具→继续" | 默认 loop 策略实现 | core/agent/src/agent/agent-loop.ts |
| defaultSubSessionIdFactory | 默认子会话 ID 工厂 | parent+taskId+时间戳 | fork 子 Agent 命名 | core/agent/src/agent/subagent-executor.ts |
| defineAgent | 定义 Agent | 文件即 Agent 核心 API | agent.ts 导出 agent 定义 | core/agent/src/agent/define-agent.ts |
| defineChannel | 定义通道 | channels/ 下 .ts 导出 | 注册消息通道适配 | core/agent/src/agent/define-channel.ts |
| defineConnection | 定义连接 | connections/ 下定义外部连接 | 注册 MCP/OpenAPI 连接 | core/agent/src/agent/define-connection.ts |
| defineEval | 定义评估 | evals/ 下 .eval.ts 导出 | Agent 行为评估测试 | core/agent/src/agent/define-eval.ts |
| defineMcpConnection | 定义 MCP 连接 | 注册 MCP Server SSE 连接 | 接入外部 MCP 工具源 | core/agent/src/agent/define-connection.ts |
| defineOpenApiConnection | 定义 OpenAPI 连接 | 注册 OpenAPI spec 连接 | 接入外部 REST API | core/agent/src/agent/define-connection.ts |
| defineSchedule | 定义定时任务 | schedules/ 下 .ts 导出 | 注册 cron 触发任务 | core/agent/src/agent/define-schedule.ts |
| DefinedAgent | 已定义 Agent | defineAgent 返回对象 | registry 识别加载 | core/agent/src/agent/define-agent.ts |
| DefinedChannel | 已定义通道 | defineChannel 返回对象 | 通道注册表存储 | core/agent/src/agent/define-channel.ts |
| DefinedConnection | 已定义连接 | defineMcp/OpenApi 返回对象 | 连接注册表存储 | core/agent/src/agent/define-connection.ts |
| DefinedEval | 已定义评估 | defineEval 返回对象 | EvalRunner 执行 | core/agent/src/agent/define-eval.ts |
| DefinedSchedule | 已定义定时任务 | defineSchedule 返回对象 | CronScheduler 注册 | core/agent/src/agent/define-schedule.ts |
| DeliveryDecision | 投递决策 | deliver/shouldAbort/shouldStopRun | enqueue 返回投递策略 | core/agent/src/agent/message-queue.ts |
| DeliveryPhase | 投递时机点 | round_end/loop_end/task_complete | runtime 在这些点检查队列 | core/agent/src/agent/message-queue.ts |
| dequeueIfReady | 就绪出队 | phase 点取可投递消息 | round_end/loop_end 投递 | core/agent/src/agent/message-queue.ts |
| detectLoop | 循环检测 | 重复工具调用模式识别 | 防止 agent 陷入死循环 | core/agent/src/agent/agent-loop.ts |
| DeviceInfo | 设备信息 | 多设备注册表条目 | hub 设备发现/心跳 | core/agent/src/agent_factory/types.ts |
| DeviceStatus | 设备状态枚举 | online/offline/busy | 设备注册表状态 | core/agent/src/agent_factory/types.ts |
| DiffMeta | diff 元数据 | seq/timestamp/patchFile/stashRef | git diff 快照索引 | core/agent/src/agent_factory/git-watcher.ts |
| 双 Store | 双 Store | HarnessSessionStore + TaskSessionStore | ContextEngine 压缩闭环依赖 | core/agent/src/agent/runtime-facade.ts |
| effectiveAbortSignal | 生效中断信号 | 合并外部+内部 interrupt 的 signal | 透传到 fetch 真正中止 | core/agent/src/agent/runtime.ts |
| enableCompression | 启用压缩 | 装配双 Store 闭环开关 | Runtime 门面构造选项 | core/agent/src/agent/runtime-facade.ts |
| endsLoop | 收尾工具标注 | 工具定义里标记终止 loop | task_finish 触发 loop 退出 | core/agent/templates/agent/loop/loop.ts |
| enqueue | 入队 | 同步入队返回决策 | 用户消息到达时排队 | core/agent/src/agent/message-queue.ts |
| EnqueueOptions | 入队选项 | mode/source/metadata | 控制单条消息投递策略 | core/agent/src/agent/message-queue.ts |
| equals | 相等断言 | 严格相等检查 | eval 严格匹配 | core/agent/src/agent/define-eval.ts |
| evaluateDecision | 评估决策 | 按模式计算投递决策 | enqueue 时算 shouldAbort | core/agent/src/agent/message-queue.ts |
| EvalCheckResult | 评估检查结果 | pass + message | 断言函数返回 | core/agent/src/agent/define-eval.ts |
| EvalContext | 评估上下文 | test() 函数中使用的 API | 评估测试发送消息/断言 | core/agent/src/agent/define-eval.ts |
| EvalRunner | 评估运行器 | 注入 send 函数跑评估 | 批量运行 evals/ | core/agent/src/agent/define-eval.ts |
| EvalRunResult | 评估运行结果 | passed/checks/duration | 评估报告输出 | core/agent/src/agent/define-eval.ts |
| execOneToolCall | 执行单个工具调用 | 异步执行返回 commit 闭包 | 并发组并行执行按序提交 | core/agent/src/agent/runtime.ts |
| expressionChange | 表情变化钩子 | 桌面宠物表情切换 | pet 插件表情驱动 | core/agent/src/agent/hooks.ts |
| file-as-agent | 文件即 Agent | 目录结构即 Agent 定义 | 约定扫描自动发现 agent | core/agent/src/agent/registry.ts |
| formatTaskPlan | 格式化任务规划 | 渲染 task 表为 <task_plan> | 注入 before_user 区让 AI 看到 todo | core/agent/src/dynamic-context.ts |
| fork | 分叉子 Agent | 单个 task fork 独立 session | 子 Agent 并行执行 | core/agent/src/agent/subagent-executor.ts |
| forkLayer | 并发 fork 一层 | 同层 task 并发 fork | TaskScheduler selectLayer 真并行 | core/agent/src/agent/subagent-executor.ts |
| formatResultsAsToolResult | 结果格式化为 tool_result | 合并子 Agent 输出回主 session | forkLayer 后回写 | core/agent/src/agent/subagent-executor.ts |

### 4.3 G-I

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| getCacheHitRate | 获取缓存命中率 | cache/total input | token 成本分析 | core/agent/src/agent/token-tracker.ts |
| getDefaultPricing | 获取默认定价 | 从 preset.pricing 读或兜底 | token tracker 构造 | core/agent/src/agent/token-tracker.ts |
| getDailySummary | 获取日汇总 | 聚合当日 token | 仪表盘展示 | core/agent/src/agent/token-tracker.ts |
| getEndReason | 确定结束原因 | max_rounds/no_tool_calls/aborted | 循环退出诊断 | core/agent/src/agent/agent-loop.ts |
| getEnabledChannels | 获取已启用通道 | 过滤 enabled=false | 启动加载可用通道 | core/agent/src/agent/channel-registry.ts |
| getEnabledSchedules | 获取已启用定时任务 | 过滤 enabled=false | 启动加载可用任务 | core/agent/src/agent/schedule-registry.ts |
| getInjection | 获取注入文本 | 按触发策略组装 XML 块 | 构建 system prompt 时插入 | core/agent/src/agent/bake.ts |
| getPromptEntrypoint | 获取 prompt 入口文件名 | eve 用 system/system.md | PromptCompiler 编译入口 | core/agent/src/agent/registry.ts |
| getPromptRoot | 获取 prompt 根目录 | 优先 prompt/ 次 ROLE/ | PromptCompiler 编译根 | core/agent/src/agent/registry.ts |
| getTotalCost | 获取日总费用 | 汇总当日 cost | 费用报告 | core/agent/src/agent/token-tracker.ts |
| GitWatcher | Git 监视器 | 项目 diff 监控与版本备份 | 对话前快照/回退 | core/agent/src/agent_factory/git-watcher.ts |
| goal_mode | 目标模式 | project.json 功能开关 | 长任务目标驱动 | agent/coding-agent/templates/project.json |
| hasChanges | 有变更检查 | on_change 策略判断 | 决定是否重新注入 | core/agent/src/agent/bake.ts |
| hook/ 目录 | 钩子脚本目录 | 文件名约定事件名 | on_user_message.ts 等钩子脚本 | core/agent/templates/agent/hook/README.md |
| HookHandler | 钩子处理函数 | 返回 false 可拦截 | 注册回调签名 | core/agent/src/agent/hooks.ts |
| HookName | 钩子名 | ALL_HOOKS 推导的联合 | 类型约束 | core/agent/src/agent/hooks.ts |
| Hooks | 钩子管理器 | 18 种事件+通配符订阅 | agent 循环生命周期拦截 | core/agent/src/agent/hooks.ts |
| hooks 注入 | hooks 装配 | RuntimeOptions.hooks 装配 | agent 循环各生命周期点触发 | core/agent/src/agent/runtime.ts |
| IAgentLoop | Agent 循环接口 | 抽象循环控制逻辑 | 自定义 plan/task 循环策略 | core/agent/src/agent/agent-loop.ts |
| includes | 包含断言 | 检查回复含指定文本 | eval 断言 | core/agent/src/agent/define-eval.ts |
| initAgent | 初始化 Agent | 调 initMainAgent | 启动确保默认 agent | core/agent/src/agent/runtime-facade.ts |
| initMainAgent | 初始化主 Agent | 不存在则创建 main | 启动确保默认 agent | core/agent/src/agent/registry.ts |
| injectPendingToolInterrupts | 注入挂起工具中断 | 补占位 tool_result 防中间插入 | 队列投递前修补孤立 tool_call | core/agent/src/agent/message-queue.ts |
| installTaskPersistCallback | 安装 task 持久化回调 | TaskManager CRUD 同步写 task_plan.json | 解耦 TaskManager 与 TaskSessionStore | core/agent/src/agent/runtime-facade.ts |
| interrupt_immediately | 立即中断模式 | 立刻 abort 下轮优先处理 | 紧急用户消息插队 | core/agent/src/agent/message-queue.ts |
| interrupt_stop | 中断停止模式 | 立刻 abort 并停止本次 run | 紧急消息等下次 run | core/agent/src/agent/message-queue.ts |
| isAborted | 是否中断 | 检查 abortSignal | 循环退出判定 | core/agent/src/agent/agent-loop.ts |
| isRunning | 是否运行中 | 查 session 是否有运行 run | harness 判断是否 enqueue interrupt | core/agent/src/agent/runtime.ts |

### 4.4 J-L

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| judgeLoopEnd | 判定 loop 结束 | 用一次性模型调用判断达标 | end.md 标准检查 | core/agent/src/agent/runtime.ts |
| lastHash | 上次哈希 | on_change 对比用 | 烘焙内容变更检测 | core/agent/src/agent/bake.ts |
| lastRequestContext | 请求上下文映射 | per-session 引用计数 | 并发 run 隔离 source/traceId | core/agent/src/agent/runtime-facade.ts |
| listAgents | 列出所有 Agent | registry.list() | 前端 agent 管理面板 | core/agent/src/agent/runtime-facade.ts |
| listDiffs | 列出 diff 快照 | 读 diff_*.json 元数据 | 回退历史浏览 | core/agent/src/agent_factory/git-watcher.ts |
| listPresets | 列出预设 | 返回 PRESETS 映射 | 工厂预设选择 | core/agent/src/agent/factory.ts |
| listStashes | 列出 stash | 过滤 maou/<agent>/ 前缀 | 大版本存档列表 | core/agent/src/agent_factory/git-watcher.ts |
| loadAgentTools | 加载 Agent 工具 | 递归扫描 tools/schema.json | agent 专属工具发现 | core/agent/src/agent/registry.ts |
| loadChannels | 加载通道 | 扫描 channels/*.json | 启动加载通道配置 | core/agent/src/agent/registry.ts |
| loadDefinedAgent | 加载已定义 Agent | 动态 import agent.ts | 运行时识别 defineAgent | core/agent/src/agent/registry.ts |
| loadFromDirectory | 从目录加载技能 | 扫描 .md 解析 frontmatter | SkillRegistry 初始化 | core/agent/src/agent_factory/skill.ts |
| loadInstructions | 加载指令 | 读 instructions.md 回退 SYSTEM.md | 获取 agent 系统提示词 | core/agent/src/agent/registry.ts |
| loadSchedules | 加载定时任务 | 扫描 schedules/*.json | 启动加载 cron 任务 | core/agent/src/agent/registry.ts |
| loop_check | loop 检查事件 | end.md 达标判定结果 | 前端展示达标进度 | core/agent/src/agent/runtime.ts |
| loop_end | 循环结束阶段 | 整个 run 退出前 | 投递剩余队列消息 | core/agent/src/agent/message-queue.ts |
| loopThreshold | 循环检测阈值 | recentToolNames 管道长度 | 死循环检测窗口 | core/agent/src/agent/agent-loop.ts |
| loopEndCriteria | loop 结束标准 | end.md 内容 | 判定任务真完成 | core/agent/src/agent/runtime.ts |
| LoopConfig | 循环配置 | maxRounds/loopThreshold/abortSignal | 循环控制器入参 | core/agent/src/agent/agent-loop.ts |
| LoopIterationResult | 单次迭代结果 | content/hasToolCalls/events | afterIteration 回调入参 | core/agent/src/agent/agent-loop.ts |
| LoopResult | 循环结果 | totalRounds/completed/reason | 循环退出汇总 | core/agent/src/agent/agent-loop.ts |
| LoopState | 循环状态 | roundCount/currentRound/sessionId | 循环控制器共享态 | core/agent/src/agent/agent-loop.ts |

### 4.5 M-O

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| markAllDirty | 全部标记脏 | 强制下次重新注入 | 配置变更后强制刷新 | core/agent/src/agent/bake.ts |
| materializeAgent | 物化 Agent | 把定义写到 agents/<name>/ | 各场景特化 agent 复用骨架 | core/agent/src/agent/materialize.ts |
| materializeCodingAgent | 物化编程 Agent | coding 特化物化薄包装 | 创建编程 agent 定义 | agent/coding-agent/src/index.ts |
| MaterializeAgentOptions | 物化选项 | systemPrompt/whitelist/role/roundLimit | 物化入参 | core/agent/src/agent/materialize.ts |
| matchesRegex | 正则匹配断言 | pattern.test 检查 | eval 模式匹配 | core/agent/src/agent/define-eval.ts |
| maxConcurrency | 最大并发数 | forkLayer 批量上限 | 子 Agent 并发控制 | core/agent/src/agent/subagent-executor.ts |
| max_retries | 最大重试 | agent.json 字段 | 模型不可用原样重试上限 | core/agent/templates/agent/agent.json |
| maybeCompress | 可能压缩 | 旧路径同步 truncate shim | 无 ContextEngine 时回退 | core/agent/src/agent/runtime.ts |
| memory/ 目录 | 记忆目录 | .md 注入烘焙区 | USER.md 放用户长期偏好 | core/agent/templates/agent/memory/README.md |
| Message | SDK 消息 | id/role/content/metadata/source | SDK 通用消息结构 | core/agent/src/agent_factory/types.ts |
| MESSAGE_QUEUE | 消息队列单例 | 全局共享队列实例 | harness/runtime 共享 | core/agent/src/agent/message-queue.ts |
| MessageQueue | 消息队列 | per-session 用户消息排队 | agent 运行期间消息投递 | core/agent/src/agent/message-queue.ts |
| MessageQueueMode | 消息队列模式 | 5 种投递模式联合类型 | 控制消息何时投递 | core/agent/src/agent/message-queue.ts |
| MessageQueueOptions | 队列选项 | defaultMode/maxQueuePerSession/onInterrupt | 队列构造入参 | core/agent/src/agent/message-queue.ts |
| MessageType | 消息类型枚举 | user/assistant/tool/system/event/command | 消息分类 | core/agent/src/agent_factory/types.ts |
| mergeAgentJson | 合并 agent.json | opts 合并进模板 JSON | 创建时注入工具/轮次 | core/agent/src/agent/template.ts |
| mergePresets | 合并预设 | config + PRESETS | 工厂构建方法 | core/agent/src/agent/factory.ts |
| ModelCaller | 模型调用器 | LLM 调用+重试+事件桥接 | Runtime 装配 LLM 调用 | core/agent/src/agent/runtime-facade.ts |
| ModelFallback | 模型回退配置 | primary + fallbacks | 主模型不可用按序尝试 | core/agent/src/agent/define-agent.ts |
| ModelCallParams | 模型调用参数 | preset/messages/stream/abortSignal | callModel 函数入参 | core/agent/src/agent/runtime.ts |
| nativeToolCalling | 原生工具调用 | 用 LLM 原生 function calling | 区分 JSON 强制 vs 原生 | core/agent/src/agent/runtime.ts |
| notIncludes | 不包含断言 | 检查回复不含指定文本 | eval 反向断言 | core/agent/src/agent/define-eval.ts |
| onCompress | 压缩回调 | 落盘压缩区摘要 | harness 注入 HarnessSessionStore | core/agent/src/agent/runtime.ts |
| onInterrupt | 中断回调 | enqueue 时触发 abortCurrentRun | runtime 装配队列时注入 | core/agent/src/agent/message-queue.ts |
| OAuthAuth | OAuth 认证 | clientId/clientSecret/scopes | OAuth 连接认证 | core/agent/src/agent/define-connection.ts |
| output_format | 输出格式开关 | auto/json_schema/json_object/none | none 时禁用结构化 JSON | core/agent/src/agent/runtime.ts |
| OUTPUT.jsonc | 输出格式文件 | deriveJsonSettings 派生 jsonSettings | 强制结构化 JSON 输出 | core/agent/src/agent/materialize.ts |

### 4.6 P-R

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|---|---|---|---|---|
| parallelSafe | 可并行标注 | 工具定义里标记只读 | 连续只读工具并发执行 | core/agent/src/agent/runtime.ts |
| parseSkillFile | 解析技能文件 | Markdown+YAML frontmatter | 加载 SKILL.md | core/agent/src/agent_factory/skill.ts |
| peek | 窥视队首 | 不移除看队首 | 队列调试 | core/agent/src/agent/message-queue.ts |
| PersonaStatus | 人格状态 | name/role/status/team | 动态注入 agent 列表 | core/agent/src/dynamic-context.ts |
| PersonaStatusProvider | 人格状态提供器 | getStatus() 接口 | 动态上下文 provider 适配 | core/agent/src/dynamic-context.ts |
| PERMISSION.jsonc | 权限白名单文件 | tool_whitelist 真正强制 | 控制工具可用性 | core/agent/src/agent/materialize.ts |
| PHASE_DELIVERY_MAP | 阶段投递映射 | 各模式可投递 phase 列表 | dequeueIfReady 判定 | core/agent/src/agent/message-queue.ts |
| plan_mode | 计划模式 | project.json 功能开关 | 先规划再执行 | agent/coding-agent/templates/project.json |
| PlanLoop | Plan 循环 | 先问问题再执行策略 | 可扩展循环控制器 | core/agent/src/agent/agent-loop.ts |
| postCompact | 压缩后钩子 | compressedCount 入参 | 压缩后日志/告警 | core/agent/src/agent/hooks.ts |
| postMessage | 消息后钩子 | 消息发送后触发 | 消息审计 | core/agent/src/agent/hooks.ts |
| postToolUse | 工具后钩子 | 工具调用后触发 | 工具结果审计 | core/agent/src/agent/hooks.ts |
| PRESETS | 预设映射 | default/coder/writer/researcher | 工厂预设选择 | core/agent/src/agent/factory.ts |
| preCompact | 压缩前钩子 | 压缩前触发 | 压缩前快照/审计 | core/agent/src/agent/hooks.ts |
| preMessage | 消息前钩子 | 消息发送前触发 | 消息预处理 | core/agent/src/agent/hooks.ts |
| PREVIEW | 渲染预览目录 | 渲染后最终提示词 | 开发调试看注入结果 | core/agent/templates/agent/prompt/PREVIEW/README.md |
| preToolUse | 工具前钩子 | 返回 false 拦截 | 安全策略/工具拦截 | core/agent/src/agent/hooks.ts |
| PricingInfo | 定价信息 | input/output/cacheHit price | token 费用计算 | core/agent/src/agent/token-tracker.ts |
| processToolCalls | 处理工具调用 | 按并行/阻塞分组执行 | 每轮工具调用派发 | core/agent/src/agent/runtime.ts |
| Profiler | 性能埋点器 | 各阶段耗时定位 | run 性能报告 | core/agent/src/agent/runtime.ts |
| projectAgentsDir | 项目级 agent 目录 | 覆盖全局同名 | 项目特化 agent | core/agent/src/agent/registry.ts |
| PromptCompiler | 提示词编译器 | 递归内联+脚本执行 | 编译 system/before_user | core/agent/src/agent/prompt-compiler.ts |
| prompt/system/ | 系统提示词目录 | system.md 入口 | agent 系统提示词根 | core/agent/templates/agent/prompt/system/README.md |
| prompt/before_user/ | 用户前注入目录 | before_user.md | 每轮用户消息前注入 | core/agent/templates/agent/prompt/before_user/README.md |
| prompt/compression/ | 压缩提示词目录 | compression.md | 上下文压缩时 prompt | core/agent/templates/agent/prompt/compression/README.md |
| project.json | 项目级开关 | features/permissions/prompt | 项目级 LLM 配置 | agent/coding-agent/templates/project.json |
| QueuedMessage | 队列消息 | id/message/mode/source/enqueuedAt | 队列条目结构 | core/agent/src/agent/message-queue.ts |
| refresh | 刷新编译缓存 | 重置 agentRuntime + reload config | 配置变更后重启 | core/agent/src/agent/runtime-facade.ts |
| register (Hooks) | 注册钩子 | 添加 handler 到事件 | 装配生命周期回调 | core/agent/src/agent/hooks.ts |
| register (BakeSystem) | 注册烘焙条目 | name+baker+trigger | 添加可注入上下文块 | core/agent/src/agent/bake.ts |
| renderAgentPreview | 渲染 agent 预览 | 写 PREVIEW_*.md | 开发调试看最终提示词 | core/agent/src/agent/template.ts |
| renderSkill | 渲染技能模板 | {{variable}} 替换 | 注入技能 prompt | core/agent/src/agent_factory/skill.ts |
| requestRemoval | 请求移除 agent | 标记 removal_request | agent 下线审批 | core/agent/src/agent/registry.ts |
| rollback | 回退 | git stash pop / reverse patch | 回退到指定 diff 点 | core/agent/src/agent_factory/git-watcher.ts |
| RollbackResult | 回退结果 | success + message | 回退操作返回 | core/agent/src/agent_factory/git-watcher.ts |
| round_end | 轮次结束阶段 | 一轮 LLM+工具结束 | after_round_complete 投递点 | core/agent/src/agent/message-queue.ts |
| round_limit | 轮次上限 | agent.json 字段 | 控制最大循环轮次 | core/agent/templates/agent/agent.json |
| runAgentCli | 运行 Agent CLI | 一条消息驱动 Runtime 逐事件回调 | 所有 agent 通用调试 | core/agent/src/cli/run-agent-cli.ts |
| runAgentCommand | 运行 agent 指令 | 执行 command/<name> 脚本 | /<name> 自定义指令 | core/agent/src/agent/command-runner.ts |
| runCodingAgentCli | 运行编程 Agent CLI | coding 特化薄包装 | 编程 agent CLI 调试 | agent/coding-agent/src/cli/index.ts |
| runFn | 运行函数 | harness 注入的子 Agent run | SubagentExecutor 装配 | core/agent/src/agent/subagent-executor.ts |
| runVerify | 运行验证命令 | 跑 verify_command 限 120s | 完成前 typecheck/test | core/agent/src/agent/runtime.ts |
| Runtime | Runtime 门面 | 通用高层 AgentRuntime 包装 | 所有 agent 应用复用 | core/agent/src/agent/runtime-facade.ts |
| RuntimeOptions | 运行时选项 | compiler/sessions/tools/callModel | AgentRuntime 装配入参 | core/agent/src/agent/runtime.ts |
| RunOptions | 运行选项 | preset/agentMode/abortSignal | 单次 run 入参 | core/agent/src/agent/runtime.ts |

### 4.7 S-U（agent + coding-agent 包）

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|--------|--------|------------|---------|---------|
| sandboxMode | 沙箱模式 | 终端命令隔离开关 | 限制危险命令执行 | core/tools/src/terminal/index.ts |
| sanitizeContent | 净化内容 | 截断/规范化文本 | tool_result 入 LLM 前 | core/agent/src/agent/materialize.ts |
| saveCheckpoint | 保存检查点 | 持久化当前 session | 上下文恢复 | core/context/src/checkpoint.ts |
| ScheduleConfig | 调度配置 | cron 表达式 + agentName | 声明定时触发 | core/agent/src/agent/schedule-registry.ts |
| ScheduleEntry | 调度条目 | 单条 cron + agent | 扫描 schedules/ 目录产出 | core/agent/src/agent/schedule-registry.ts |
| ScheduleRegistry | 调度注册表 | 扫描约定目录收集 schedules | 启动时注册定时任务 | core/agent/src/agent/schedule-registry.ts |
| ScheduledJob | 已调度任务 | setInterval 句柄 | 运行时管理定时器 | core/agent/src/agent/schedule-registry.ts |
| schedules/ 目录 | 调度目录 | 约定 agent 子目录 | 文件即 Agent 设计 | core/agent/templates/agent/schedules/ |
| sessionStart | 会话开始钩子 | 新建 session 时触发 | 注入初始上下文 | core/agent/src/agent/hooks.ts |
| sessionEnd | 会话结束钩子 | session 终止时触发 | 清理/落盘 | core/agent/src/agent/hooks.ts |
| setDefaultMode | 设置默认模式 | 设 agentMode | 切换 plan/coding/review | core/agent/src/agent/runtime.ts |
| setOnInterrupt | 设置中断回调 | abort 时调用 | 用户 /stop 注入 | core/agent/src/cli/run-agent-cli.ts |
| setSubagentExecutor | 设置子 Agent 执行器 | 注入 SubagentExecutor | 让 agent_message 跨包可用 | core/agent/src/agent/runtime.ts |
| setTerminalMode | 设置终端模式 | persistent/ephemeral | 控制终端复用 | core/agent/src/agent/runtime.ts |
| shouldContinue | 是否继续 | 判断 agent 循环是否进入下一轮 | max_rounds / 用户中断 | core/agent/src/agent/runtime.ts |
| shouldContinueLoop | 循环是否继续 | 与 shouldContinue 同义 | IAgentLoop 实现使用 | core/agent/src/agent/agent-loop-interface.ts |
| simpleHash | 简单哈希 | 字符串→36 进制短 hash | session ID / 文件指纹 | core/agent/src/agent/utils.ts |
| Skill | 技能 | 可复用 prompt + 工具包 | 跨 agent 复用能力 | core/agent/src/agent_factory/skill.ts |
| SkillContextManager | 技能上下文管理器 | 技能注入的消息裁剪 | 多技能共存时去重 | core/agent/src/agent_factory/skill.ts |
| SkillRegistry | 技能注册表 | 集中管理已注册 Skill | 按需加载技能 prompt | core/agent/src/agent_factory/skill.ts |
| skill/ 目录 | 技能目录 | 装载技能资源 | 文件即 Agent 扩展 | core/agent/templates/agent/skill/ |
| snapshotBeforeRun | 运行前快照 | run 前 git stash | 支持回退 | core/agent/src/agent_factory/git-watcher.ts |
| SNAPSHOT_INTERVAL | 快照间隔 | 触发自动快照的轮数 | 默认每 3 轮 | core/agent/src/agent_factory/git-watcher.ts |
| source | 来源标签 | 标记消息来源 | 文件即 Agent 物化追溯 | core/agent/src/agent/materialize.ts |
| startSession | 启动会话 | 加载/创建 session | Runtime.run() 入口 | core/agent/src/agent/runtime.ts |
| status 属性 | 状态属性 | active/paused/removed | agent 生命周期管理 | core/agent/src/agent/registry.ts |
| StealthMode | 隐身模式 | 工具名伪装成 Claude Code | 兼容性测试 | core/agent/src/agent/stealth.ts |
| stopReason | 停止原因 | end_turn / max_tokens / tool_use | 流式结束事件携带 | core/agent/src/agent/runtime.ts |
| StreamJsonAccumulator | 流式 JSON 累加器 | 逐字段解析 JSON | 流式输出时检测工具调用 | core/agent/src/agent/stream-accumulator.ts |
| stream | 流式 | async generator 返回 | LLM 流式响应 | core/agent/src/agent/runtime.ts |
| subagents/ 目录 | 子 Agent 目录 | 约定 agent 子目录 | 嵌套定义子 agent | core/agent/templates/agent/subagents/ |
| SubagentEntry | 子 Agent 条目 | 单条 subagent 声明 | 扫描 subagents/ 产出 | core/agent/src/agent/subagent-registry.ts |
| SubagentExecutor | 子 Agent 执行器 | 真并行 fork+合并 | #4 并行 task 执行 | core/agent/src/agent/subagent-executor.ts |
| SubagentExecutorLike | 子 Agent 执行器契约 | 跨包最小接口 | types 包定义供工具调用 | core/types/src/subagent.ts |
| SubagentExecutorOptions | 子 Agent 执行器选项 | runFn + maxConcurrency | 装配 SubagentExecutor | core/agent/src/agent/subagent-executor.ts |
| SubagentRegistry | 子 Agent 注册表 | 扫描 subagents/ 目录 | 生成 schema 供 LLM | core/agent/src/agent/subagent-registry.ts |
| SubagentResultLike | 子 Agent 结果契约 | ok/output/elapsedMs | 跨包返回结构 | core/types/src/subagent.ts |
| SubagentRunFn | 子 Agent 运行函数 | harness 注入的 run | SubagentExecutor 装配 | core/agent/src/agent/subagent-executor.ts |
| substitutePlaceholders | 替换占位符 | {{file}} / {{name}} 注入 | 编译 prompt 时 | core/agent/src/agent/template.ts |
| Summarizer | 摘要器 | 小模型压缩历史 | 70% 阈值触发压缩 | core/context/src/summarizer.ts |
| system_prompt | 系统提示 | agent 主入口 prompt | SYSTEM.md 字段 | core/agent/templates/agent/SYSTEM.md |
| system_background | 系统背景 | 注入背景信息 | 多 agent 协作时身份 | core/agent/src/agent/registry.ts |
| tag | 标签 | agent 分类标签 | /list 按标签筛选 | core/agent/src/agent/registry.ts |
| task_complete | 任务完成阶段 | 完整任务结束 | after_task_complete 投递点 | core/agent/src/agent/message-queue.ts |
| task_plan | 任务计划 | LLM 输出的任务分解 | 多 task 并行调度 | agent/coding-agent/src/types.ts |
| task_finish | 任务结束 | agent 退出标志 | 标记任务完成 | agent/coding-agent/src/index.ts |
| task_id | 任务 ID | 标识单条 task | 关联 session 消息与 task | core/context/src/session-store.ts |
| task_ids | 任务 ID 数组 | 单条消息可属多 task | 多任务关联 | core/context/src/session-store.ts |
| TEMPLATE_DIR | 模板目录 | 装载 agent 模板 | 初始化新 agent | core/agent/src/agent/materialize.ts |
| TEMPLATE_SCRIPTS | 模板脚本目录 | 装载脚本模板 | {{>>script}} 执行 | core/agent/src/agent/template.ts |
| terminal_mode | 终端模式 | persistent/ephemeral | 控制终端复用 | core/agent/src/agent/runtime.ts |
| terminal_status | 终端状态 | running/idle/blocked | 注入动态上下文 | core/agent/src/dynamic-context.ts |
| thinking | 思考标签 | 内部推理分隔 | 跨厂商交接保留 | core/llm/src/handoff.ts |
| toLLMHistory | 转 LLM 历史 | session → messages 数组 | 调 LLM 前构造消息 | core/context/src/context-engine.ts |
| toToolSchemas | 转工具 schema | Tool[] → LLM schema[] | 工具白名单过滤后注入 | core/tools/src/tool.ts |
| TokenAuth | Token 鉴权 | hub Token 校验 | 设备 SSE 连接鉴权 | core/hub/src/auth.ts |
| TokenTracker | Token 追踪器 | 累计 input/output token | 计费与上下文裁剪 | core/agent/src/agent/token-tracker.ts |
| TokenUsage | Token 用量 | 单轮 input/output/cache | 单次 LLM 调用统计 | core/llm/src/types.ts |
| TokenRecord | Token 记录 | 累计会话用量 | 跨轮汇总 | core/agent/src/agent/token-tracker.ts |
| tool_compression | 工具压缩 | 历史工具调用摘要化 | 70% 阈值后压缩 | core/context/src/compress.ts |
| toolWhitelist | 工具白名单 | agent 允许使用的工具 | PERMISSION.jsonc 强制 | core/agent/templates/agent/PERMISSION.jsonc |
| toolIsBlocking | 工具是否阻塞 | 标记工具是否独占执行 | 阻塞类工具串行 | core/tools/src/tool.ts |
| toolIsParallelSafe | 工具是否可并行 | 标记工具可否并发 | 并行调度判断 | core/tools/src/tool.ts |
| toolEndsLoop | 工具结束循环 | 该工具后停止 agent loop | 终止型工具 | core/agent/src/agent/runtime.ts |
| tools/ 目录 | 工具目录 | 约定 agent 子目录 | 文件即 Agent 设计 | core/agent/templates/agent/tools/ |
| triggers/ 目录 | 触发器目录 | 约定 agent 子目录 | 声明事件触发 | core/agent/templates/agent/triggers/ |
| trigger | 触发器 | 事件源声明 | 监听 IM/webhook 事件 | core/agent/src/agent/trigger-registry.ts |
| unregister | 注销 | 移除已注册项 | 卸载 agent/skill | core/agent/src/agent/registry.ts |
| update | 更新 | 刷新 agent 元数据 | 修改 agent.json | core/agent/src/agent/registry.ts |
| usagePercent | 用量百分比 | 上下文占用比 | 压缩触发判断 | core/context/src/context-engine.ts |

### 4.8 V-Z（agent + coding-agent 包）

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|--------|--------|------------|---------|---------|
| verifyAttempts | 验证尝试次数 | verify_command 重试上限 | 默认 3 次 | agent/coding-agent/src/types.ts |
| verify_command | 验证命令 | 完成前必须通过的命令 | 强制 typecheck/test | agent/coding-agent/src/types.ts |
| verification | 验证 | 完成前必经检查 | coding agent 收尾 | agent/coding-agent/src/index.ts |
| version | 版本 | agent.json 版本字段 | 升级兼容判断 | core/agent/templates/agent/agent.json |
| View | 视图 | session 当前展示切片 | 多任务下过滤展示 | core/context/src/session-store.ts |
| workspace 标签 | 工作区标签 | 标记改动范围 | diff 累积归类 | core/agent/src/agent_factory/git-watcher.ts |
| workspaceChanges | 工作区改动 | 累积 git diff | 回退 / 提交前快照 | core/agent/src/agent_factory/git-watcher.ts |
| workspace_changes | 工作区改动数组 | JSON 化的 diff 列表 | 序列化快照 | core/agent/src/agent_factory/git-watcher.ts |
| writeSessionMessage | 写会话消息 | 追加消息到 jsonl | session 持久化 | core/context/src/session-store.ts |
| YAML frontmatter | YAML 头部 | .md 文件元数据头 | 角色卡 SillyTavern V2 | core/agent/src/agent/character-card.ts |
| yield | 让步 | async generator 产出 | 流式事件返回 | core/agent/src/agent/runtime.ts |
| AsyncGenerator | 异步生成器 | 流式数据源类型 | agent run() 返回类型 | core/agent/src/agent/runtime.ts |
| {{file.md}} | 文件包含指令 | 递归注入 md 内容 | 编译提示词树 | core/agent/templates/agent/SYSTEM.md |
| {{>>script.py}} | 脚本执行指令 | 运行脚本注入输出 | 动态上下文 | core/agent/templates/agent/SYSTEM.md |
| {{display_name}} | 显示名占位符 | 编译期替换 | agent 元数据注入 | core/agent/src/agent/template.ts |
| {{role}} | 角色占位符 | 编译期替换 | 角色信息注入 | core/agent/src/agent/template.ts |

---

## 5. hub + cli + 其他引擎包

涵盖：`core/hub`、`cli`、`lsp-engine`、`opencli-engine`、`sqry-engine` 五个包。

### 5.1 A-C（hub + cli + 其他引擎包）

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|--------|--------|------------|---------|---------|
| App | 主应用组件 | CLI 全屏挂载根 | React + ink 渲染入口 | cli/src/app.tsx |
| App (lsp-engine) | 应用层 | lsp-engine 顶层描述 | 文件头注释 | lsp-engine/src/index.ts |
| AsciiArt | ASCII 艺术 | 图片转字符画 | 终端显示图片 | cli/src/image/ascii.ts |
| AsciiMode | ASCII 模式 | 字符画渲染模式 | 调整图片细节 | cli/src/image/ascii.ts |
| AsciiOptions | ASCII 选项 | 字符集/密度 | 配置字符画输出 | cli/src/image/ascii.ts |
| asciiFromImage | 由图生 ASCII | buffer → 字符画 | 终端预览图 | cli/src/image/ascii.ts |
| auto_register | 自动注册 | 启动即向 gateway 注册 | hub 设备上线 | core/hub/src/types.ts |
| autoStart | 自动启动 | 启动时拉起 | 插件配置字段 | core/hub/src/plugin-types.ts |
| batch | 批量执行 | 同 session 顺序多步 | opencli 多动作 | opencli-engine/src/index.ts |
| blockFor | 阻塞等待 | 阻塞至条件 | lsp-engine settle | lsp-engine/src/diagnostics.ts |
| brailleFromGrid | 盲文网格 | 2x4 像素 → 盲文字符 | 高密度 ASCII 渲染 | cli/src/image/ascii.ts |
| CUBE | 立方体 ASCII 图 | 3D 立方体艺术字 | 启动 LOGO | cli/src/components/graphics.tsx |
| CRYSTAL | 水晶 ASCII 图 | 水晶艺术字 | 启动 LOGO | cli/src/components/graphics.tsx |
| callers | 调用方查询 | 谁调用了该符号 | sqry 代码反查 | sqry-engine/src/index.ts |
| callees | 被调用方查询 | 它调用了谁 | sqry 代码反查 | sqry-engine/src/index.ts |
| ChatMessage | 聊天消息 | 单条对话记录 | CLI 状态存储 | cli/src/state/store.ts |
| ChatView | 对话视图 | 渲染消息列表 | CLI 主面板 | cli/src/components/Chat.tsx |
| cleanupWorkspace | 清理工作区 | 释放所有 LSP 资源 | 进程退出前 | lsp-engine/src/pool.ts |
| ClientBase | 客户端基类 | 抽象 hub 客户端 | 多种客户端复用 | core/hub/src/client.ts |
| Collapsible | 折叠面板 | 可开关的容器 | 响应式布局 | cli/src/components/Collapsible.tsx |
| colToCharIndex | 列→字符索引 | 终端列号映射字符 | InputBox 选区 | cli/src/components/InputBox.tsx |
| CommandPalette | 命令面板 | 模糊命令选择 | Ctrl+K 调出 | cli/src/components/Modals.tsx |
| CompletionItemLite | 补全项精简版 | label/kind/insertText | lsp-engine 补全 | lsp-engine/src/types.ts |
| completion | 补全 | 触发 LSP 补全 | 代码补全 | lsp-engine/src/index.ts |
| contextData | 上下文数据 | multi 步骤间变量 | opencli 模板变量 | opencli-engine/src/index.ts |
| Context (LLMConfig) | 上下文 | systemPrompt + messages | LLM 调用入参 | cli/src/sdk/index.ts |
| copyToClipboard | 复制到剪贴板 | OSC52 复制 | 终端跨平台复制 | cli/src/clipboard.ts |
| cycles | 循环依赖 | 检测代码循环 | sqry 结构分析 | sqry-engine/src/index.ts |
| CyclesOptions | 循环依赖选项 | type/minDepth | 配置循环检测 | sqry-engine/src/index.ts |

### 5.2 D-F（hub + cli + 其他引擎包）

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|--------|--------|------------|---------|---------|
| DEFAULT_HUB_CONFIG | 默认 Hub 配置 | 端口 8098/8096/8097 | hub 初始化默认值 | core/hub/src/types.ts |
| definition | 定义跳转 | 跳到符号定义 | lsp-engine 语义跳转 | lsp-engine/src/index.ts |
| Demo | 演示组件 | 主题展示 | 开发预览主题 | cli/src/demo.tsx |
| DeviceInfo | 设备信息 | device_id/hostname/roles | hub 设备元数据 | core/hub/src/types.ts |
| DeviceRegistry | 设备注册表 | 维护在线设备列表 | hub 设备管理 | core/hub/src/device-registry.ts |
| DeviceStatus | 设备状态 | online/offline/busy | hub 设备显示 | core/hub/src/types.ts |
| Diag | 诊断条目 | severity/range/message | lsp-engine 单条诊断 | lsp-engine/src/types.ts |
| diagnostics | 诊断（单文件） | 拉取文件诊断 | 验证文件无错 | lsp-engine/src/index.ts |
| diagnosticsWorkspace | 工作区诊断 | 整个目录诊断 | 是否无错 | lsp-engine/src/index.ts |
| diagnosticsWorkspace | 工作区诊断 | 聚合目录诊断 | 全项目错误统计 | lsp-engine/src/index.ts |
| Dialog | 对话框 | 模态对话框 | 二次确认 | cli/src/components/Dialog.tsx |
| DialogRow | 对话框行 | 单行表单项 | 表单渲染 | cli/src/components/Dialog.tsx |
| disableMouse | 关鼠标 | 关闭 1000 模式 | 退出时还原 | cli/src/index.tsx |
| discoverPlugins | 发现插件 | 扫描插件目录 | 自动加载插件 | core/hub/src/plugin.ts |
| Divider | 分隔线 | 视觉分割 | UI 分区 | cli/src/components/graphics.tsx |
| documentSymbols | 文档符号 | 单文件符号树 | 大纲展示 | lsp-engine/src/index.ts |
| duplicates | 重复代码 | 检测代码重复 | sqry 质量分析 | sqry-engine/src/index.ts |
| EngineResult | 引擎结果 | ok/message/payload | opencli 统一返回 | opencli-engine/src/types.ts |
| ensureIndex | 确保索引 | 构建 .sqry/graph | sqry 搜索前置 | sqry-engine/src/index.ts |
| EventBus | 事件总线 | 内部事件分发 | hub 内部通信 | core/hub/src/event-bus.ts |
| EventType | 事件类型枚举 | device.online/message.incoming | hub 事件分类 | core/hub/src/types.ts |
| explain | 解释符号 | 解释符号上下文 | sqry 文档查询 | sqry-engine/src/index.ts |
| EXEC_BUFFER | 执行缓冲 | 子进程输出缓冲 | opencli 调用 opencli CLI | opencli-engine/src/exec.ts |
| EXEC_TIMEOUT | 执行超时 | 默认 30000ms | opencli 子进程超时 | opencli-engine/src/exec.ts |
| externalDependencies | 外部依赖 | 第三方密钥等 | 插件配置 | core/hub/src/plugin-types.ts |

### 5.3 G-I（hub + cli + 其他引擎包）

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|--------|--------|------------|---------|---------|
| gaugeBar | 仪表条 | 进度条渲染 | HUD 显示 | cli/src/components/Hud.tsx |
| Gauge | 仪表 | 状态指示器 | HUD 显示 | cli/src/components/graphics.tsx |
| getServerForFile | 取文件服务器 | 找匹配的 LSP | 按扩展名路由 | lsp-engine/src/pool.ts |
| getStateContent | 获取状态内容 | 拉取 DOM 状态 | opencli watch 轮询 | opencli-engine/src/index.ts |
| gradientStops | 渐变停止点 | 渐变颜色数组 | 渐变文本 | cli/src/components/Gradient.tsx |
| GradientBar | 渐变条 | 横向渐变 | 装饰条 | cli/src/components/Gradient.tsx |
| GradientBlock | 渐变块 | 块状渐变 | 背景装饰 | cli/src/components/Gradient.tsx |
| GradientField | 渐变字段 | 输入框渐变 | 输入框样式 | cli/src/components/Gradient.tsx |
| GradientText | 渐变文本 | 文字渐变 | 标题渲染 | cli/src/components/Gradient.tsx |
| hexToRgb | 十六进制转 RGB | #RRGGBB → [r,g,b] | 颜色计算 | cli/src/color.ts |
| hierarchy | 调用层级 | call hierarchy | sqry 结构查询 | sqry-engine/src/index.ts |
| History (lsp-engine) | 历史记录 | diagnostic 缓存 | 增量诊断 | lsp-engine/src/diagnostics.ts |
| HistoryOptions | 历史选项 | 配置历史记录 | 历史管理 | lsp-engine/src/diagnostics.ts |
| hover | 悬停信息 | 取符号 hover | 查看类型提示 | lsp-engine/src/index.ts |
| HoverInfo | 悬停信息结构 | contents + range | lsp-engine 返回 | lsp-engine/src/types.ts |
| HttpClient | HTTP 客户端 | 走 HTTP 的 hub 客户端 | 不支持 ws 时降级 | core/hub/src/client.ts |
| HubClient | Hub 客户端 | 通用 hub 客户端 | 设备接入 | core/hub/src/client.ts |
| HubConfig | Hub 配置 | device_id/ports/role | hub 启动配置 | core/hub/src/types.ts |
| HubEvent | Hub 事件 | 内部事件类型 | 总线分发 | core/hub/src/types.ts |
| HubMessage | Hub 消息 | 跨设备消息体 | 设备间通信 | core/hub/src/types.ts |
| HubServer | Hub 服务器 | 端口 8098 Express | 多设备中心 | core/hub/src/server.ts |
| Hud | HUD 面板 | 角色状态/动画 | 主屏右侧装饰 | cli/src/components/Hud.tsx |
| HudStats | HUD 统计 | token/cost/round | 状态聚合 | cli/src/state/store.ts |
| impact | 影响范围 | 修改某符号的影响 | sqry 变更评估 | sqry-engine/src/index.ts |
| ImpactOptions | 影响选项 | depth/limit/inFile | 配置影响查询 | sqry-engine/src/index.ts |
| InputBox | 输入框 | CLI 输入组件 | 主交互区 | cli/src/components/InputBox.tsx |
| InputBoxProps | 输入框属性 | value/cursor/focused | 装配 InputBox | cli/src/components/InputBox.tsx |
| isAvailable | 是否可用 | 检查二进制存在 | 启动前探测 | opencli-engine/src/exec.ts |
| isServerAvailable | 服务器是否可用 | 该文件类型有 LSP 配置 | 跳过无服务器的文件 | lsp-engine/src/index.ts |

### 5.4 J-L（hub + cli + 其他引擎包）

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|--------|--------|------------|---------|---------|
| knownActions | 已知动作 | opencli 支持的 action 列表 | 校验/帮助 | opencli-engine/src/shortcuts.ts |
| LanguageServer | 语言服务器 | LSP 进程包装 | 单语言分析器 | lsp-engine/src/server.ts |
| lerpColor | 颜色插值 | 两色之间过渡 | 渐变颜色 | cli/src/color.ts |
| Loc | 位置结构 | file/line/character | lsp-engine 跳转结果 | lsp-engine/src/types.ts |
| LOGO | LOGO ASCII 图 | 启动 LOGO | 启动时显示 | cli/src/components/graphics.tsx |

### 5.5 M-O（hub + cli + 其他引擎包）

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|--------|--------|------------|---------|---------|
| Markdown | Markdown 渲染器 | 终端 markdown 渲染 | 消息展示 | cli/src/components/Markdown.tsx |
| Message | 消息 | 通用消息体 | 通用消息载体 | cli/src/components/Chat.tsx |
| MessageListener | 消息监听器 | 客户端订阅回调 | hub 接收消息 | core/hub/src/client.ts |
| MessageType | 消息类型 | agent_msg/event/command/sync | hub 消息分类 | core/hub/src/types.ts |
| ModalKind | 模态框类型 | model/help/command/confirm | 切换弹窗 | cli/src/state/store.ts |
| ModelPicker | 模型选择器 | 选 provider/model | Ctrl+M 调出 | cli/src/components/Modals.tsx |
| MOUSE_RE | 鼠标正则 | 匹配鼠标转义序列 | 解析鼠标事件 | cli/src/input/mouse.ts |
| MouseEvent | 鼠标事件 | type/row/col | 处理点击拖动 | cli/src/input/mouse.ts |
| MSG_LIMIT | 消息上限 | opencli 输出截断阈值 | 防止过长输出 | opencli-engine/src/shortcuts.ts |
| multi | 多步执行 | 跨 session 多步 + 模板变量 | opencli 编排 | opencli-engine/src/index.ts |
| MultiResult | 多步结果 | 单步结果聚合 | multi 返回结构 | opencli-engine/src/types.ts |
| MultiStep | 多步条目 | 单步声明 | multi 入参 | opencli-engine/src/types.ts |
| NoServerForFileError | 无服务器错误 | 该文件类型未注册 | 抛错提示用户 | lsp-engine/src/types.ts |
| normalizeForHandoff | 跨厂商交接规范化 | thinking 标签/降级 | 切换 LLM 厂商 | core/llm/src/handoff.ts |
| openExternalEditor | 打开外部编辑器 | $EDITOR 写入临时文件 | Ctrl+G IME 回退 | cli/src/hooks/useExternalEditor.ts |
| OpencliEnvelope | opencli 信封 | 解析后的结构化响应 | 统一返回 | opencli-engine/src/types.ts |
| osc52 | OSC52 序列 | 终端剪贴板协议 | 跨平台复制 | cli/src/clipboard.ts |

### 5.6 P-R（hub + cli + 其他引擎包）

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|--------|--------|------------|---------|---------|
| padEndWidth | 等宽补齐 | 按显示宽度补齐 | 终端对齐 | cli/src/components/graphics.tsx |
| Panel | 面板 | 带边框容器 | 区块容器 | cli/src/components/Panel.tsx |
| parseInline | 行内解析 | markdown 行内元素 | 单行渲染 | cli/src/components/Markdown.tsx |
| parseMouse | 解析鼠标 | 转义 → MouseEvent | 鼠标事件解码 | cli/src/input/mouse.ts |
| parseOpencliOutput | 解析 opencli 输出 | raw → envelope | opencli 输出结构化 | opencli-engine/src/shortcuts.ts |
| parseGraph | 解析图结果 | JSON → 图查询结果 | sqry 解析 | sqry-engine/src/parse.ts |
| parseSearch | 解析搜索结果 | JSON → 搜索条目 | sqry 解析 | sqry-engine/src/parse.ts |
| pickExpression | 表情选择 | 根据状态选 ASCII | 角色表情切换 | cli/src/components/Hud.tsx |
| Plugin | 插件 | 插件接口 | 自定义扩展 | core/hub/src/plugin-types.ts |
| PluginBase | 插件基类 | 抽象实现 | 自定义插件继承 | core/hub/src/plugin.ts |
| PluginAuthor | 插件作者 | name/email/url | 插件元信息 | core/hub/src/plugin-types.ts |
| PluginCompatibility | 插件兼容性 | maouAgent/node/platforms | 升级检查 | core/hub/src/plugin-types.ts |
| PluginConfig | 插件配置 | name/version/mode/enabled | 插件完整配置 | core/hub/src/plugin-types.ts |
| PluginConfigProperty | 配置项 schema | type/required/default | 运行时配置定义 | core/hub/src/plugin-types.ts |
| PluginEvent | 插件事件 | started/stopped/error | 插件生命周期事件 | core/hub/src/plugin-types.ts |
| PluginEvents | 插件事件声明 | subscribes/emits | 事件契约 | core/hub/src/plugin-types.ts |
| PluginExternalDependency | 外部依赖项 | display/type/env | API 密钥等配置 | core/hub/src/plugin-types.ts |
| PluginFsPermission | 文件权限 | read/write 路径 | 限制插件访问 | core/hub/src/plugin-types.ts |
| PluginHooks | 插件钩子 | onLoad/onEnable/onDisable | 生命周期回调 | core/hub/src/plugin-types.ts |
| PluginI18n | 插件国际化 | defaultLocale/locales | 多语言支持 | core/hub/src/plugin-types.ts |
| PluginInstance | 插件实例 | name/config/status/pid | 运行时实例 | core/hub/src/plugin-types.ts |
| PluginListResponse | 插件列表响应 | plugins/total/running | API 返回 | core/hub/src/plugin-types.ts |
| PluginManagerConfig | 插件管理器配置 | pluginsDir/autoDiscover | 装配插件管理 | core/hub/src/plugin-types.ts |
| PluginMessage | 插件消息 | 跨插件通信 | 事件总线分发 | core/hub/src/plugin.ts |
| PluginMeta | 插件元信息 | name/version/description | 最小元信息 | core/hub/src/plugin.ts |
| PluginMenuItem | 插件菜单项 | id/display/path | Web UI 扩展 | core/hub/src/plugin-types.ts |
| PluginMode | 插件模式 | module/subprocess | 启动方式 | core/hub/src/plugin-types.ts |
| PluginNetworkPermission | 网络权限 | outbound 白名单 | 限制插件出站 | core/hub/src/plugin-types.ts |
| PluginPermissions | 插件权限 | tools/network/fs | 插件能力限制 | core/hub/src/plugin-types.ts |
| PluginProvides | 插件提供能力 | tools/skills/prompts | 声明贡献资源 | core/hub/src/plugin-types.ts |
| PluginRepository | 插件仓库 | type/url/directory | 来源信息 | core/hub/src/plugin-types.ts |
| PluginStatus | 插件状态 | installed/running/error | 运行时状态 | core/hub/src/plugin-types.ts |
| PluginStatusConfig | 状态监控配置 | healthCheck/metrics | 健康检查 | core/hub/src/plugin-types.ts |
| PluginUI | 插件 UI | web/settings/menuItems | 界面扩展 | core/hub/src/plugin-types.ts |
| PLUGIN_METADATA | 插件元数据装饰器 | 标记插件类 | 自动发现 | core/hub/src/plugin.ts |
| pollLoop | 轮询循环 | opencli watch 内部循环 | 等待变化 | opencli-engine/src/index.ts |
| priority | 优先级 | 启动顺序 | 插件配置字段 | core/hub/src/plugin-types.ts |
| RawResult | 原始结果 | 未格式化的 opencli 输出 | 内部使用 | opencli-engine/src/types.ts |
| references | 引用查询 | 符号被引用位置 | 找使用方 | lsp-engine/src/index.ts |
| registerServers | 注册服务器 | 注册 ServerSpec | 多语言扩展 | lsp-engine/src/registry.ts |
| rename | 重命名预览 | 返回预览不写盘 | 重命名建议 | lsp-engine/src/index.ts |
| RenameEdit | 重命名编辑 | 单条重命名修改 | 重命名细节 | lsp-engine/src/types.ts |
| RenamePreview | 重命名预览 | changes 数组 | 重命名预览结果 | lsp-engine/src/types.ts |
| resolveSpec | 解析规范 | 按扩展名找 ServerSpec | 内部路由 | lsp-engine/src/registry.ts |
| roleGlyph | 角色字形 | 不同角色的 ASCII | 消息头像 | cli/src/components/Chat.tsx |
| run | 执行 | opencli 主入口 | 调用 action | opencli-engine/src/index.ts |
| RunOpts | 运行选项 | provider/model/signal | runChat 装配 | cli/src/sdk/index.ts |
| runChat | 运行对话 | stream 驱动 CLI | 主交互循环 | cli/src/sdk/index.ts |
| runOpencli | 同步执行 opencli | execFile 调用 | 通用执行 | opencli-engine/src/exec.ts |
| runOpencliAsync | 异步执行 opencli | Promise 化 | watch 轮询 | opencli-engine/src/exec.ts |
| runRaw | 执行原始命令 | action=run | 直接执行命令 | opencli-engine/src/index.ts |
| runSqry | 执行 sqry | 调 sqry 子进程 | sqry 通用执行 | sqry-engine/src/binary.ts |

### 5.7 S-U（hub + cli + 其他引擎包）

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|--------|--------|------------|---------|---------|
| ScrollView | 滚动视图 | 可滚动容器 | 长消息展示 | cli/src/components/Scrollable.tsx |
| search | 搜索 | 按名搜符号 | sqry 查询 | sqry-engine/src/index.ts |
| SearchOptions | 搜索选项 | kind/lang/exact | 配置搜索 | sqry-engine/src/index.ts |
| ServerCrashError | 服务器崩溃错误 | LSP 进程崩 | 重试提示 | lsp-engine/src/types.ts |
| ServerNotInstalledError | 服务器未安装错误 | 二进制缺失 | 安装提示 | lsp-engine/src/types.ts |
| ServerSpec | 服务器规范 | command/args/langs | 注册 LSP | lsp-engine/src/registry.ts |
| SettleInfo | 收敛信息 | settled/reason/waitedMs | 诊断稳定状态 | lsp-engine/src/types.ts |
| SettleOptions | 收敛选项 | quietMs/hardMs | 配置诊断等待 | lsp-engine/src/diagnostics.ts |
| SHORTCUTS | 快捷映射 | action → argv 函数 | opencli 参数生成 | opencli-engine/src/shortcuts.ts |
| shutdownAll | 全部关闭 | 关闭所有 LSP 进程 | 进程退出 | lsp-engine/src/pool.ts |
| Sidebar | 侧边栏 | 左侧面板 | 历史会话 | cli/src/components/Hud.tsx |
| Spark | 火花线 | sparkline 渲染 | HUD 数据趋势 | cli/src/components/graphics.tsx |
| sparkline | 火花图 | 数组 → 趋势字符 | 状态可视化 | cli/src/components/graphics.tsx |
| Spinner | 加载动画 | 旋转字符 | 等待状态 | cli/src/components/graphics.tsx |
| SqryAmbiguousError | sqry 歧义错误 | 符号名不唯一 | 提示用户限定 | sqry-engine/src/types.ts |
| SqryEntry | sqry 条目 | 单条搜索结果 | sqry 数据结构 | sqry-engine/src/types.ts |
| SqryGraphResult | sqry 图结果 | entries + totalFound | 调用图返回 | sqry-engine/src/types.ts |
| SqryIndexError | sqry 索引错误 | 索引构建失败 | 提示用户 | sqry-engine/src/types.ts |
| SqryNotInstalledError | sqry 未安装错误 | 二进制缺失 | 安装提示 | sqry-engine/src/types.ts |
| SqrySearchResult | sqry 搜索结果 | entries + totalMatches | 搜索返回 | sqry-engine/src/types.ts |
| SqryTextResult | sqry 文本结果 | text 字段 | 文本类查询返回 | sqry-engine/src/types.ts |
| StatusBar | 状态栏 | 底部状态行 | 显示模式/鼠标状态 | cli/src/components/Hud.tsx |
| stopReason | 停止原因 | end_turn/max_tokens | 流式结束事件 | cli/src/sdk/index.ts |
| stripMouseSequences | 剥离鼠标序列 | 过滤输入中的转义 | 防止鼠标事件污染输入 | cli/src/hooks/useCleanInput.ts |
| subgraph | 子图 | 局部代码图 | sqry 结构查询 | sqry-engine/src/index.ts |
| SymbolLite | 符号精简版 | name/kind/file | lsp-engine 大纲 | lsp-engine/src/types.ts |
| syncDoc | 同步文档 | didOpen/didChange | 保持 LSP 文件状态 | lsp-engine/src/server.ts |
| syncDocEx | 同步文档（扩展） | 返回 changed | 诊断时增量同步 | lsp-engine/src/server.ts |
| TermSize | 终端尺寸 | cols/rows/showSidebar | 响应式布局 | cli/src/hooks/useTerminalSize.ts |
| THEMES | 主题集合 | 所有可用主题 | 主题列表 | cli/src/theme.ts |
| Theme | 主题 | bg/fg/accent/gradient | 主题定义 | cli/src/theme.ts |
| Toast | 提示消息 | 临时浮层 | 操作反馈 | cli/src/components/Hud.tsx |
| toDiag | 转诊断 | LSP 原生 → Diag | 内部转换 | lsp-engine/src/convert.ts |
| toHover | 转 hover | LSP 原生 → HoverInfo | 内部转换 | lsp-engine/src/convert.ts |
| toLoc | 转位置 | LSP 原生 → Loc | 内部转换 | lsp-engine/src/convert.ts |
| toLocArray | 转位置数组 | LSP 原生 → Loc[] | 跳转结果转换 | lsp-engine/src/convert.ts |
| TopBar | 顶栏 | LOGO + 主题指示 | 顶部装饰 | cli/src/components/Hud.tsx |
| toRenamePreview | 转重命名预览 | LSP 原生 → RenamePreview | 内部转换 | lsp-engine/src/convert.ts |
| toSymbols | 转符号 | LSP 原生 → SymbolLite[] | 大纲转换 | lsp-engine/src/convert.ts |
| tracePath | 路径追踪 | 两符号间调用链 | sqry 关系查询 | sqry-engine/src/index.ts |
| truncate | 截断 | 限制输出长度 | opencli 输出控制 | opencli-engine/src/shortcuts.ts |
| truncateToWidth | 按宽度截断 | 终端字符宽度 | UI 对齐 | cli/src/components/graphics.tsx |
| typeDefinition | 类型定义跳转 | 跳到类型定义 | lsp-engine 语义跳转 | lsp-engine/src/index.ts |

### 5.8 V-Z（hub + cli + 其他引擎包）

| 英文名 | 中文名 | 一句话解释 | 应用场景 | 文件路径 |
|--------|--------|------------|---------|---------|
| unused | 死代码 | 未使用符号 | sqry 质量分析 | sqry-engine/src/index.ts |
| UnusedOptions | 死代码选项 | scope/lang | 配置死代码查询 | sqry-engine/src/index.ts |
| uriToPath | URI 转路径 | file:// → 本地路径 | LSP 输出转换 | lsp-engine/src/convert.ts |
| VfdTag | VFD 标签 | 复古屏显字符 | 装饰元素 | cli/src/components/graphics.tsx |
| waitSettle | 等待收敛 | 全工作区诊断稳定 | 诊断完成判断 | lsp-engine/src/diagnostics.ts |
| waitSettleFile | 等待文件收敛 | 单文件诊断稳定 | 诊断完成判断 | lsp-engine/src/diagnostics.ts |
| watch | 监听 | 轮询 DOM 变化 | opencli 等待条件 | opencli-engine/src/index.ts |
| WatchCallback | 监听回调 | 文件变化回调 | git/file 监听 | core/agent/src/agent_factory/git-watcher.ts |
| workspaceSymbols | 工作区符号 | 查询符号 | 大纲搜索 | lsp-engine/src/index.ts |
| WorkspaceDiagsResult | 工作区诊断结果 | files/errorCount/settle | 整项目诊断返回 | lsp-engine/src/types.ts |
| yaml | YAML 解析 | 解析 frontmatter | 角色卡字段 | cli/src/components/Markdown.tsx |
| useCleanInput | 清洁输入钩子 | 过滤鼠标转义 | 防止乱码插入 | cli/src/hooks/useCleanInput.ts |
| useImeCursor | IME 光标钩子 | 中文输入法光标定位 | 支持中文输入 | cli/src/hooks/useImeCursor.ts |
| useMouse | 鼠标钩子 | 监听 1002 模式 | 鼠标交互 | cli/src/hooks/useMouse.ts |
| useScroll | 滚动钩子 | 滚动状态管理 | 长消息滚动 | cli/src/hooks/useScroll.ts |
| useStore | 状态钩子 | zustand store | CLI 全局状态 | cli/src/state/store.ts |
| useTerminalSize | 终端尺寸钩子 | 响应 resize | 响应式布局 | cli/src/hooks/useTerminalSize.ts |
| useTween | 补间动画钩子 | 帧动画 | HUD 动画 | cli/src/hooks/useTween.ts |
| enableMouse | 启用鼠标 | 开 1002 模式 | 鼠标交互时 | cli/src/index.tsx |
| Focus | 焦点 | input/sidebar/hud/chat | 焦点切换 | cli/src/app.tsx |
| FocusFrame | 焦点框 | 高亮当前焦点 | 视觉提示 | cli/src/components/Focus.tsx |
| FileDiags | 文件诊断集合 | file + diagnostics[] | 单文件诊断返回 | lsp-engine/src/types.ts |
| findSqryBinary | 查找 sqry 二进制 | PATH/默认路径 | sqry 启动 | sqry-engine/src/binary.ts |
| findWorkspaceRoot | 查找工作区根 | 向上找项目根 | LSP 启动定位 | lsp-engine/src/pool.ts |
| formatEnvelope | 格式化信封 | envelope → 文本 | opencli 输出渲染 | opencli-engine/src/shortcuts.ts |

---

## 附录：扫描覆盖确认

### 扫描范围

本术语表扫描了 `maou-sdk` 仓库的以下 13 个包：

| 包 | 路径 | 主要内容 |
|----|------|---------|
| types | `core/types/src/` | 共享类型 + ConfigStore + project-manager + utils |
| llm | `core/llm/src/` | HTTP 调用 / 流式 / 适配器 / 工具 / agentLoop / handoff / OAuth |
| tools | `core/tools/src/` | 工具注册表 / 执行器 / 内置工具 / terminal TS 侧 |
| terminal-engine | `terminal-engine/src/` | Rust 原生终端引擎（napi-rs + portable-pty） |
| context | `core/context/src/` | 会话持久化 / 消息构建 / 压缩 / 检查点 / 摘要 |
| prompt | `core/prompt/src/` | 提示词编译器 / 角色注册表 / 动态注入 |
| agent | `core/agent/src/` | AgentRuntime / 子 Agent / 注册表 / 消息队列 / 烘焙 / 技能 |
| coding-agent | `agent/coding-agent/src/` | 编程 agent 特化层 |
| hub | `core/hub/src/` | 多设备通信中心 / 插件系统 |
| cli | `cli/src/` | TUI 应用（React + ink） |
| lsp-engine | `lsp-engine/src/` | headless LSP 客户端引擎 |
| opencli-engine | `opencli-engine/src/` | opencli I/O 引擎 |
| sqry-engine | `sqry-engine/src/` | sqry 代码结构搜索引擎 |

### 统计

- **章节数**：5 章（按包职责分组）
- **子组数**：8 子组 × 5 章 = 40 个子节（按字母 A-C/D-F/G-I/J-L/M-O/P-R/S-U/V-Z 分组）
- **术语总数**：约 800+ 条
- **同概念去重原则**：同一概念在多包出现时只列首次定义处；跨包同名但不同源的概念各自保留并注明所在包
- **跨包同名保留示例**：
  - `StreamEvent` — 在 types/llm/adapters 三处定义，列于 types 包
  - `EffortLevel` — 在 compat.ts 与 reasoning.ts 两处定义，分别保留
  - `Terminal` / `TerminalRegistry` / `TerminalState` — TS 侧（core/tools）与 Rust 侧（terminal-engine）各自保留
  - `Context` — types 包的会话上下文 vs cli 包的 LLM 调用上下文，分别保留
  - `RunOpts` / `RunOptions` — cli 与 agent 两处，分别保留

### 文件路径索引

各包入口文件（用于快速查找扩展点）：

| 入口文件 | 路径 |
|---------|------|
| types | `core/types/src/index.ts` |
| llm | `core/llm/src/index.ts` |
| tools | `core/tools/src/index.ts` |
| terminal-engine | `terminal-engine/src/lib.rs` |
| context | `core/context/src/index.ts` |
| prompt | `core/prompt/src/index.ts` |
| agent | `core/agent/src/index.ts` |
| coding-agent | `agent/coding-agent/src/index.ts` |
| hub | `core/hub/src/index.ts` |
| cli | `cli/src/index.tsx` |
| lsp-engine | `lsp-engine/src/index.ts` |
| opencli-engine | `opencli-engine/src/index.ts` |
| sqry-engine | `sqry-engine/src/index.ts` |

### 约定目录索引

「文件即 Agent」设计下的约定子目录（每个 agent 目录下可出现）：

| 目录 | 用途 |
|------|------|
| `instructions.md` / `SYSTEM.md` | agent 入口提示词 |
| `tools/` | 自动发现的 .ts 工具文件（defineTool） |
| `channels/` | defineChannel — IM/webhook 适配器 |
| `schedules/` | defineSchedule — cron 定时触发 |
| `subagents/` | 嵌套子 agent 定义 |
| `connections/` | MCP/OpenAPI 连接定义 |
| `skill/` | 技能资源 |
| `triggers/` | 事件触发器声明 |
| `OUTPUT.jsonc` | 结构化输出 schema |
| `PERMISSION.jsonc` | 工具白名单 |
| `agent.json` | agent 元数据（round_limit/tools/role） |
| `command/` | 自定义 /<name> 指令脚本 |

### 关键设计模式索引

| 模式 | 涉及包 | 简述 |
|------|--------|------|
| 双层设计（极简+可扩展） | agent | agentLoop() 极简 + IAgentLoop 接口 |
| 跨包契约（Like 接口） | types/agent/tools | SubagentExecutorLike / ToolLike / SubagentResultLike |
| 5 模式消息队列 | agent | after_task_complete / after_round_complete / after_loop_complete / interrupt_immediately / interrupt_stop |
| 双 Store 架构 | context | HarnessSessionStore + TaskSessionStore |
| 上下文压缩闭环 | context | sync → compress → toLLMHistory |
| 工具白名单 | tools/agent | PERMISSION.jsonc → toolWhitelist → toToolSchemas |
| 文件即 Agent | agent | 目录结构即定义（materializeAgent 物化） |
| 烘焙系统 | agent | BakeSystem 注入上下文块 |
| 角色卡系统 | agent | SillyTavern V2 兼容（CharacterCard/PersonaRegistry） |
| 隐身模式 | agent | StealthMode 工具名伪装 |

---

*本术语表由 SDK 全量扫描生成，作为开发参考与文档基础。新增术语请按字母顺序插入对应子节。*

