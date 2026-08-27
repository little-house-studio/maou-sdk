import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createAppServer } from "./create-server.ts";

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

describe("app socket listen", () => {
  it("serves /api/health without a TCP port", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-app-sock-"));
    const socketPath = join(dir, "app.sock");
    const server = createAppServer({
      listen: { kind: "socket", path: socketPath },
      projectRoot: dir,
      sandboxMode: "yolo",
    });
    const started = await server.start();
    assert.equal(started.host, "ipc");
    assert.equal(started.port, 0);
    assert.equal(started.socketPath, socketPath);
    const health = await getJson(socketPath, "/api/health");
    assert.equal(health.status, 200);
    assert.equal((health.body as { service?: string }).service, "maou-app");
    await server.close();
  });

  it("does not serve a browser SPA at /", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-app-sock-"));
    const socketPath = join(dir, "app.sock");
    const server = createAppServer({
      listen: { kind: "socket", path: socketPath },
      projectRoot: dir,
      sandboxMode: "yolo",
    });
    await server.start();
    const root = await getJson(socketPath, "/");
    assert.equal(root.status, 404);
    assert.equal((root.body as { error?: string }).error, "desktop client only");
    await server.close();
  });

  it("createAppServer requires listen or host/port", () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-app-opts-"));
    assert.throws(
      () => createAppServer({ projectRoot: dir, sandboxMode: "yolo" }),
      /listen \(socket\) or host\/port/,
    );
  });
});
