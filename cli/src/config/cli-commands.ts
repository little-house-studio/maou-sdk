/**
 * CLI 指令注册表 —— 兼容出口。
 *
 * 真相源已迁至 `cli/src/slash/`：
 * - 结构体：`CliCommandSpec`
 * - 注册表：`cliCommands`（动态 register / 自动识别）
 * - 内置：`BUILTIN_CLI_COMMANDS` + `registerBuiltinCliCommands()`
 * - 解析：`dispatchSlash()`
 *
 * 本文件保持旧 import 路径，避免大范围改路径。
 */

export type {
  CliCommandSpec as CliCommandDef,
  CliCommandSpec,
  CommandScope,
  CommandCategory,
  CommandSource,
  CliCommandArgSpec,
  CliLocalAction,
  SlashItem,
  PaletteItem,
  ResolvedCliCommand,
} from "../slash/index.js";

export {
  cliCommands,
  CliCommandRegistry,
  CLI_COMMANDS,
  BUILTIN_CLI_COMMANDS,
  registerBuiltinCliCommands,
  getCommand,
  isLocalCommandId,
  commandOpensOverlay,
  localCommandIdSet,
  uiSlashCommands,
  runtimeSlashFallbacks,
  commandPaletteItems,
  helpKeyRows,
  listCliCommands,
  dispatchSlash,
  syncRuntimeCommands,
  syncSkillCommands,
  refreshDynamicCommands,
  splitSlashTokens,
} from "../slash/index.js";
