/**
 * 仓库根 AGENTS.md / CLAUDE.md：注入、去重、变更通知。
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const WORKSPACE_INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"] as const;

export type WorkspaceInstructionName = (typeof WORKSPACE_INSTRUCTION_FILES)[number];

export interface WorkspaceInstructionFile {
  name: WorkspaceInstructionName;
  path: string;
  content: string;
  hash: string;
  exists: boolean;
}

export interface WorkspaceInstructionBaseline {
  files: WorkspaceInstructionFile[];
  compiled: string;
}

export function resolveWorkspaceInstructionsEnabled(opts?: {
  agent?: boolean | null;
  user?: boolean | null;
  env?: string | null;
}): boolean {
  const env = (opts?.env ?? process.env.MAOU_WORKSPACE_INSTRUCTIONS ?? "").trim().toLowerCase();
  if (env === "0" || env === "false" || env === "off" || env === "none") return false;
  if (env === "1" || env === "true" || env === "on") return true;
  if (opts?.agent === false) return false;
  if (opts?.agent === true) return true;
  if (opts?.user === false) return false;
  if (opts?.user === true) return true;
  return true;
}

export function instructionContentHash(content: string): string {
  return createHash("sha1").update(content).digest("hex").slice(0, 16);
}

export function loadWorkspaceInstructionFiles(projectRoot: string): WorkspaceInstructionFile[] {
  const out: WorkspaceInstructionFile[] = [];
  for (const name of WORKSPACE_INSTRUCTION_FILES) {
    const filePath = join(projectRoot, name);
    if (!existsSync(filePath)) {
      out.push({ name, path: filePath, content: "", hash: "", exists: false });
      continue;
    }
    try {
      const st = statSync(filePath);
      if (!st.isFile()) {
        out.push({ name, path: filePath, content: "", hash: "", exists: false });
        continue;
      }
      const content = readFileSync(filePath, "utf-8").trim();
      out.push({
        name,
        path: filePath,
        content,
        hash: content ? instructionContentHash(content) : "",
        exists: Boolean(content),
      });
    } catch {
      out.push({ name, path: filePath, content: "", hash: "", exists: false });
    }
  }
  return out;
}

/** 内容相同只留一份（先出现的文件名）。 */
export function dedupeInstructionFiles(files: WorkspaceInstructionFile[]): WorkspaceInstructionFile[] {
  const seen = new Set<string>();
  const out: WorkspaceInstructionFile[] = [];
  for (const f of files) {
    if (!f.exists || !f.content) continue;
    if (seen.has(f.hash)) continue;
    seen.add(f.hash);
    out.push(f);
  }
  return out;
}

export function compileWorkspaceInstructions(
  projectRoot: string,
  opts?: { replaceBaseline?: boolean },
): string {
  const files = dedupeInstructionFiles(loadWorkspaceInstructionFiles(projectRoot));
  if (files.length === 0) return "";
  const parts: string[] = ["<workspace_instructions>"];
  if (opts?.replaceBaseline) {
    parts.push(
      "This complete workspace instruction baseline replaces all earlier workspace instruction baselines.",
    );
  } else {
    parts.push("以下是本仓库的相处说明。请遵守。");
  }
  parts.push("");
  for (const f of files) {
    parts.push(`<file name="${f.name}">`);
    parts.push(f.content);
    parts.push("</file>");
    parts.push("");
  }
  parts.push("</workspace_instructions>");
  return parts.join("\n");
}

export function instructionRelPaths(): string[] {
  return [...WORKSPACE_INSTRUCTION_FILES];
}

export function diffWorkspaceInstructions(
  prev: WorkspaceInstructionFile[],
  next: WorkspaceInstructionFile[],
): string {
  const prevBy = new Map(prev.map((f) => [f.name, f]));
  const lines: string[] = [];
  for (const cur of next) {
    const old = prevBy.get(cur.name);
    const had = Boolean(old?.exists && old.content);
    const has = Boolean(cur.exists && cur.content);
    if (had && !has) {
      lines.push(`Instructions removed: ${cur.name}`);
      lines.push("The previously loaded instructions from this file no longer apply.");
      continue;
    }
    if (!had && has) {
      lines.push(`Updated instructions from: ${cur.name}`);
      continue;
    }
    if (had && has && old && old.hash !== cur.hash) {
      lines.push(`Updated instructions from: ${cur.name}`);
    }
  }
  if (lines.length === 0) return "";
  return ["<workspace_instruction_notice>", ...lines, "</workspace_instruction_notice>"].join("\n");
}

export function snapshotWorkspaceInstructions(projectRoot: string): WorkspaceInstructionBaseline {
  const files = loadWorkspaceInstructionFiles(projectRoot);
  return {
    files,
    compiled: compileWorkspaceInstructions(projectRoot),
  };
}
