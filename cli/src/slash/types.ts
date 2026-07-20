/**
 * CLI 斜杠指令结构体 —— 每条指令一份完整配置。
 *
 * 与 SDK `CommandDefinition` 对齐语义：
 * - name / description / usage
 * - 额外：aliases、scope、UI（palette/hotkey）、args、local 执行元数据
 *
 * 注册后由 `CliCommandRegistry` 统一解析；CLI 自动识别，不进 LLM（local）
 * 或透传 runtime（runtime/both 中的 agent 指令）。
 */

/** 执行归属 */
export type CommandScope = "local" | "runtime" | "both" | "skill";

export type CommandCategory =
  | "session"
  | "ui"
  | "debug"
  | "agent"
  | "system"
  | "skill";

/** 注册来源（便于调试 /help） */
export type CommandSource = "builtin" | "runtime" | "skill" | "dynamic";

/** 参数声明（帮助 / 校验 / 补全提示） */
export interface CliCommandArgSpec {
  name: string;
  description?: string;
  required?: boolean;
  /** 吞掉剩余 token 为一个参数 */
  rest?: boolean;
}

/**
 * 本地执行描述（不进 LLM）。
 * handler 名由 `cli-session` / store 映射到具体实现。
 */
export type CliLocalAction =
  | { kind: "overlay"; overlay: string }
  | {
      kind: "action";
      /**
       * 内置动作 id：
       * new_session | clear_session | quit | thinking_cycle |
       * screenshot | switch_model | stop | open_help_via_runtime |
       * analyze_session
       */
      action: string;
    };

/**
 * 一条指令的完整配置结构体。
 * 新增指令 = 写一份 spec +（可选）register()，CLI 自动补全/识别/帮助。
 */
export interface CliCommandSpec {
  /** 稳定 id（可与 name 相同；别名指令可共享 id 或独立） */
  id: string;
  /** 主指令名（不含 /） */
  name: string;
  /** 别名（不含 /），如 select → 与 model 同 handler */
  aliases?: readonly string[];
  /** 面板标题 */
  label: string;
  /** 简短描述 */
  description: string;
  /** 参数用法摘要，如 `<provider> <model>` */
  usage?: string;
  /** 帮助里展示的快捷键文案（Ctrl+M） */
  hotkey?: string;
  /**
   * 机器可读热键（ctrl+m），供 keybindings / Ratatui 热键分发。
   * 有此字段则自动注册到 listKeyBindings()。
   */
  hotkeyKey?: string;
  scope: CommandScope;
  category: CommandCategory;
  /** 默认 builtin；动态注入时改写 */
  source?: CommandSource;
  /** 出现在 Ctrl+K 命令面板 */
  palette?: boolean;
  /** 参数 schema */
  args?: readonly CliCommandArgSpec[];
  /**
   * local|both：CLI 侧如何处理。
   * runtime：仅透传 agent commandRegistry。
   * skill：当用户消息透传（技能触发）。
   */
  local?: CliLocalAction;
  /**
   * 是否在「未知指令」拦截时视为已登记（补全/识别）。
   * 默认 true；hidden 仅 alias 内部用。
   */
  hidden?: boolean;
}

/** 解析成功后的命中 */
export interface ResolvedCliCommand {
  spec: CliCommandSpec;
  /** 用户输入匹配到的 name 或 alias */
  matched: string;
  /** 指令名后的原始参数串 */
  args: string;
  /** 参数 token（空白 + \\0 拆分） */
  tokens: string[];
  rawInput: string;
}

export interface SlashItem {
  value: string;
  label: string;
  description?: string;
}

export interface PaletteItem {
  value: string;
  label: string;
  description?: string;
}
