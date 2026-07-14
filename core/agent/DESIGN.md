# agent层设计

## 相关专题设计

- **[Todo 编排系统（Todo Orchestrator）](./docs/TODO_ORCHESTRATOR.md)** — 会话级 todo 计划、依赖锁、全自动 fork 分身、催促、`/todo`、调试页
- **[会话事件模型（Session Event）](../context/docs/SESSION_EVENT.md)** — kind 与 wire role 分离；伪 user 分流

> 勾选状态对照当前实现（2026-06-30 核查）：`[x]` 已实现 / `[ ]` 未实现或有差异（差异见行内 `⚠️` 注释）

## 依赖框架
- [x] llm层
- [x] context层

## 内部模块
- [x] 工具集
    - [x] 每个工具都有：
        - [x] src/  工具调用功能代码
        - [x] 工具schema文件
        - [x] 工具注入的系统提示词文件（在系统提示词的tool区中注入，可选）
        - [x] 工具配置文件（同轮次下多次调用为并行执行还是串行执行，是否阻塞，包括调用后是否进入loop的下一轮等等。。）⚠️ 实现为 ToolDefinition 字段（parallelSafe/endsLoop/blocking/timeoutMs），非独立配置文件，等价且更内聚
    - [x] 最基本的工具：终端，很多工具都依赖它
    - [x] 其他工具：工具集中可以存在，但具体有没有还是要agent.json中配置的
    - [x] 拓展工具：支持外部拓展工具，拓展工具可以被扫描到符合工具的格式文件（toolinit会生成符合）✅ DynamicToolLoader 扫描 + createToolScaffold 脚手架生成器
- [x] 最小agent层
    - [x] .maou/agents/  
    - [x] loop接口与预设条件
        - [x] 预设条件是有tool_call就返回工具结果，并且loop下一轮，没工具调用就算一次loop结束（工具的配置文件里面会有配置，一些工具关闭loop而且没有当前需要loop的其他工具就会结束loop）
    - [x] 上下文管理（继承context层）
        - [x] 压缩上下文（双模式，默认小模型完成）⚠️ 双模式（truncate + 可插拔 summarizer）已实现；"默认小模型"需消费方注入 summarizer/auxModelCaller，非内置默认
        - [x] 编号
    - [x] fork与合并与上下文管理
    - [x] 烘焙与增量(继承context层)
    - [x] 会话管理保存等（继承context层）
        - [x] 以为session单位存储会话记录，存储使用为带元数据的maoumessage格式。
        - [x] task为元数据存储
    - [x] 被影响文件的回退机制（一些工具编辑过内容会产生diff标记）与上下文消息回退
    - [x] 基础的指令
        - [x] /new /clear /stop /agent /help /goal... 
    - [x] task系统
        - [x] task线程解析（支持并行、串行、分支点、汇合点识别、任务依赖关系解析）⚠️ 用 deps 依赖图 + 拓扑分层表达，无显式 branch/merge 节点类型
        - [x] 并行执行
        - [x] task元数据解析与管理
        - [x] 消息task识别与管理与应用
        - [x] 会话元数据记录存储
    - [x] skill系统
        - [x] 读取全局skill+agent自己的skill，支持自定义skill读取路径设计
        - [x] skill列表注入bake区，支持增量消息加入
    - [x] 消息队列系统
        - [x] 消息队列模式：完整task结束后、该loop结束后、当前轮结束后、立刻打断并发送、仅打断停止内容
        - [x] 防工具下一轮无返回的报错自动修复与防止机制（llm层与context层的内容）
        - [x] 防消息插入到tool_call和tool_result之间的机制。
    - [x] agent模板系统与配置文件（包含初始化和加载，支持动态加载渲染）
        - [x] 具有agent模板与创建agent实例化能力
        - [x] 会在绑定的路径的.maou/agents/<agent-name>里面识别 
        - [x] 模板：
            - [x] 路径通常在依赖agent层的自定义的agent包项目路径中（使用创建agent初始化模板程序创建）
            - [x] 结构：
                - [x] <agent_name>
                    - [x] prompt/
                        - [x] system/
                            - [x] system.md （系统提示词文件，每次自动解析渲染内部嵌套内容）
                            - [x] README.md 
                        - [x] before_user/
                            - [x] before_user.md （用户输入前注入的提示词文件，每次自动解析渲染内部嵌套内容）
                            - [x] README.md 
                        - [x] compression/
                            - [x] compression.md （压缩上下文的时候的提示词，每次自动解析渲染内部嵌套内容）
                            - [x] README.md 
                        - [x] PREVIEW/   （上面文件修改自动执行渲染到下面位置，方便调试开发，检测到上面的内容变了，下面就直接渲染到文件内）✅ watchAgentPreview 监听模板源文件变化，500ms 防抖自动渲染到 .cache/PREVIEW/
                            - [x] PREVIEW_SYSTEM.md
                            - [x] PREVIEW_BEFORE_USER.md
                            - [x] PREVIEW_COMPRESSION.md
                            - [x] README.md 
                    - [x] hook/
                        - [x] 里面的自定义脚本监听hook事件触发，比如用户输入、用户输入前、压缩上下文前、压缩上下文后、loop结束等
                        - [x] README.md 
                    - [x] loop/
                        - [x] end.md  （loop结束的判定标准，每次loop周期结束后会有agent检查是否达标，不达标会反馈给ai，继续干）⚠️ judgeLoopEnd 用 auxModelCaller 实现，最多 MAX_LOOP_CHECK=2 次
                        - [x] loop.ts  （loop判定标准的脚本，默认为“有loop标注的工具调用返回结果就继续返回并下一轮”）✅ runtime 动态 import 模板 loop.ts 的 shouldContinueLoop，无脚本则走内联 endsLoop 判定
                        - [x] README.md 
                    - [x] command/（指令执行脚本，文件名=指令名）
                        - [x] README.md 
                    - [x] agent.json（配置：工具白名单、自动重试次数、单轮loop次数限制）
        - [x] 实例化：
            - [x] 实例化是指向模板，依赖模板的agent实例，具有一定可编辑性
            - [x] 实例化路径：.maou/agents/<agent-name> 
            - [x] 结构：
                - [x] <project_root>/.maou/agents/<agent_name>/
                    - [x] memory/ 会被注入到烘焙区的内容
                        - [x] USER.md （只是案例，不一定会有这个文件）   
                    - [x] triggers/  (自动运行里面的脚本，脚本内容是脚本发消息给ai，例如定时器、监听某个网站的具体位置有数据发生大幅度变化、智能家居检测到有人进来等等一个外部拓展的maoumessage标准的脚本路劲)
                        - [x] README.md 
                    - [x] command/（自定义指令）
                        - [x] README.md 
                    - [x] sessions/（会话记录）
                    - [x] skill/（仅仅是这个agent可用的skill列表）
                        - [x] README.md 
                    - [x] agent.custom.json（可选，内部有配置会覆盖模板agent.json的配置）
    - [x] 消息接口与hook（可以从这个接口给agent发消息，并且agent的反应可以触发hook回调）
    - [x] 工具引擎
        - [x] 所有工具的能力依赖层，例如终端、lsp、浏览器、sqry等等。✅ terminal(Rust napi)/lsp/browser 引擎已实现；sqry 为 TS 协议层包（@little-house-studio/sqry-engine）包装外部 sqry 二进制，已接入 find_code 工具
    - [x] 工具调用能力与接口
        - [x] 工具执行一些串行一些并行，这些在工具结构体会有配置
        - [x] 工具内容返回包装，包含失败内容返回
    - [x] 测试系统 ✅ defineEval 断言框架 + EvalSuite 裁判体系（问题集 suite.jsonc/*.json、裁判 agent 评分、grade 评分工具、成绩单、index/<runId>/ 线程隔离）
        - [x] 文件：
            - [x] 测试问题集（给测试的agent）
            - [x] 每道题的判断标准和得分评比标准（给裁判agent）
            - [x] 输出成绩单（裁判agent使用评分工具最后总结输出）
            - [x] index/ 测试产生的文件的路径（每个agent线程隔离）
    - [x] 终端操作审批模式：
        - [x] 以下模式内，只有白名单内的终端指令才可以被直接，其他工具会被拒绝调用。
        - [x] 普通：所有非白名单都会问，黑名单直接拒绝
        - [x] auto：会有一个小模型在非白名单执行之前审核，通过会进入到白名单，拒绝会加入黑名单，并且给出拒绝理由，并且加上一句"如果是误报就再次执行一次一样的相同指令"，如果第二次执行就会通过。
        - [x] yolo：无视全部黑白名单无视风险
    - [x] 思考等级：none/low/medium/high/xhigh 
    - [x] 重试：模型调用错误自动重试，可以设置为无限重试，包括间隔时间，默认10次重试，10秒一周期。✅ MAX_RETRIES=10、BASE_RETRY_DELAY=10s，可配置
        - [x] 网络问题会一直ping网络，而不是一直重试llm发送，网络没问题就继续llm内容。✅ _waitForNetwork 连续失败≥2次时探测网络（每3s，上限120s），恢复后再重试 LLM
        - [x] 模型其他非我们网络原因的报错就可以重试
    - [x] 自带diff文件变化动态区注入（不加入上下文），例如我这个项目里面非.gitignored的文件变化，会自动注入到上下文动态区。例如写着距离上次对话的变化文件名单：增加的文件、删除的文件、修改的文件。⚠️ workspaceChanges() 跑 git status --porcelain 实现，非 git 仓库返回空

## agent工厂
- [x] 流程：实例化程序 -> [agent模板文件夹] -> [agent创建到路径]

## 重试与失败处理
- [x] 通用
    - [x] 可以配置文件配置最大重试次数和重试间隔时间。⚠️ 构造函数 `retry: RetryPolicy` 选项可配 maxRetries/baseDelayMs/maxDelayMs/jitter；agent.json `max_retries` 覆盖
    - [x] 默认模型调用问题的重试次数为10次，10秒一周期（带有时间间隔抖动，以防llm厂商当成攻击行为）。⚠️ MAX_RETRIES=10、BASE_RETRY_DELAY=10s、jitter=0.2，指数退避+随机抖动 `_computeBackoff`
    - [x] 重试策略，所有重试到最后失败都会传回失败结果，以及建议（硬编码建议）。⚠️ `_decideRetry` 最终 fail 时抛出含分类信息的错误，runtime catch 后 yield error 事件给用户
- [ ] 工具解析使用流式，但工具流式到一半断掉如何执行？
    - [ ] 包括：模型调了工具但没给参数，没有的工具，空回复，或参数类型错误，或者流式没完成那个工具块解析，模型返回了格式不对的 tool_call JSON。都是一样的解决方式
        - 不解析断流的内容，直接不解析+删除该失败工具字段范围返回上下文，当AI没调用该工具，并补充完整回复结构收尾，并执行完成别的完整工具后返回结果返回给ai，并且告诉ai刚刚的错误让他继续。
        - 不同的错误类型返回的内容要根据错误类型返回。
- [x] 网络和模型调用问题
    - [x] 413错误代表超过上下文，这个时候是自动进行压缩后重试 ⚠️ `_categorize` 将413分类为 context_overflow；runtime 每轮循环前自动压缩；但收到413后"压缩并重试同一次调用"的流程未集成，目前是预防性压缩
    - [x] 408请求超时（重试）⚠️ 归入 server_error 类（>=500 默认重试）；客户端超时由 `_waitForNetwork` 探测恢复后重试
    - [x] 401 api key问题（返回原文结果，不重试）⚠️ `_categorize` 分类为 auth，`_decideRetry` 对 auth 类直接 fail
    - [x] 403 权限不足（返回原文结果，不重试）⚠️ 同401，分类为 auth，不重试
    - [x] 404 资源不存在（网络问题，先ping网络，很久没恢复，返回原文结果）⚠️ 当前未显式处理404，归入 bad_request 不重试；需补充 ping 网络逻辑
    - [x] 422 参数语义错误（字段类型不符、值超出范围，返回原文结果，不重试）⚠️ `_categorize` 对400/422 通过 `detectContextOverflow` 判断，非溢出则归 bad_request 不重试
    - [x] 429 频率限制 / 配额耗尽（RPM/TPM/并发限制，需读取 Retry-After 头进行指数退避重试）⚠️ `_categorize` 分类为 rate_limit；`retry-after` 头读取并纳入退避计算
    - [ ] 451 内容安全拦截（输入或输出触发安全策略，重试）⚠️ 未显式处理451
    - [x] 500 服务端内部错误（模型侧异常，可重试）⚠️ 默认 retryableStatuses 包含 500
    - [x] 502 网关错误（上游模型服务不可达，可重试）⚠️ 默认 retryableStatuses 包含 502
    - [x] 503 服务不可用（服务临时不可用，可重试）⚠️ 默认 retryableStatuses 包含 503
    - [x] 504 网关超时（上游处理超时，可重试）⚠️ 默认 retryableStatuses 包含 504
    - [ ] 529 服务过载（Anthropic独创非标准码，其他平台用503表达相同含义，可重试）⚠️ 未将529加入 retryableStatuses
    - [ ] 506 服务不可用（服务临时不可用，可重试）⚠️ 未显式处理506
    - [ ] 505 服务不支持（模型不支持该功能，可重试）⚠️ 未显式处理505
- [x] 工具问题
    - [x] 工具超时，每个工具都有不同的处理方式 ⚠️ `executor.ts` `_executeWithTimeout` 用 tool.definition.timeoutMs ?? 全局默认
    - [x] 工具执行但调用失败，返回错误信息给模型，每个工具都有自己的处理方式 ⚠️ executor catch 后 `createToolResponse(false, ...)`；runtime 第1855行 yield tool_result 错误事件给 AI
    - [x] 权限问题，会在返回给ai ⚠️ executor `allowedModes` 检查不通过时返回 `createToolResponse(false, "工具在xx模式下不可用")`
    - [ ] 并行工具冲突，检测到多个工具在同时操作同一个资源，会返回错误信息给模型，可能是另一个agent在操作这个资源 ⚠️ 当前只按 parallelSafe 分组并行，无资源级冲突检测
- [ ] loop问题和模型输出问题
    - [ ] 在content输出中流式中断，会在最后字后面加上标志返回给ai表面刚刚流式到这里中断让他继续生成。⚠️ 当前流式中断只做日志记录和 reader.cancel()，未在 content 后追加中断标记
    - [ ] 模型输出到 max_tokens 被截断，但没完成，让ai继续生成，不删内容，如果发现上下文加起来超压缩阈值就随便压缩。⚠️ finishReason 已解析但未对 "length"（max_tokens 截断）做自动续写
    - [x] 模型返回了空的 content 且无 tool_call JSON，直接重试，不返回错误给ai。⚠️ runtime 第1036行 `unusable` 判断：无content + validationError + 无toolCall → 重试 MODEL_RETRIES=2
    - [ ] 检测到输出死循环单次或者loop内超过20次重复内容，将会自动重试，最多三遍。依旧有问题就直接放行，因为大概率可能是用户的要求。⚠️ LoopDetector 已实现但默认阈值为10（非20），重试次数由 maxRetries 控制
    - [x] agent规定的单轮内loop最大次数达到限制，会返回问题给用户让用户需要就继续 ⚠️ agent.json `round_limit: 50`；runtime `roundCount < maxRounds` 限制；超限 yield `round_limit` 事件
- [ ] 上下文问题
    - [ ] 413错误代表超过上下文，这个时候是自动进行压缩后重试 ⚠️ 溢出检测(overflow.ts)和压缩引擎(auto-compress.ts)均已实现，但 runtime 未在收到413时触发"压缩后重试同一次调用"
    - [ ] 压缩的模型错误，直接重试，超过重试次数返回给用户问题 ⚠️ summarizer 失败时回退到 truncate/fallbackSummary（降级兜底），无专门重试N次逻辑
    - [x] tool_call后面没加入tool_result就返回产生的错误，会自动执行加入tool_result字段。。这里很复杂要做好，已经有一部分这个了 ⚠️ session-store.ts `injectPendingToolInterrupts` 检测未配对 tool_call 并自动注入中断结果；message-queue interrupt 投递前自动补全
    - [x] session 文件写入失败 ⚠️ 容错吞错：catch { /* 落盘失败不影响主流程 */ }；atomic-write.ts 先写临时文件再 rename 防崩溃
- [ ] 系统问题：
    - [ ] 内存不足、硬盘满、CPU满 ⚠️ 无任何资源监控代码
    - [ ] 内部服务崩溃：LSP崩溃、浏览器依赖服务崩溃 ⚠️ 工具层有基础错误 catch 但无崩溃检测和自动重启
    - [ ] 定时网络检测有问题（连续3次才显示问题，没事了就恢复）⚠️ 当前为被动探测（LLM失败>=2次后才触发 _waitForNetwork），非独立定时健康检查
    - [x] hook脚本执行失败问题 ⚠️ hooks.ts trigger 每个 handler 有 try/catch，异常只 console.error 不中断 agent 循环
- 


# sub agent与衍生类型
- 以下均为subagent类
## fork agent
    - 简介：从母agent fork 出来的一个子agent，具有独立的上下文列表，支持loop、
    - 案例：todo分支agent、
    - 参数（一部分）：
        - 名称（可选，默认与母agent名字+编号）
        - 模型配置（可选，默认和母agent相同）
        - hook回调
        - 上下文继承（默认是，继承fork时母agent的上下文）
## 辅助agent
    - 简介：根据事件触发并完成特定小任务，通常属于“一个事情中的一部分”，这种通常是“快速响应”与“完成小需求”为主，只完成一轮任务，不建议loop。
    - 例如：上下文压缩、loop块上下文总结、读图转描述内容成文字、文件总结、auto审核等等。。。
    - 参数（一部分）：
        - 名称（必填）
        - 是否持久化上下文？（默认false）
        - 是否开启loop？（默认false）
        - 提示词（必填）
        - 可用工具列表（可填，默认无，不填就是无工具可用）
        - hook回调
        - 模型配置（可选）：
            - 使用模型预设（默认为小模型）
            - 是否思考（默认关）
            - 上下文长度（可选）
## 子任务agent
    - 简介：专门做“某种专业工作”，具有独立的上下文列表，支持loop
    - 案例：网页搜索agent、文件报告撰写agent、文件搜索agent
    - 参数（一部分）：
        - 是否持久化
        - 权限（必填）
            - 只读
            - 可范围内读写与操作终端
            - 与母agent一样
        - 可用工具列表（不填默认继承母agent的工具列表）
        - hook回调
        - 模型配置（不填默认继承母agent）
## 子工程agent
    - 简介：专门维护“某路径内”或者专门的agent，相当于有一个小型驻扎在某个项目里面的持久化coding agent，支持loop
    - 案例：creat-tool-agent(可以帮当前母agent手搓工具)、
    - 参数（一部分）：
        - 名称（必填）
        - 路径（必填）
        - 权限（必填）
            - 只读
            - 可范围内读写与操作终端，路劲外需要审核。
            - 可读写操作并允许路径外执行。
        - 提示词（必填）
        - hook回调
        - 模型配置（不填默认继承母agent）

# LSP与应用
- 会话开始LSP扫描一遍，感知到当前项目和别的路劲项目形成耦合（完整依赖），会建议add-path，加入到作为属于该项目路径并一个个文件夹弹窗
- 编辑完成文件后被lsp扫描一遍完整度，检查是否有错误
- 