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
        - 返回到文件缓存区 / 上下文动态区【note】
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

双入口：上帝工具保留，同时按动词拆出独立工具（同一份实现）。

- `agent_team/` — Agent 团队
    - `god_tool/agent_team` ✅ — 领域统一入口
    - `agent_manage` ✅ — 团队管理上帝工具
    - `agent_message` ✅ — 子 Agent fork 上帝工具
    - `agent_send` ✅ — 派活 / 插话 / 中断 / 停止
- `browser/` — 浏览器
    - `god_tool/use_browser` ✅ — 控制真实浏览器
    - `browser_*` ✅ — 按 action 拆出的独立入口
- `sqry/` — 代码结构（sqry）
    - `find_code` ✅ — 结构搜索上帝工具
    - `find_*` ✅ — 按 action 拆出
- `lsp/` — 语言服务器
    - `lsp` ✅ — 语义分析上帝工具
    - `lsp_*` ✅ — 按 action 拆出
- `file/` — 文件操作
    - `write_file` ✅ — 创建或覆写文件
    - `edit_file` ✅ — 精确文本替换
- `board/` — 共享状态看板
    - `board` ✅ — 看板上帝工具
    - `board_*` ✅ — 按 action 拆出
- `internet/` — 网络搜索
    - `search_internet` ✅ — 搜索互联网
- `project/` — 项目管理
    - `god_tool/project` ✅ — 领域统一入口
    - `project_manage` ✅ — 项目管理上帝工具
    - `project_agent` ✅ — 项目代理上帝工具
    - `project_send` ✅ — 只派任务
- `reader/` — 读取
    - `god_tool/reader` ✅ — 读文件/网页/图片
    - `read_file` ✅ — 只读本地文本
    - `read_image` ✅ — 只读本地图片
    - `web_fetch` ✅ — 只读 http(s)
- `search/` — 文件搜索
    - `grep` ✅
    - `glob` ✅
- `skill/` — 技能
    - `god_tool/skill` ✅ — 领域统一入口
    - `use_skill` ✅
    - `search_skill` / `install_skill` ✅
    - `create_skill` ✅
- `todo/` — 会话待办
    - `todo_manage` ✅
    - `todo_create` / `todo_replace` / `todo_delete` / `todo_list` ✅
    - `todo_finish` ✅
- `terminal/` — 终端
    - `use_terminal` ✅ — 上帝工具
    - `terminal_write` / `terminal_list` / `terminal_stop` / `terminal_logs` / `terminal_rm` ✅

