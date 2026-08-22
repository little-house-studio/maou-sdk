/**
 * /term —— 列出与 WebUI 同一引擎的终端会话（不嵌 PTY）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getActiveBackend,
  initTerminalEngine,
  isHumanTerminal,
  resolveTerminalPersistPath,
} from "@little-house-studio/tools";
import { projectMaouRoot } from "../config/paths.js";

export type TermSlashArgs = {
  sub?: string;
  id?: string;
  cwd?: string;
};

function ensureEngine(cwd: string): void {
  try {
    initTerminalEngine(undefined, resolveTerminalPersistPath(cwd));
  } catch {
    /* 已初始化或无 persist */
  }
}

function allTerminals() {
  try {
    return getActiveBackend().list() ?? [];
  } catch {
    return [];
  }
}

function writeReport(cwd: string, name: string, body: string): string {
  const dir = projectMaouRoot(cwd);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, body.endsWith("\n") ? body : `${body}\n`, "utf8");
  return path;
}

export async function runTermSlash(args: TermSlashArgs): Promise<{
  toast: string;
  body: string;
  path?: string;
}> {
  const cwd = args.cwd ?? process.cwd();
  ensureEngine(cwd);
  const sub = (args.sub ?? "list").toLowerCase();
  const id = args.id?.trim();

  if (sub === "logs") {
    if (!id) return { toast: "用法: /term logs <id>", body: "用法: /term logs <id>" };
    const t = allTerminals().find((x) => x.id === id);
    if (!t) return { toast: `终端 ${id} 不存在`, body: `终端 ${id} 不存在` };
    const logs = await getActiveBackend().logs(id, t.agentName, 80);
    const body = `── ${id} (${t.kind ?? "agent"} ${t.state}) ──\n${logs || "（无输出）"}`;
    const path = writeReport(cwd, `term-logs-${id}.txt`, body);
    return { toast: `日志 ${id} → ${path}`, body, path };
  }

  if (sub === "stop") {
    if (!id) {
      return {
        toast: "用法: /term stop <id>",
        body: "用法: /term stop <id>（人壳须显式指定 id）",
      };
    }
    const t = allTerminals().find((x) => x.id === id);
    if (!t) return { toast: `终端 ${id} 不存在`, body: `终端 ${id} 不存在` };
    await getActiveBackend().stop(id, t.agentName);
    const body = `已停止 ${id}`;
    return { toast: body, body };
  }

  if (sub !== "list") {
    const body = "用法: /term [list] | /term logs <id> | /term stop <id>";
    return { toast: body, body };
  }

  const list = allTerminals();
  if (list.length === 0) {
    return { toast: "当前没有终端会话", body: "当前没有终端会话" };
  }
  const lines = list.map((t) => {
    const kind = isHumanTerminal(t) ? "human" : "agent";
    const exit = t.exitCode != null ? ` exit=${t.exitCode}` : "";
    return `${t.id}\t${kind}\t${t.state}${exit}\t${t.cwd}\t${t.agentName}`;
  });
  const body = ["id\tkind\tstate\tcwd\tagent", ...lines].join("\n");
  const path = writeReport(cwd, "term-sessions.txt", body);
  return { toast: `终端 ${list.length} 个 → ${path}`, body, path };
}
