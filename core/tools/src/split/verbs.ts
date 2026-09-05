/**
 * 从现有上帝工具拆出的独立动词入口。上帝工具本身仍注册、仍可用。
 */

import type { Tool } from "../base.js";
import { bindVerbs, type VerbSpec } from "./delegate.js";

export function terminalVerbSpecs(): VerbSpec[] {
  return [
    {
      name: "terminal_write",
      description: "向已有终端会话写入键盘输入。",
      inject: { action: "write" },
    },
    {
      name: "terminal_list",
      description: "列出终端会话。",
      inject: { action: "manage", manage_action: "list" },
      omit: ["action", "manage_action"],
    },
    {
      name: "terminal_stop",
      description: "停止终端任务。",
      inject: { action: "manage", manage_action: "stop" },
      omit: ["action", "manage_action"],
    },
    {
      name: "terminal_logs",
      description: "查看终端输出。",
      inject: { action: "manage", manage_action: "logs" },
      omit: ["action", "manage_action"],
    },
    {
      name: "terminal_rm",
      description: "删除终端会话。",
      inject: { action: "manage", manage_action: "rm" },
      omit: ["action", "manage_action"],
    },
  ];
}

export function findSkillVerbSpecs(): VerbSpec[] {
  return [
    {
      name: "search_skill",
      description: "在 skills.sh 上搜索 skill。",
      inject: { mode: "search" },
      omit: ["mode"],
    },
    {
      name: "install_skill",
      description: "从 skills.sh / GitHub 安装 skill 到当前 agent。",
      inject: { mode: "install" },
      omit: ["mode"],
    },
  ];
}

export function todoVerbSpecs(): VerbSpec[] {
  return [
    { name: "todo_create", description: "新建会话 todo 清单并自动调度。", inject: { action: "create" } },
    { name: "todo_replace", description: "在无执行中任务时整表替换 todo 清单。", inject: { action: "replace" } },
    { name: "todo_delete", description: "归档并清空会话 todo 清单。", inject: { action: "delete" } },
    { name: "todo_list", description: "只读列出当前会话 todo 清单。", inject: { action: "list" } },
  ];
}

export function boardVerbSpecs(): VerbSpec[] {
  return [
    { name: "board_list", description: "列出看板条目。", inject: { action: "list" } },
    { name: "board_get", description: "读取看板条目。", inject: { action: "get" } },
    { name: "board_add", description: "新增看板条目。", inject: { action: "add" } },
    { name: "board_replace", description: "覆盖或新建看板条目。", inject: { action: "replace" } },
    { name: "board_edit", description: "局部修改看板条目。", inject: { action: "edit" } },
    { name: "board_del", description: "删除看板条目。", inject: { action: "del" } },
  ];
}

export function findCodeVerbSpecs(): VerbSpec[] {
  const labels: Record<string, string> = {
    search: "按名搜索代码符号",
    callers: "查找谁调用了该符号",
    callees: "查找该符号调用了谁",
    path: "查找两符号之间的调用链",
    cycles: "查找循环依赖",
    unused: "查找死代码",
    impact: "查看修改影响范围",
    explain: "解释符号上下文",
    hierarchy: "查看调用层级",
    duplicates: "查找重复代码",
    subgraph: "查看局部代码图",
  };
  return Object.entries(labels).map(([action, description]) => ({
    name: `find_${action}`,
    description,
    inject: { action },
  }));
}

export function lspVerbSpecs(): VerbSpec[] {
  const labels: Record<string, string> = {
    check: "用语言服务器检查诊断（可全工程）",
    diagnostics: "读取语言服务器诊断",
    definition: "跳转到定义",
    references: "查找引用",
    type_definition: "跳转到类型定义",
    hover: "查看类型签名与文档",
    rename: "重命名预览（不写盘）",
    completion: "代码补全",
    symbols: "列出文件符号",
    workspace_symbols: "全工程搜索符号",
  };
  return Object.entries(labels).map(([action, description]) => ({
    name: `lsp_${action}`,
    description,
    inject: { action },
  }));
}

export function computerVerbSpecs(): VerbSpec[] {
  const actions = [
    "snapshot",
    "click",
    "type",
    "press",
    "scroll",
    "hotkey",
    "set-value",
    "activate",
    "screenshot",
    "record",
    "apps",
    "windows",
    "permissions",
    "help",
  ];
  return actions.map((action) => ({
    name: `computer_${action.replace(/-/g, "_")}`,
    description: `桌面操作：${action}`,
    inject: { action },
  }));
}

export function browserVerbSpecs(): VerbSpec[] {
  const actions = [
    "open",
    "state",
    "click",
    "type",
    "fill",
    "select",
    "keys",
    "hover",
    "scroll",
    "check",
    "uncheck",
    "back",
    "wait",
    "extract",
    "network",
    "eval",
    "screenshot",
    "find",
    "get",
    "tab-list",
    "tab-new",
    "tab-select",
    "tab-close",
    "bind",
    "unbind",
    "close",
    "sessions",
    "batch",
    "multi",
    "watch",
    "run",
    "help",
    "console",
    "runtime_errors",
  ];
  return actions.map((action) => ({
    name: `browser_${action.replace(/-/g, "_")}`,
    description: `浏览器操作：${action}`,
    inject: { action },
  }));
}

export function bindDomainVerbs(gods: {
  terminal: Tool;
  findSkill: Tool;
  todo: Tool;
  board: Tool;
  findCode: Tool;
  lsp: Tool;
  browser: Tool;
  computer: Tool;
}): Tool[] {
  return [
    ...bindVerbs(gods.terminal, terminalVerbSpecs()),
    ...bindVerbs(gods.findSkill, findSkillVerbSpecs()),
    ...bindVerbs(gods.todo, todoVerbSpecs()),
    ...bindVerbs(gods.board, boardVerbSpecs()),
    ...bindVerbs(gods.findCode, findCodeVerbSpecs()),
    ...bindVerbs(gods.lsp, lspVerbSpecs()),
    ...bindVerbs(gods.browser, browserVerbSpecs()),
    ...bindVerbs(gods.computer, computerVerbSpecs()),
  ];
}
