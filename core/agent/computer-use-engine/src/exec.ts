import { spawn } from "node:child_process";
import type { HelperEnvelope, HelperRequest } from "./types.js";
import { findHelperPath } from "./native.js";

export const HELPER_TIMEOUT_MS = 45_000;

export type HelperRunner = (req: HelperRequest, helperPath: string) => Promise<HelperEnvelope>;

let injected: HelperRunner | undefined;

export function setHelperRunnerForTest(runner?: HelperRunner): void {
  injected = runner;
}

export function hasHelperRunner(): boolean {
  return injected != null;
}

function parseEnvelope(text: string): HelperEnvelope {
  const raw = text.trim();
  if (!raw) return { ok: false, error: "helper 没有输出" };
  try {
    const parsed = JSON.parse(raw) as HelperEnvelope;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as HelperEnvelope;
      } catch {
        /* fallthrough */
      }
    }
  }
  return { ok: false, error: raw.slice(0, 400) };
}

export async function defaultHelperRunner(
  req: HelperRequest,
  helperPath: string,
  timeoutMs = HELPER_TIMEOUT_MS,
): Promise<HelperEnvelope> {
  return new Promise((resolve) => {
    const child = spawn(helperPath, ["--json"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, error: `helper 超时 ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      stdout += c;
    });
    child.stderr.on("data", (c: string) => {
      stderr += c;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (stdout.trim()) {
        resolve(parseEnvelope(stdout));
        return;
      }
      resolve({
        ok: false,
        error: stderr.trim() || `helper 退出码 ${code ?? "null"}`,
      });
    });
    child.stdin.write(`${JSON.stringify(req)}\n`);
    child.stdin.end();
  });
}

export async function runHelper(
  req: HelperRequest,
  opts?: { helperPath?: string; runner?: HelperRunner },
): Promise<HelperEnvelope> {
  const path = opts?.helperPath ?? findHelperPath();
  if (!path) return { ok: false, error: "helper-missing" };
  const runner = opts?.runner ?? injected ?? defaultHelperRunner;
  return runner(req, path);
}
