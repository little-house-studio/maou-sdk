/**
 * 项目 git 工作区摘要：porcelain + numstat。
 * 无 .git 或 git 失败时返回空。
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type GitFileStatus = {
  path: string;
  status: string;
  add: number;
  del: number;
};

export type GitStatusSummary = {
  files: GitFileStatus[];
  add: number;
  del: number;
};

function git(
  projectRoot: string,
  args: string[],
): string {
  return execFileSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 4000,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function parsePorcelain(text: string): Array<{ path: string; status: string }> {
  const out: Array<{ path: string; status: string }> = [];
  for (const line of text.split("\n")) {
    if (line.length < 4) continue;
    const status = line.slice(0, 2).trim() || "M";
    const rest = line.slice(3);
    const path = (rest.includes(" -> ") ? rest.split(" -> ").pop()! : rest)
      .replace(/\\/g, "/")
      .trim();
    if (path) out.push({ path, status });
  }
  return out;
}

function parseNumstat(text: string): Map<string, { add: number; del: number }> {
  const map = new Map<string, { add: number; del: number }>();
  for (const line of text.split("\n")) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    const add = m[1] === "-" ? 0 : Number(m[1]);
    const del = m[2] === "-" ? 0 : Number(m[2]);
    map.set(m[3]!.replace(/\\/g, "/"), { add, del });
  }
  return map;
}

export function readGitStatus(projectRoot: string): GitStatusSummary {
  if (!existsSync(join(projectRoot, ".git"))) {
    return { files: [], add: 0, del: 0 };
  }
  try {
    const porcelain = git(projectRoot, ["status", "--porcelain", "-uall"]);
    const numstat = git(projectRoot, ["diff", "--numstat", "HEAD"]);
    const stats = parseNumstat(numstat);
    const files = parsePorcelain(porcelain).map((f) => {
      const n = stats.get(f.path) ?? { add: 0, del: 0 };
      return { ...f, add: n.add, del: n.del };
    });
    let add = 0;
    let del = 0;
    for (const f of files) {
      add += f.add;
      del += f.del;
    }
    if (add === 0 && del === 0) {
      for (const n of stats.values()) {
        add += n.add;
        del += n.del;
      }
    }
    return { files, add, del };
  } catch {
    return { files: [], add: 0, del: 0 };
  }
}
