import { homedir } from "node:os";
import { join } from "node:path";

export interface AiinstallArgs {
  task: string;
  dir?: string;
  isNew: boolean;
  repair: boolean;
  help: boolean;
}

const HOSTED_REPO_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:github\.com|gitee\.com|gitlab\.com|bitbucket\.org|gitcode\.com)[/:]([^/\s]+)\/([^/\s?#]+)/i;

export function inferRepoName(task: string): string | undefined {
  const m = task.match(HOSTED_REPO_RE);
  if (!m) return undefined;
  return m[2]!.replace(/\.git$/i, "");
}

export function defaultInstallDir(task: string, cwd: string = process.cwd()): string {
  const name = inferRepoName(task);
  if (name) return join(homedir(), "Projects", name);
  return cwd;
}

export function parseAiinstallArgs(argv: string[]): AiinstallArgs {
  const taskParts: string[] = [];
  let dir: string | undefined;
  let isNew = false;
  let repair = false;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-h" || a === "--help") {
      help = true;
      continue;
    }
    if (a === "--new") {
      isNew = true;
      continue;
    }
    if (a === "--repair") {
      repair = true;
      continue;
    }
    if (a === "--dir") {
      dir = argv[++i];
      continue;
    }
    if (a.startsWith("--dir=")) {
      dir = a.slice("--dir=".length);
      continue;
    }
    if (a.startsWith("-")) continue;
    taskParts.push(a);
  }

  return {
    task: taskParts.join(" ").trim(),
    dir: dir?.trim() || undefined,
    isNew,
    repair,
    help,
  };
}
