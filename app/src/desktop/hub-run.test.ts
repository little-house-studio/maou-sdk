import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { HUB_READY_LINE } from "./hub-ready.ts";
import { startHub } from "./hub-run.ts";

const hubMainTs = join(dirname(fileURLToPath(import.meta.url)), "hub-main.ts");

function getJson(socketPath: string, path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { socketPath, path, method: "GET", headers: { host: "maou-app" } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.from(c)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode ?? 0,
            body: text ? JSON.parse(text) : null,
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("hub-run", () => {
  it("serves /api/health on the socket and drops it after close", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-hub-run-"));
    const socketPath = join(dir, "app.sock");
    const hub = await startHub({
      socketPath,
      projectRoot: dir,
      sandboxMode: "yolo",
    });
    assert.equal(existsSync(socketPath), true);
    const health = await getJson(socketPath, "/api/health");
    assert.equal(health.status, 200);
    assert.equal((health.body as { service?: string }).service, "maou-app");
    await hub.close();
    assert.equal(existsSync(socketPath), false);
  });

  it("exits when the shell's stdin pipe closes (no orphan hub)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-hub-orphan-"));
    const socketPath = join(dir, "app.sock");
    const child = spawn(process.execPath, ["--import", "tsx", hubMainTs], {
      env: {
        ...process.env,
        MAOU_APP_SOCKET: socketPath,
        MAOU_PROJECT_ROOT: dir,
        MAOU_HUB_PARENT_STDIN: "1",
      },
      stdio: ["pipe", "pipe", "inherit"],
    });
    const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
    await new Promise<void>((resolve, reject) => {
      let buf = "";
      const timer = setTimeout(() => reject(new Error("hub-ready timeout")), 30_000);
      child.stdout!.on("data", (chunk) => {
        buf += String(chunk);
        if (buf.includes(HUB_READY_LINE)) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on("exit", () => reject(new Error("hub exited before ready")));
    });
    child.stdin!.end();
    const code = await Promise.race([
      exited,
      new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 10_000)),
    ]);
    if (code === "timeout") child.kill("SIGKILL");
    assert.equal(code, 0);
    assert.equal(existsSync(socketPath), false);
  });
});
