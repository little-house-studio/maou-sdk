# context需求
## 上下文层结构
    - system prompt（下列内容都在role:system中）
        - 可注入system前区
        - System.md
        - 可注入system后区
    - 烘焙阶段（bakedStage）
        - 可增量注入
    - 概要阶段（summaryStage）
    - 压缩阶段（compactStage）
    - 原始上下文
    - Before_user区
    - 增量注入区
    - user消息区
- 需求：
    - 工具：注入系统提示词
        - 注入before_user
    - 文件锁定：
        - 系统提示词注入



## 上下文压缩算法
    - [嵌入结构区] ->不变区域，除非大变
        - 非烘焙阶段例如用户偏好，项目信息，环境信息，别的自定义嵌入文本信息
        - 烘焙阶段（bakedStage）：这里固定，活跃阶段（activeStage）会增量注入
    - [归档阶段（archiveStage）]->第二次大压缩直接剩下任务块摘要+ID了，需要原始记录就去读取
        - 剩下任务块极简摘要+ID路径+任务并行结构图了
    - [概要阶段（summaryStage）] -> 第一次大压缩，压缩后剩下过去去的任务摘要
        - 原数据：[事件id-b开始位置]{👨，消息群},{🤖,消息集群}{👨，消息群},{🤖,消息集群}[事件id-b结束位置]
        - 压缩后：[id-b开始～结束时间的：内容过程摘要]
    - [压缩阶段（compactStage）]-> 把标注微压缩的信息变摘要
        - ai当前回复的消息变摘要:
            - 原数据：{🤖,消息集群,microCompact=true,摘要}
            - 微压缩后：{🤖,摘要}
        - 上次工具结果摘要：
            - 不摘要
                - 原数据：{🛠,工具信息返回}{🤖，消息集群，上次工具不摘要（不压缩的意思）}
                - 微压缩后（不变化）：{🛠,工具信息返回}{🤖，消息集群，上次工具不摘要（不压缩的意思）}
            - 摘要
                - 原数据：{🛠,工具信息返回}{🤖，消息集群，上次工具摘要（微压缩的意思）}
                - 微压缩后：{🛠,摘要}{🤖，消息集群，上次工具摘要（微压缩的意思）}
        - 标注信息：
            - 用户消息具体标志：
                - 原消息：{{原始信息A段,不压缩},{原始信息B段,压缩内容（默认去掉）},{原始信息C段,不压缩}}
                - 微压缩后：{{原始信息A段+B段}}
    - [活跃阶段（activeStage）]-> 原始上下文区，保留所有原始消息，不进行任何压缩
        - 原数据：{👨,消息集群}{🤖,消息集群}{👨,消息集群}{🤖,消息集群}
        - 压缩后：{👨,消息集群}{🤖,消息集群}{👨,消息集群}{🤖,消息集群}

## 上下文增量
增量注入通过 `UserMessageOptions.dynamicInjections` 字段传入，由 `harness/runtime.ts` 在每轮 agent loop 调用 `buildMessages` 时填入。增量内容典型来源：看板状态、未决任务、活跃 agent 状态（`compileDynamicContext`）。


## 烘焙与增量
- **烘焙阶段**（bakedStage）：用户偏好、项目信息等长期不变的内容，由调用方通过 `UserMessageOptions.bakedContext` 注入。
- **活跃阶段**（activeStage）：每轮变化的状态，由 `compileDynamicContext` 生成。
- **静态阶段**（staticStage）：压缩算法中永不参与压缩的部分，包括 `system` 消息与 `pins` 消息。


## 消息结构体
- 原始排序：
    - post_raw_message[原始post发送出去的日志类结构体，帮助调试和查看原始消息]
    - llmMessage[llm层的消息结构体，比较接近原生llm的message结构体状态，目的是方便解析成llm层发送的post消息，以及方便不考虑压缩结构的上下文解析文件]
    - maouMessage[maou-agent的harness层的消息结构体，包含很多压缩优化标注，目的是灵活解析]
    - 降级关系：
        - harness层的agent使用的传入消息结构体默认为maouMessage，
        - maouMessage在harness层被解析为llmMessage消息结构体发给llm层，以及后续压缩后保存为历史task块时使用llmMessage消息结构体存储，
        - post原始数据用post_raw_message存储，保留方便快速解析与方便调试阅读

- 会话保存
    - 当前会话上下文区sessionMessage
        - 系统提示词+增量maouMessage结构体上下文
        - 保存两份sessionMessage：一份当前的上下文，一份压缩前的上一个上下文备份相当于[第一次大压缩时的harness上下文，已删除][第二次大压缩后上下文，压缩前保存的完整上下文][第三次大压缩后上下文：当前会话上下文]
        - 当前发送的上下文解析 -> 消息结构体存储用结构体sessionMessage -> 解析成：当前会话上下文
        - 可以回溯上下文工具，两个sessionMessage的作用就是如此，回溯上下文起码可以获得当时的maouMessage可以解析各种事情，不会被压缩摧毁。
            - 回溯上下文需要关键点，每次message都有一个id，通过id可以回溯到id点的上下文。
        -
    - 第一次压缩后的task块
        - 保存：agent/session/session_id/task_session/<task_id>.jsonl
        - 内容：任务ID,任务摘要简介,任务流程大纲，任务下所属的llmMessage上下文。
        - 第一次压缩时候就创建该id的task块，并且把压缩前完整内容解析写入到task_id.jsonl文件中
        - 第二次压缩的时候就要根据标注点增量更新task_session的llmMessage上下文和内部的任务摘要简介,任务流程大纲。
        - 写入时使用llmMessage消息结构体，不需要用maouMessage。因为maouMessage是maou-agent的harness层的消息结构体，包含很多压缩优化标注，目的是灵活解析没必要。
        - 而llmMessage是llm层的消息结构体，原生message结构体状态，目的是llm层发送post消息，以及方便上下文解析和缓存。
- [x] 任务块maouTaskBlock
    - 任务块ID（ai分配，上一次没有分配就延续，0号为普通对话，注入一次到任务开始上下文）
    - 父任务id（可选，用作嵌套，注入一次到任务开始上下文）
    - 任务摘要（任务目标的简介，注入一次到任务开始上下文）
    - 任务目标（任务的具体目标，注入一次到任务开始上下文）
    - 任务背景信息（任务的background，注入一次到任务开始上下文）
    - 任务经验（把经验记录下来，在before_user中动态显示）
    - 任务流程大纲（任务的流程大纲，不注入上下文只有在压缩到归档阶段（archiveStage）的时候才写，并且加入到任务块存储的元数据中）
    - 任务依赖的文件/网页列表元数据（不注入上下文，根据任务期间使用的工具pin下来的文件/网页列表，在加入到任务块存储的元数据时候加入）
        - 包含路径，引用片段。
    - 属于任务的上下文数组（下面就是全部任务内的记录，不记录子任务）
        - llmMessage结构体，包含seqId，解析后非保留到上下文的内容。

- [ ] 消息块maouMessage
    - 存储到当前结构会话上下文文件中，方便随时解析
    - 消息顺序seqId（系统分配，ai输出无需填写）
    - 所属任务id数组taskIds
    - 不存储
    - 消息maouContent
    - 微压缩配置
        - 是否微压缩（默认false）
        - 微压缩后变成的摘要信息/占位符（前提是「是」微压缩）
    - 消息分类
    - 案例：
        - 增量+用户消息
        - 飞书用户消息
        - 工具返回消息
        - ai调用工具消息

- 内容块maouContent
    - 文本内容text
    - 微压缩结构体（可选）
        - 是否微压缩（默认false）
        - 微压缩后变成的摘要信息/占位符（前提是「是」微压缩）
    - 是否换行break（默认false）
    - 是否进入上下文历史（默认true）

- 文本结构体
    - xml包裹文本：{xml标签，xml属性，内容}
    - base64文本：{文件相对/绝对路径，类型}
    - 文件转文本：{文件相对/绝对路径}


- 层级
    - 任务块maouTaskBlock
        - 消息块maouMessage -> 解析成：消息块
            - 内容块maouContent -> 解析成：消息块内的内容，多消息自动拼接。

- 需求：
    - 消息流程块压缩
    - 上下文大压缩
        -
    - 微压缩：
        - 压缩后的大纲
        - 微压缩开启
    - 消息分类：
        - 工具结果结构体
            - 摘要信息(下dui一轮)
        - ai工具消息
        - 多种压缩后消息（内部）
            - user案例：{role:"user",content:{},microCompact:{}}
                - 消息类型user，上下文（系统prefix内容微压缩设置为去掉），微压缩配置(是否微压缩，微压缩后变成的摘要信息/占位符)，任务信息（任务id（ai分配），父任务id数组，任务摘要），消息信息（消息编号（系统自动分配），消息摘要），
            - 原始消息：
            -

        - diff增量消息
            -diffFile 文件diff监听类
                - 结构体：
                    - const bakefile = new BakeFile(){tag:"config",path:"config.xml",hint:"项目配置文件",mode:"diff_placeholder"}
                - diffFile difffile
                - difffile.init：[xml名称，文件路劲（绝对或者相对都行），提示词，预设方案(仅监听，diff占位符，diff完整注入))]
                - difffile.hasChanges：文件距离上次commit是否有增量（函数）
                - difffile.commit：做上次diff的标记
                - difffile.read：读取文件完整内容（函数）
                - difffile.diff：返回文件diff内容，（函数）
                - difffile.path：获取文件路径（函数）
                - bake快速版
                    - difffile.bake() 相当于commit后返回完整文件内容，带xml。可以直接add到bakeblock
                    - difffile.update() 相当于返回本次diff内容后commit，带xml。可以直接add到before_user
            - bake傻瓜式简易版：
                - agent.bakeLink("xml","文件路劲", "提示词")     //后续自动会在压缩等情况下自动渲染，并且每次user发送时自动注入更新内容
                - 这个无需其他配置，直接用一条就可以完成烘焙文件绑定，相当于进行了下面的一套操作并自动add到bakeblock和before_user
                - 默认模式为链式diff，并且间隔参数为3，也就是每3条diff返回，就会返回一次完整文件内容
                - 可以通过setInterval函数来设置间隔参数

            - 案例：
                - 每次发送检查是否有更新：
                    - message.bakeblock.add(bakefile.read) //添加完整文件到烘焙阶段（bakedStage）
                    - bakefile.snapshot()//标记
                    - 过了很久。。。
                    - message.before_user.add(bakefile.getDiff(),history_back:true) //增量消息，返回文件变化内容到user前，并且会返回上下文中
                    - message.send() //发送完整消息
                    - bakefile.snapshot()//更新文件最新标记
                    - 简易版：
                        - const file = bake("xml","文件路劲", "提示词")     //后续自动会在压缩等情况下自动渲染，并且每次user自动注入更新内容


        - 烘焙消息
        - 用户消息
        - 系统消息
        - ai消息
        - 自定义结构体


## TypeScript 结构体定义

```typescript
// maouMessage — harness层消息结构体
interface maouMessage {
  role: string;
  name?: string;
  content: maouContent[];
  seqId: string;           // 系统分配的消息顺序id
  taskIds: string[];       // 所属任务id数组
  toolCallId?: string;     // 所属工具id
  toolCalls?: ToolCall[];  // 工具调用列表
  createdAt: number;       // 创建时间戳
  originalRole?: string;   // 压缩前的原始角色
  keepAfterCompress?: boolean; // 压缩后是否保留
}

// maouContent — 内容块
interface maouContent {
  text: string;            // 文本内容
  type?: string;           // 内容类型
  microCompact: boolean;   // 是否微压缩（默认false）
  summary?: string;        // 微压缩后的摘要信息/占位符
  tag?: string;            // 消息分类标签
  break: boolean;          // 是否换行（默认false）
}

// maouTaskBlock — 任务块
interface maouTaskBlock {
  taskId: string;          // 任务块ID（ai分配）
  parentId?: string;       // 父任务id
  summary: string;         // 任务摘要
  goal: string;            // 任务目标
  background: string;      // 任务背景信息
  experience?: string;     // 任务经验
  outline?: string;        // 任务流程大纲
  pins?: PinItem[];        // 任务依赖的文件/网页列表
  messages: llmMessage[];  // 属于任务的上下文数组
}

// llmMessage — llm层消息结构体
interface llmMessage {
  role: string;
  content: string | ContentPart[];
  toolCallId?: string;
  toolCalls?: ToolCall[];
}
```

- 案例
    - 上下文结构
        - {system,系统prompt}   //不变动的系统提示词
        - {user,烘焙的消息}   //烘焙阶段（bakedStage）
        - {user,压缩后的大纲}   //概要阶段（summaryStage）
        - {user,消息集群}   //压缩阶段（compactStage）
        - {user,消息集群}   //活跃阶段（activeStage）
    - 微压缩前
        - {system,系统prompt}   //不变动的系统提示词
        - {user,消息集群}   //简短用户消息
        - {ai,消息集群}   //简短ai消息
        - {user,消息集群}
        - {ai,消息集群}
        - {user,消息集群}
        - {ai,消息集群+调用工具}    //ai调用工具
        - {tool,工具信息返回}   //工具返回的长信息
        - {ai,消息集群+调用工具}    //ai调用工具（长度高需要压缩）
        - {tool,工具信息返回}   //工具返回的短信息（）
        - {ai,消息集群}     //ai结束回复（关键点）
        - {user,消息集群（工具补充）}

## SDK
