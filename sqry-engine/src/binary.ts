/**
 * sqry 二进制发现 + 子进程执行
 * 用 execFile（argv 数组）而非 exec，去掉手写 shell 引号，消除注入/引号 bug。
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

let cachedBinary: string | null | undefined;

/** 查找 sqry 二进制路径（带缓存） */
export function findSqryBinary(): string | null {
  if (cachedBinary !== undefined) return cachedBinary;

  const candidates = [
    join(process.env.HOME ?? "", ".cargo/bin/sqry"),
    join(process.env.HOME ?? "", ".maou/bin/sqry"),
    "sqry", // PATH
  ];

  for (const c of candidates) {
    try {
      if (c === "sqry") {
        // execFile 会搜索 PATH；先确认存在
        execFileSync("sqry", ["--version"], { stdio: "ignore" });
        cachedBinary = "sqry";
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
      resolve({ stdout: "", stderr: "sqry 未安装。请运行: cargo install sqry", code: 1 });
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
