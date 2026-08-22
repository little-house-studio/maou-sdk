/**
 * 扩展快捷键注册表（对齐 Pi `registerShortcut`）。
 * TUI 把未占用的组合键发给 Node 后，先查这里再查内置 slash/UI 热键。
 */

export interface ShortcutHandlerCtx {
  key: string;
}

export interface RegisteredShortcut {
  key: string;
  description: string;
  handler: (ctx: ShortcutHandlerCtx) => void | Promise<void>;
}

const shortcuts = new Map<string, RegisteredShortcut>();

export function normalizeShortcutKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, "");
}

export function registerShortcut(
  key: string,
  options: { description: string; handler: RegisteredShortcut["handler"] },
): () => void {
  const k = normalizeShortcutKey(key);
  shortcuts.set(k, { key: k, description: options.description, handler: options.handler });
  return () => {
    if (shortcuts.get(k)?.handler === options.handler) shortcuts.delete(k);
  };
}

export function unregisterShortcut(key: string): void {
  shortcuts.delete(normalizeShortcutKey(key));
}

export function listShortcuts(): RegisteredShortcut[] {
  return [...shortcuts.values()];
}

export function resolveShortcut(key: string): RegisteredShortcut | undefined {
  return shortcuts.get(normalizeShortcutKey(key));
}

export function clearShortcuts(): void {
  shortcuts.clear();
}
