/**
 * sqry 二进制发现 + 子进程执行
 * 用 execFile（argv 数组）而非 exec，去掉手写 shell 引号，消除注入/引号 bug。
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

let cachedBinary: string | null | undefined;

function binNames(): string[] {
  return platform() === "win32" ? ["sqry.exe", "sqry"] : ["sqry"];
}

/** 查找 sqry 二进制路径（带缓存） */
export function findSqryBinary(): string | null {
  if (cachedBinary !== undefined) return cachedBinary;

  const home = homedir();
  const names = binNames();
  const dirs = [
    join(home, ".cargo", "bin"),
    join(home, ".maou", "bin"),
    join(home, ".local", "bin"),
    join(home, "bin"),
  ];
  // Windows cargo default
  if (platform() === "win32") {
    const up = process.env.USERPROFILE;
    if (up) dirs.push(join(up, ".cargo", "bin"));
  }

  const candidates: string[] = [];
  for (const d of dirs) {
    for (const n of names) candidates.push(join(d, n));
  }
  // PATH bare name
  candidates.push(...names);

  for (const c of candidates) {
    try {
      if (c === "sqry" || c === "sqry.exe") {
        execFileSync(c, ["--version"], { stdio: "ignore", timeout: 5000 });
        cachedBinary = c;
        return cachedBinary;
      } else if (existsSync(c)) {
        cachedBinary = c;
        return cachedBinary;
      }
    } catch {
      // 继续下一个候选
    }
  }

  cachedBinary = null;
  return null;
}

/** sqry 是否可用 */
export function isAvailable(): boolean {
  return findSqryBinary() !== null;
}

/** 二进制路径 */
export function binaryPath(): string | null {
  return findSqryBinary();
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** 执行 sqry 命令（execFile，无 shell） */
export function runSqry(args: string[], cwd: string, timeout = 30000): Promise<RunResult> {
  return new Promise((resolve) => {
    const bin = findSqryBinary();
    if (!bin) {
      resolve({
        stdout: "",
        stderr:
          "sqry 未安装。请运行: cargo install sqry  或将 sqry 放到 ~/.maou/bin（Windows: %USERPROFILE%\\.maou\\bin）",
        code: 1,
      });
      return;
    }

    execFile(bin, args, { cwd, timeout, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        code: err && !stdout ? 1 : 0,
      });
    });
  });
}
