# 工具需求
- 所有工具都尽可能使用sdk提供的功能实现
- 参数使用schema.json标准传入，sdk使用正确会自动识别
- ts为语言为推荐使用的实现语言，但允许混合使用
## 工具文件路径结构
- tools/
    - 工具名/
        - src/
        - schema.json  工具的schema文件，包含传入配置
        - tools.json  工具的配置文件
            - 被扫描到的名字，说明工具的功能，作者信息，项目地址，开源协议，依赖
            - 入口文件相对路径（可选，默认为src/index.ts）

## 白名单
- agent的配置文件agent.json里面有工具的白名单，只有在名单中的工具才会被传入tools里面
- 依赖：
    - LLM输出到执行器：agent层工具解码器接口 -> agent层的配置白名单过滤器 -> 工具层逻辑 
    - 白名单：agent工具白名单 -> 工具提示词+工具定义 -> agent工具定义列表+提示词注入
    - 工具执行器范围：工具层逻辑
        - 维护一个实例化的局部文本【note,board】
        - 返回数据作为user文本【计划模式，阅读】
        - 修改上下文标注【pin】
        - 返回到烘焙/增量【note】
        - 修改loop逻辑【等待用户输入、plan等等】
        - 管理agent
        - 操作应用【关闭】
        - 操作外部内容【浏览器、写文件、查找技能】
        - 分支
    - LOOP逻辑：工具调用后返回内容 -> LLM输入 ->
- 案例：
    - tools/skill/god_tools/skill/这个工具加载到白名单就是：`skill/god_tools/skill`
    - tools/skill/add_skill/这个工具加载到白名单就是：`skill/add_skill`

## 工具列表

- `agent_team/` — Agent 团队
    - `agent_manage` ⚠️ — 团队管理（禁用）
    - `agent_message` ⚠️ — 子Agent管理（禁用）
    - `god_tool/agent_team` 🚧 — 统一入口（占位）
- `browser/` — 浏览器
    - `god_tool/use_browser` ✅ — 控制真实浏览器，30+ 操作
- `code/` — 代码分析
    - `find_code` ✅ — 代码结构搜索（函数/类/调用关系）
- `file/` — 文件操作
    - `write_file` ✅ — 创建或覆写文件
    - `edit_file` ✅ — 精确文本替换
- `info/` — 状态存储
    - `board` ✅ — 共享状态看板（键值对，三作用域）
- `internet/` — 网络搜索
    - `search_internet` ✅ — 搜索互联网（四层降级）
- `project/` — 项目管理
    - `project_manage` ⚠️ — 项目管理（禁用）
    - `project_message` 🚧 — 发送消息给项目agent（占位）
    - `god_tool/project` 🚧 — 统一入口（占位）
- `reader/` — 读取
    - `god_tool/reader` ✅ — 读取文件/网页/图片
    - `read_file` 🚧 — 读取文件（占位，已被reader覆盖）
    - `read_web` 🚧 — 读取网页（占位，已被reader覆盖）
- `search/` — 文件搜索
    - `grep` ✅ — 正则搜索文件内容
    - `glob` ✅ — 按文件名模式查找
- `skill/` — 技能
    - `use_skill` ✅ — 加载 SKILL.md 技能
    - `add_skill` 🚧 — 创建/添加技能（占位）
    - `god_tool/skill` 🚧 — 统一入口（占位）
- `task/` — 任务调度
    - `task_manage` ✅ — 任务管理（依赖链自动推进）
    - `task_finish` ✅ — 汇报任务完成
    - `god_tool/task` 🚧 — 统一入口（占位）
- `terminal/` — 终端
    - `use_terminal` ✅ — 执行 shell 命令 / 管理常驻终端
    - `control_terminal` 🚧 — 控制终端操作（占位）
    - `god_tool/terminal` 🚧 — 统一入口（占位）

> ✅ 可用 13 | ⚠️ 禁用 3 | 🚧 占位 10


