/**
 * App slash / 命令面板目录。名字与 CLI builtins 对齐，不依赖 cli 包。
 */

export type AppCommand = {
  name: string;
  label: string;
  description: string;
  aliases?: readonly string[];
  palette?: boolean;
  runtime?: boolean;
  /** App 输入栏 `/` 补全。未标的只走 CLI / + 面板。 */
  slash?: boolean;
};

export const APP_COMMANDS: readonly AppCommand[] = [
  { name: "new", label: "新对话", description: "新建会话", palette: true },
  {
    name: "fork",
    label: "派生会话",
    description: "复制当前会话上下文",
    palette: true,
  },
  { name: "clear", label: "清空会话", description: "清空当前会话消息" },
  {
    name: "export",
    label: "导出",
    description: "导出 transcript",
    palette: true,
  },
  { name: "stop", label: "停止", description: "停止当前生成", palette: true },
  {
    name: "model",
    label: "选择模型",
    description: "切换 provider/model",
    palette: true,
  },
  {
    name: "sessions",
    label: "切换会话",
    description: "列出或切换会话",
    palette: true,
  },
  {
    name: "approval",
    label: "审批模式",
    description: "normal / auto / yolo",
  },
  {
    name: "usage",
    label: "会话用量",
    description: "费用/时长/token",
    palette: true,
    aliases: ["cost"],
    slash: true,
  },
  {
    name: "analyze",
    label: "会话诊断",
    description: "诊断 token / cache",
    palette: true,
  },
  {
    name: "compact",
    label: "压缩上下文",
    description: "强制压缩上下文",
    runtime: true,
    slash: true,
  },
  {
    name: "context",
    label: "上下文占用",
    description: "占用与压缩阈值",
    runtime: true,
    slash: true,
  },
  {
    name: "init",
    label: "初始化项目",
    description: "扫描并写入 .maou/project/",
    palette: true,
    runtime: true,
    slash: true,
  },
  {
    name: "plan",
    label: "计划模式",
    description: "先调查并写计划",
    runtime: true,
    slash: true,
  },
  {
    name: "goal",
    label: "目标模式",
    description: "同会话长目标",
    runtime: true,
    slash: true,
  },
  {
    name: "ultragoal",
    label: "Ultra 目标",
    description: "多 agent 长目标",
    runtime: true,
    slash: true,
  },
  { name: "help", label: "帮助", description: "快捷键与指令", palette: true },
];

export function commandInSlash(cmd: AppCommand): boolean {
  return cmd.slash === true;
}

export const APP_SLASH_NAMES: readonly string[] = APP_COMMANDS.flatMap((c) => [
  c.name,
  ...(c.aliases ?? []),
]);

export function commandByName(
  name: string,
  catalog: readonly AppCommand[] = APP_COMMANDS,
): AppCommand | undefined {
  const n = name.toLowerCase();
  return catalog.find((c) => c.name === n || c.aliases?.includes(n));
}

/** 本地目录优先；runtime / skill 只补尚未出现的名字。 */
export function mergeCommandCatalog(
  extra: readonly AppCommand[] | undefined,
): AppCommand[] {
  const out: AppCommand[] = APP_COMMANDS.map((c) => ({ ...c }));
  const seen = new Set(
    out.flatMap((c) => [c.name, ...(c.aliases ?? [])].map((n) => n.toLowerCase())),
  );
  for (const raw of extra ?? []) {
    const name = raw.name.replace(/^\//, "").trim().toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const label = (raw.label?.trim() || raw.description?.trim() || name).replace(
      /^\//,
      "",
    );
    out.push({
      name,
      label,
      description: raw.description?.trim() || raw.name,
      aliases: raw.aliases,
      palette: raw.palette === true,
      runtime: raw.runtime ?? true,
      slash: raw.slash ?? true,
    });
  }
  return out;
}

/**
 * 开头空白去掉后若以 / 起头，返回从 / 之后到 cursor 的指令前缀。
 * 前缀里一旦出现空白，说明指令名已经写完，返回 null。
 */
export function slashPrefixAtCursor(
  value: string,
  cursor: number,
): string | null {
  const start = slashTokenStart(value, cursor);
  if (start == null) return null;
  return value.slice(start + 1, Math.max(0, cursor));
}

/** 当前斜杠指令的 `/` 下标；没有正在写的指令则 null。 */
export function slashTokenStart(value: string, cursor: number): number | null {
  const head = value.slice(0, Math.max(0, cursor));
  const lead = head.match(/^[\s\n\r]*/)?.[0].length ?? 0;
  const fromSlash = head.slice(lead);
  if (!fromSlash.startsWith("/")) return null;
  const token = fromSlash.slice(1);
  if (/[\s\n\r]/.test(token)) return null;
  return lead;
}

export function stripSlashToken(value: string, cursor: number): string {
  const head = value.slice(0, Math.max(0, cursor));
  const tail = value.slice(Math.max(0, cursor));
  const lead = head.match(/^[\s\n\r]*/)?.[0].length ?? 0;
  const fromSlash = head.slice(lead);
  if (!fromSlash.startsWith("/")) return value.replace(/^[\s\n\r]+/, "");
  return (fromSlash.replace(/^\/[^\s\n\r]*/, "") + tail).replace(/^[\s\n\r]+/, "");
}

export function composeCommandInput(
  block: string | null | undefined,
  rest: string,
): string {
  const body = rest.replace(/^[\s\n\r]+/, "");
  if (!block) return body;
  return body ? `/${block} ${body}` : `/${block}`;
}

export function filterCommandHits(
  prefix: string,
  catalog: readonly AppCommand[] = APP_COMMANDS,
  limit = 24,
  opts?: { surface?: "slash" | "all" },
): AppCommand[] {
  const q = prefix.toLowerCase();
  const surface = opts?.surface ?? "all";
  const out: AppCommand[] = [];
  const seen = new Set<string>();
  for (const c of catalog) {
    if (surface === "slash" && !commandInSlash(c)) continue;
    const names = [c.name, ...(c.aliases ?? [])];
    const hit =
      !q ||
      names.some((n) => n.toLowerCase().startsWith(q)) ||
      c.label.toLowerCase().includes(q);
    if (!hit || seen.has(c.name)) continue;
    seen.add(c.name);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

export function filterSlashHits(
  input: string,
  catalog: readonly AppCommand[] = APP_COMMANDS,
  limit = 24,
  cursor = input.length,
): string[] {
  const prefix = slashPrefixAtCursor(input, cursor);
  if (prefix == null) return [];
  return filterCommandHits(prefix, catalog, limit, { surface: "slash" }).map(
    (c) => c.name,
  );
}

export function filterPaletteHits(
  query: string,
  catalog: readonly AppCommand[] = APP_COMMANDS,
  limit = 12,
): AppCommand[] {
  const q = query.replace(/^\//, "").trim().toLowerCase();
  if (!q) return catalog.filter((c) => c.palette).slice(0, limit);
  return catalog
    .filter((c) =>
      [c.name, c.label, c.description, ...(c.aliases ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(q),
    )
    .slice(0, limit);
}

/** 光标前最后一个 @token；没有则 null。 */
export function mentionQuery(input: string): string | null {
  const m = input.match(/(?:^|[\s])@([^\s@]*)$/);
  return m ? m[1]! : null;
}

export function filterMentionHits(
  query: string,
  paths: readonly string[],
  limit = 8,
): string[] {
  const q = query.toLowerCase();
  return paths
    .filter((p) => !p.endsWith("/") && p.toLowerCase().includes(q))
    .slice(0, limit);
}

export function applyMentionPick(input: string, path: string): string {
  return input.replace(/@([^\s@]*)$/, `@${path} `);
}

export type OverlayKeyMods = {
  key: string;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
};

/** 补全面板打开时：Enter/Tab 应用高亮项，不发送。 */
export type OverlayKeyAction = "nav-down" | "nav-up" | "pick" | "close" | null;

export function overlayKeyAction(
  e: OverlayKeyMods,
  open: boolean,
  hitCount: number,
): OverlayKeyAction {
  if (!open || hitCount <= 0) return null;
  if (e.key === "ArrowDown") return "nav-down";
  if (e.key === "ArrowUp") return "nav-up";
  if (e.key === "Tab" && !e.shiftKey) return "pick";
  if (
    e.key === "Enter" &&
    !e.shiftKey &&
    !e.altKey &&
    !e.ctrlKey &&
    !e.metaKey
  ) {
    return "pick";
  }
  if (e.key === "Escape") return "close";
  return null;
}

/** 前缀没变就保住高亮；回写同一份 `/` 时不要把上下键结果清掉。 */
export function overlayIdxAfterPrefix(
  prev: string | null,
  next: string | null,
  idx: number,
): number {
  if (next == null) return 0;
  if (prev === next) return idx;
  return 0;
}
