/Users/mac/Documents/vscodeProject/maou-example# Prompt层

## 定位
- Prompt层是**纯解析器/编译器**，负责提示词相关的解析、合成、编译、渲染预览
    - 模板编译（PromptCompiler）：解析文件引用依赖、脚本执行、递归include
    - 角色卡系统（PersonaRegistry + CharacterCard）：解析路径下角色卡文件，按规范渲染成提示词
    - 渲染预览（可读预览 + 文件监听热重载）
    - 动态上下文模板编译（formatAgentStatus 等纯模板部分）
- **不负责**：
    - 不存放其他层的业务提示词内容（如压缩prompt模板属于context层）
    - 不调用LLM（prompt层是纯文本处理，不依赖llm层）
    - 不组装消息（context层职责）
    - 不驱动agent循环（agent层职责）
- 定位类比：prompt层是"编译器"，其他层是"使用编译器的业务代码"

## 依赖关系
- 依赖：`@little-house-studio/types`（基础类型）
- **不依赖llm层**：prompt层是纯文本处理，不调用LLM
- 被依赖：
    - `context`层依赖prompt层（buildMessages调compile、BakeFile调渲染）
    - `agent`层依赖prompt层（PromptCompiler、PersonaRegistry）
- 依赖关系图：
    ```
    types ← prompt ← context ← agent ← hub
    types ← llm ← agent
    types ← tools ← agent
    ```

## 模块结构
```
core/prompt/src/
  compiler/              ← 模板编译（从agent层迁入）
    prompt-compiler.ts       {{include}}递归 + {{>>script}}执行 + 缓存
    types.ts                 编译相关类型
  persona/               ← 角色卡系统（新建）
    types.ts                 CharacterCard / PersonaStats / PersonaScene
    registry.ts              PersonaRegistry: add/get/list/remove + 持久化
    compiler.ts              compilePersona: 角色卡 → prompt片段
    importer.ts              JSON导入导出（兼容SillyTavern格式）
  preview/               ← 渲染预览（新建）
    renderer.ts              可读预览（HTML/Markdown/终端高亮）
    watcher.ts               文件监听 + 自动重编译（类Vite HMR）
  dynamic/               ← 动态上下文模板（从agent层拆分）
    format-status.ts         formatAgentStatus纯模板部分
    types.ts                 PersonaStatusProvider接口（agent层注入）
  index.ts               ← Barrel exports
```
注：压缩prompt模板等业务提示词内容属于context层，不在prompt层。

## 模块详细设计

### 1. compiler/ 模板编译
- 从 `core/agent/src/agent/prompt-compiler.ts` 迁入
- 职能：
    - 递归解析 `{{file.md}}` 文件包含
    - 执行 `{{>>script.py}}` 脚本占位符
    - 剥离 `<description>` 注释块
    - 脚本执行两层缓存（进程内 + 文件，TTL 30分钟）
    - 循环引用检测
- API不变，只迁移位置：
    ```typescript
    export class PromptCompiler {
      constructor(options: PromptCompilerOptions)
      compile(entrypoint?: string): string
      configure(promptRoot: string, entrypoint: string): void
    }
    ```

### 2. persona/ 角色卡系统
- 类型定义（兼容SillyTavern字段 + 扩展）：
    ```typescript
    interface CharacterCard {
      // 基础
      name: string
      description: string          // 人设描述
      personality: string          // 性格
      scenario: string             // 场景
      first_mes: string            // 第一条消息
      alternate_greetings: string[]// 备选问候
      mes_example: string          // 对话示例
      // 扩展
      appearance?: string          // 外貌
      background?: string          // 背景
      relationships?: Relationship[] // 关系网
      tags?: string[]
      creator_notes?: string
      system_prompt?: string       // 附加system prompt
      post_history_instructions?: string // 历史后指令
      // 元数据
      spec?: string                // 卡片规范版本
      data?: Record<string, unknown> // 扩展字段
    }

    interface Relationship {
      target: string              // 目标角色名
      type: 'friend' | 'rival' | 'lover' | 'family' | 'neutral'
      affection: number           // -100 ~ 100
      description?: string
    }
    ```
- PersonaRegistry：
    - 持久化到 `~/.maou/personas/<name>/card.json`
    - 全局 + 项目级覆盖（同AgentRegistry机制）
    - add/get/list/remove/import/export
- compilePersona：
    - 把CharacterCard编译成system prompt片段
    - 与PromptCompiler协作（角色卡可引用模板文件）

### 3. preview/ 渲染预览
- renderer.ts：
    - 把编译后的prompt渲染成可读格式
    - 输出格式：`html` | `markdown` | `terminal`（带颜色高亮）
    - 标注include来源、脚本执行结果、变量注入位置
- watcher.ts：
    - 监听promptRoot目录文件变化
    - 自动重新编译并推送预览
    - 支持debounce（默认300ms）
    - 回调通知：`onRecompile(result: CompileResult)`

### 4. dynamic/ 动态上下文模板
- 从 `core/agent/src/dynamic-context.ts` 拆分
- format-status.ts：
    - formatAgentStatus的纯模板部分（不依赖AgentRegistry）
    - 接收状态数据，输出格式化文本
- types.ts：
    ```typescript
    export interface PersonaStatusProvider {
      getStatus(): PersonaStatus[]
    }
    export interface PersonaStatus {
      name: string
      role: string
      status: string
      team?: string
      // ...
    }
    ```
- agent层实现PersonaStatusProvider，注入给prompt层

## 与其他层的边界

### context层依赖prompt层
- buildMessages调用PromptCompiler编译system prompt
- BakeFile（留context层）调用prompt层的渲染能力
- **压缩prompt模板属于context层**（业务提示词内容，不放prompt层）

### agent层依赖prompt层
- AgentRuntime使用PromptCompiler
- AgentRegistry（留agent层）与PersonaRegistry（prompt层）协作
- compileDynamicContext的依赖部分留agent层，模板部分调prompt层

### BakeFile边界
- BakeFile整体留context层
- 文件监听 + diff计算 = context层职责
- 模板渲染 = 调用prompt层能力（通过接口注入）

### 业务提示词边界
- prompt层只提供"编译能力"，不提供"业务prompt内容"
- 压缩prompt、summarizer指令等 = context层自己管理
- 角色卡prompt、system prompt模板 = 由prompt层编译，但内容来源是文件系统

## 迁移清单
1. `core/agent/src/agent/prompt-compiler.ts` → `core/prompt/src/compiler/prompt-compiler.ts`
2. `core/agent/src/dynamic-context.ts` 拆分：
    - 纯模板部分 → `core/prompt/src/dynamic/format-status.ts`
    - 依赖AgentRegistry部分 → 留agent层
3. 新建 `core/prompt/src/persona/`（PersonaRegistry + CharacterCard）
4. 新建 `core/prompt/src/preview/`（渲染 + 监听）
5. 新建 `core/prompt/src/index.ts`（Barrel exports）
6. 新建 `core/prompt/package.json` + `tsconfig.json`
7. context层package.json新增prompt依赖
8. agent层package.json新增prompt依赖
9. agent层index.ts改为从prompt层re-export PromptCompiler

## 待确认
- 角色卡字段是否需要兼容SillyTavern V2/V3规范？
- preview的终端高亮是否用现成库（如chalk）还是自实现？
- watcher是否需要支持多promptRoot同时监听？
