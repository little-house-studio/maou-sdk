import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * 某 switch 对应的工作区：
 * - project:<path>:<name> → <path>
 * - system:ops → ~/.maou/ops（没有则 maouRoot）
 * - 其它 system → boot cwd
 */
export function resolveWorkspaceForSwitch(opts: {
  maouRoot: string;
  bootProjectRoot: string;
  kind: "system" | "project";
  agentName: string;
  projectPath: string | null;
}): string {
  if (opts.kind === "project" && opts.projectPath?.trim()) {
    return opts.projectPath.trim();
  }
  const name = (opts.agentName || "").trim();
  if (name === "ops") {
    const ops = join(opts.maouRoot, "ops");
    return existsSync(ops) ? ops : opts.maouRoot;
  }
  return opts.bootProjectRoot;
}
