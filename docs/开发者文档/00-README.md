# Maou Agent SDK 开发者文档 — 总览

## 项目结构

```
maou-agent/
├── core/                  ← 核心 SDK（LLM → Tools → Context → Agent）
│   ├── llm/              # LLM 通信层
│   ├── tools/            # 工具系统
│   ├── context/          # 上下文层
│   ├── agent/            # Agent 运行时
│   └── common/           # 通用工具（配置、项目管理）
├── harness/              # Harness 层（完整 Agent 产品）
├── commands/             # 指令层（系统操作指令）
├── hub/                  # 多设备通信层
├── cli/                  # CLI 终端客户端
│   ├── index.ts          # TS 后端入口
│   └── gotui/            # Go Bubble Tea TUI
└── maou-ui/              # Web 前端
```

## 分层架构

```
LLM 层 → Tools 层 → Context 层 → Agent 层 → Harness 层
  └────────────── 每个层都可独立使用 ──────────────┘
```

每一层都暴露独立的 SDK，上层依赖下层：
- **LLM 层**：最底层 API 封装，可脱离 Agent 系统独立搭建 ChatGPT 级对话应用
- **工具层**：工具的注册、发现、执行管道
- **上下文层**：会话持久化、上下文压缩、记录存储
- **Agent 层**：Agent 管理、提示词编译、Token 追踪
- **Harness 层**：完整 Agent 运行时，组合所有核心层

## 章节导航

| 章节 | 文件 | 内容 |
|------|------|------|
| 总览 | `00-README.md` | 项目结构、分层架构、依赖关系 |
| LLM 层 | `01-LLM层.md` | ChatSession、PresetManager、LLMClient、ModelCaller |
| 工具层 | `02-工具层.md` | Tool 基类、ToolRegistry、ToolExecutor |
| 上下文层 | `03-上下文层.md` | SessionStore 会话持久化 |
| Agent 层 | `04-Agent层.md` | AgentRegistry、AgentFactory、PromptCompiler、TokenTracker |
| Harness 层 | `05-Harness层.md` | MaouHarness 运行时、MaouClient 客户端 |
| 通用工具 | `06-通用工具.md` | ConfigStore 配置管理、ProjectManager 项目管理 |
| Python SDK | `07-PythonSDK.md` | Python 客户端用法 |
| 快速开始 | `08-快速开始.md` | 最小对话、完整 Agent、自定义工具三个可运行示例 |
| 事件与配置 | `09-事件系统与配置.md` | 事件流、配置层级、协议、循环检测、安全 |