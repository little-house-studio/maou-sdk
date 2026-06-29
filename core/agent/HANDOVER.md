# Agent 模板系统重构 — 交接文档

> **✅ 已完成（commit 8756d90，2026-06-26）**
> 下文「未完成的工作」任务 1/2/3/5/6 全部接手完成；任务 4（factory）按文档建议保留旧逻辑（无模板直接创建模式，与引用模式并存）；任务 7（迁移现有实例）不自动迁移，旧模式仍兼容。
> 端到端实测：引用模式改模板即时生效（未覆盖字段），agent.custom.json 覆盖优先（符合设计）。

## 背景

将 Agent 实例化从「复制模式」(cpSync) 改为「引用模式」(.agent.ref)。

**核心问题**：之前 `createAgentFromTemplate` 用 `cpSync` 把模板目录完整复制到实例目录。改模板后实例不会更新，必须重新实例化。

**解决方案**：实例目录只存 `.agent.ref`（指向模板路径）+ `agent.custom.json`（用户覆盖项）+ 运行时数据。运行时读模板的 prompt/loop/hook 等文件，改模板即时生效。

## 已完成的工作

### 1. 新文件

- `core/agent/src/agent/template-ref.ts` — 共享工具函数 `getTemplateRef(agentDir)`
- `core/agent/src/agent/preview.ts` — `renderAgentPreview()` 从 preview.ts 独立出来，支持引用模式

### 2. 已修改文件

- `core/agent/src/agent/template.ts` — 完全重写：
  - `createAgentFromTemplate()` 不再 cpSync，改为写 `.agent.ref` + `agent.custom.json`
  - 新增 `resolvePromptRoot(agentDir)` — 返回 `{ promptRoot, entrypoint }`，处理 .agent.ref
  - 新增 `resolveAgentConfig(agentDir)` — 合并模板 agent.json + 实例 agent.custom.json
  - 保留旧导出兼容（re-export renderAgentPreview, getTemplateRef）

- `core/agent/src/agent/registry.ts` — 已修改：
  - `get()` — 支持 .agent.ref：有 .agent.ref 时用 resolveAgentConfig 合并配置
  - `get()` — 旧模式也合并 agent.custom.json 覆盖
  - `exists()` — .agent.ref 也算存在
  - `getPromptRoot()` — 有 .agent.ref 时用 resolvePromptRoot
  - `getPromptEntrypoint()` — 有 .agent.ref 时用 resolvePromptRoot

- `core/agent/DESIGN.md` — L47-94 已更新设计文档

### 3. 编译状态

`pnpm -r build` 全部通过，0 错误。

## 未完成的工作（需要接手）

### 任务 1：更新 `ensureProjectAgent()` in registry.ts

**文件**: `core/agent/src/agent/registry.ts`，约 L872-916

**当前状态**: `ensureProjectAgent()` 仍然用 `cpSync` 复制全局 agent 到项目级目录。

**需要改为**: 写 `.agent.ref` 指向全局 agent 目录，而不是 cpSync。

**改法**:
```
ensureProjectAgent() {
  // 幂等检查：已有 .agent.ref 或 agent.json → 跳过
  if (existsSync(join(projectDir, ".agent.ref"))) → 跳过
  if (existsSync(join(projectDir, AGENT_FILE))) → 跳过

  // 1. 全局同名 agent 存在 → 写 .agent.ref 指向全局目录
  const globalDir = join(this.agentsDir, name);
  if (existsSync(join(globalDir, AGENT_FILE)) || existsSync(join(globalDir, ".agent.ref"))) {
    writeFileSync(join(projectDir, ".agent.ref"), globalDir, "utf-8");
    // 写 agent.custom.json 设 working_dir
    writeFileSync(join(projectDir, "agent.custom.json"), 
      JSON.stringify({ working_dir: this.projectRoot }, null, 2), "utf-8");
    return { created: true, dir: projectDir, reason: "引用全局模板" };
  }

  // 2. 全局 name 不存在但 main 存在 → 引用 main
  if (name !== "main") {
    const mainDir = join(this.agentsDir, "main");
    if (existsSync(join(mainDir, AGENT_FILE)) || existsSync(join(mainDir, ".agent.ref"))) {
      writeFileSync(join(projectDir, ".agent.ref"), mainDir, "utf-8");
      writeFileSync(join(projectDir, "agent.custom.json"),
        JSON.stringify({ working_dir: this.projectRoot, display_name: name }, null, 2), "utf-8");
      return { created: true, dir: projectDir, reason: "引用全局 main 模板" };
    }
  }

  // 3. 都没有 → 用内置 DEFAULT_PROJECT_AGENT_TEMPLATE 写骨架（保留旧逻辑）
  this._writeProjectAgent(projectDir, name, DEFAULT_PROJECT_AGENT_TEMPLATE);
  return { created: true, dir: projectDir, reason: "内置默认模板" };
}
```

**可以删除**: `_materializeFromGlobal()` 方法（不再需要 cpSync）。
**保留**: `_writeProjectAgent()` 和 `DEFAULT_PROJECT_AGENT_TEMPLATE`（回退用）。

### 任务 2：更新 `runtime.ts` 的 PREVIEW 渲染调用

**文件**: `core/agent/src/agent/runtime.ts`，约 L568

**当前代码**:
```ts
try { if (agentPromptRoot) renderAgentPreview(join(agentPromptRoot, ".."), this.projectRoot); } catch { /* ... */ }
```

**问题**: `join(agentPromptRoot, "..")` 在引用模式下可能是模板目录而不是实例目录。应该传实例目录。

**改为**:
```ts
// agentDir 是实例目录（~/.maou/agents/<name> 或 <project>/.maou/agents/<name>）
const agentDir = this.agentDir ?? registry.agentDir(agentName);
try { renderAgentPreview(agentDir, this.projectRoot); } catch { /* ... */ }
```

需要确认 runtime.ts 能拿到 agentDir（实例目录路径）。如果拿不到，可以从 `registry.agentDir(agentName)` 获取（需要把 agentDir 方法改为 public 或加 getter）。

### 任务 3：更新 `index.ts` 导出

**文件**: `core/agent/src/agent/index.ts`

**当前**:
```ts
export { createAgentFromTemplate, renderAgentPreview } from "./template.js";
export type { CreateAgentOptions as CreateAgentFromTemplateOptions } from "./template.js";
```

**需要增加导出**:
```ts
export { createAgentFromTemplate, renderAgentPreview, resolvePromptRoot, resolveAgentConfig } from "./template.js";
export { getTemplateRef } from "./template-ref.js";
export type { CreateAgentOptions as CreateAgentFromTemplateOptions } from "./template.js";
```

### 任务 4：更新 `factory.ts` 适配引用模式

**文件**: `core/agent/src/agent/factory.ts`

**当前**: `AgentFactory.createAgent()` 用 `writeFileSync` 直接写 prompt/system/system.md 等文件到实例目录。这是旧的复制模式逻辑。

**需要改为**: 调用 `createAgentFromTemplate()` 来创建实例。factory 只负责参数组装，实际创建交给 template.ts。

或者更简单：保留 factory.ts 现有逻辑作为「无模板的直接创建」模式，和引用模式并存。factory 创建的是独立的 agent（没有 .agent.ref），所有文件都在实例目录里。

### 任务 5：更新 `_readGlobalAsTemplate()` in registry.ts

**文件**: `core/agent/src/agent/registry.ts`，约 L925-985

**当前**: 从全局 agent 目录读取 agent.json + prompt 内容作为 `ProjectAgentTemplate`。

**问题**: 如果全局 agent 是引用模式（有 .agent.ref），这个方法需要先读 .agent.ref 找到真正模板，再从模板读内容。

**改法**: 在方法开头加一行：
```ts
const templateDir = getTemplateRef(globalDir);
const actualDir = templateDir ?? globalDir;
// 后续用 actualDir 代替 globalDir 读取文件
```

### 任务 6：`loadAll()` 和 `scanConvention()` 支持 .agent.ref

**文件**: `core/agent/src/agent/registry.ts`，`loadAll()` 方法约 L272

**当前**: `loadAll()` 扫描 agents 目录，对每个子目录调用 `scanConvention()`。`scanConvention()` 只认 agent.json / agent.ts / instructions.md。

**需要**: `scanConvention()` 也认 `.agent.ref`。有 .agent.ref 时，读模板的 agent.json 作为基础配置。

**改法**: 在 `scanConvention()` 开头加：
```ts
const refPath = join(dir, ".agent.ref");
if (existsSync(refPath)) {
  const templateDir = getTemplateRef(dir);
  if (templateDir) {
    // 读模板的 agent.json
    const templateAgentJson = join(templateDir, "agent.json");
    if (existsSync(templateAgentJson)) {
      try {
        const data = JSON.parse(readFileSync(templateAgentJson, "utf-8"));
        // 合并 agent.custom.json 覆盖
        const config = resolveAgentConfig(dir);
        return { ...data, ...config, name: dirName, _source: source };
      } catch { /* fall through */ }
    }
  }
}
```

### 任务 7：迁移现有 agent 实例

**当前**: `~/.maou/agents/coding/` 和 `~/.maou/agents/main/` 是旧模式（完整复制了模板文件）。

**迁移方案**（可选，不紧急）:
1. 对每个旧模式 agent，检查是否有对应模板
2. 如果有，删除实例目录中的模板文件（prompt/、loop/、hook/、triggers/），写 .agent.ref
3. 保留实例目录中的运行时数据（sessions/、memory/、command/、skill/）
4. 把用户修改过的配置项写入 agent.custom.json

**不需要自动迁移**：旧模式仍然兼容（代码有 fallback），只是改模板不会即时生效。等用户主动重新实例化时自然切换到引用模式。

## 架构总结

```
模板层（只读，开发者维护）
templates/coding/
├── agent.json              ← 出厂配置
├── prompt/                 ← 提示词
│   ├── system/system.md
│   ├── before_user/before_user.md
│   └── compression/compression.md
├── loop/                   ← 行为逻辑
├── hook/                   ← 钩子
├── triggers/               ← 触发器
└── command/                ← 指令

实例层（引用模板 + 用户覆盖 + 运行时数据）
~/.maou/agents/coding/
├── .agent.ref              ← 指向模板路径（一行文本）
├── agent.custom.json       ← 用户覆盖项（round_limit, tools, terminal_mode 等）
├── command/                ← 用户自定义指令（实例独有）
├── skill/                  ← 用户自定义技能（实例独有）
├── memory/                 ← 运行时记忆
├── sessions/               ← 会话记录
└── .cache/PREVIEW/         ← 渲染产物（自动生成）
```

## 关键设计决策

1. **agent.json 不改名** — 保持兼容
2. **agent.custom.json** — 用户覆盖层，只写覆盖项
3. **.agent.ref** — 一行文本，指向模板目录的绝对路径
4. **旧模式兼容** — 没有 .agent.ref 的 agent 仍然正常工作
5. **resolvePromptRoot()** — 运行时解析：实例覆盖 > 模板 > 旧模式
6. **resolveAgentConfig()** — 运行时合并：模板 agent.json > 实例 agent.json > agent.custom.json
7. **ALLOWED_KEYS** — agent.custom.json 只能覆盖这些字段：
   - round_limit, max_retries, terminal_mode, thinking_level
   - role, display_name, reviewer_role, tools
   - tool_compression, verify_command, working_dir
   - system_append, system_override
   - tools_add, tools_remove

## 文件清单

| 文件 | 状态 | 说明 |
|------|------|------|
| `template-ref.ts` | ✅ 新建完成 | getTemplateRef() |
| `preview.ts` | ✅ 新建完成 | renderAgentPreview() |
| `template.ts` | ✅ 重写完成 | createAgentFromTemplate, resolvePromptRoot, resolveAgentConfig |
| `registry.ts` | ⚠️ 部分完成 | get/exists/getPromptRoot/getPromptEntrypoint 已改；ensureProjectAgent/loadAll/scanConvention/_readGlobalAsTemplate 未改 |
| `runtime.ts` | ❌ 未改 | PREVIEW 渲染调用需要改 |
| `index.ts` | ❌ 未改 | 需要增加导出 |
| `factory.ts` | ❌ 未改 | 可选，保留旧逻辑也行 |
| `DESIGN.md` | ✅ 已更新 | L47-94 |
