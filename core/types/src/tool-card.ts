/**
 * 工具卡预设：按名字换衣服。自定义工具可 register。
 */

export type ToolCardDress =
  | "read"
  | "edit"
  | "search"
  | "web"
  | "todo"
  | "terminal"
  | "generic";

export type ToolCardPreset = {
  id: string;
  match: { names?: string[]; prefix?: string };
  dress: ToolCardDress;
};

const extras: ToolCardPreset[] = [];

export const BUILTIN_TOOL_CARD_PRESETS: ToolCardPreset[] = [
  { id: "read", match: { names: ["read_file", "read_image", "reader"] }, dress: "read" },
  { id: "edit", match: { names: ["edit_file", "write_file", "create", "edit", "write", "patch"] }, dress: "edit" },
  { id: "search", match: { names: ["grep", "glob", "find_code"] }, dress: "search" },
  { id: "web", match: { names: ["web_fetch"], prefix: "web_" }, dress: "web" },
  { id: "todo", match: { names: ["task_manage", "task_finish", "todo_write", "todo_manage", "todo_finish"] }, dress: "todo" },
  { id: "terminal", match: { names: ["use_terminal", "bash", "powershell"] }, dress: "terminal" },
];

export function registerToolCardPreset(preset: ToolCardPreset): () => void {
  extras.unshift(preset);
  return () => {
    const i = extras.indexOf(preset);
    if (i >= 0) extras.splice(i, 1);
  };
}

export function listToolCardPresets(): ToolCardPreset[] {
  return [...extras, ...BUILTIN_TOOL_CARD_PRESETS];
}

export function resolveToolCardDress(name: string): ToolCardDress {
  const n = name.trim();
  for (const p of listToolCardPresets()) {
    if (p.match.names?.includes(n)) return p.dress;
    if (p.match.prefix && n.startsWith(p.match.prefix)) return p.dress;
  }
  return "generic";
}

export function resetToolCardPresetsForTest(): void {
  extras.length = 0;
}
