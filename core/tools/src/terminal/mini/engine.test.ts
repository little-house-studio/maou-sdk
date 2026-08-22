import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MiniBackend } from "./engine.js";
import { MiniUnsupportedError } from "../backend.js";

describe("mini terminal backend", () => {
  let be: MiniBackend;

  afterEach(() => {
    be?.shutdown();
  });

  it("echo 跑通", async () => {
    be = new MiniBackend();
    const r = await be.run(
      "mini-echo",
      process.platform === "win32" ? "echo hello-mini" : "echo hello-mini",
      process.cwd(),
      "echo",
      8000,
      2000,
    );
    expect(r.exitCode).toBe(0);
    expect(r.output).toMatch(/hello-mini/);
    expect(r.terminalId).toBeTruthy();
  });

  it("超时停", async () => {
    be = new MiniBackend();
    const cmd = process.platform === "win32" ? "ping -n 20 127.0.0.1" : "sleep 20";
    const r = await be.run("mini-to", cmd, process.cwd(), "sleep", 250, 500);
    expect(r.exitCode).toBeNull();
    expect(r.error).toMatch(/超时/);
    const listed = be.list("mini-to");
    expect(listed[0]?.state).toBe("killed");
  });

  it("unix 杀进程组", async () => {
    if (process.platform === "win32") return;
    be = new MiniBackend();
    const r = await be.runBackground("mini-kg", "sleep 60", process.cwd(), "sleep");
    expect(r.exitCode).toBeNull();
    await be.stop(r.terminalId, "mini-kg");
    const listed = be.list("mini-kg");
    expect(listed[0]?.state).toBe("killed");
  });

  it("write / resize / openInteractive 抛不支持", async () => {
    be = new MiniBackend();
    await expect(be.write("x", "a", "z")).rejects.toBeInstanceOf(MiniUnsupportedError);
    await expect(be.resize!("x", 80, 24)).rejects.toBeInstanceOf(MiniUnsupportedError);
    await expect(be.openInteractive!({ agentName: "a", cwd: process.cwd() })).rejects.toBeInstanceOf(
      MiniUnsupportedError,
    );
  });

  it("持久化：落盘后新实例能读到 ring，running 变 interrupted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-mini-persist-"));
    const file = join(dir, "terminals.json");
    try {
      be = new MiniBackend();
      be.setPersistPath(file);
      const r = await be.run("mini-persist", "echo hello-persist", process.cwd(), "echo", 8000, 2000);
      expect(r.exitCode).toBe(0);
      const raw = JSON.parse(readFileSync(file, "utf8")) as Array<{
        id: string;
        state: string;
        agent_name: string;
        ring: string[];
      }>;
      const saved = raw.find((t) => t.id === r.terminalId);
      expect(saved?.state).toBe("exited");
      expect(saved?.agent_name).toBe("mini-persist");
      expect(saved?.ring.join("")).toMatch(/hello-persist/);

      be.shutdown();
      writeFileSync(file, JSON.stringify(raw, null, 2));

      const loaded = new MiniBackend();
      loaded.setPersistPath(file);
      const listed = loaded.list("mini-persist");
      expect(listed.some((t) => t.id === r.terminalId && t.state === "exited")).toBe(true);
      const logs = await loaded.logs(r.terminalId, "mini-persist", 50);
      expect(logs).toMatch(/hello-persist/);
      loaded.shutdown();

      writeFileSync(
        file,
        JSON.stringify([
          {
            id: "was-running",
            agent_name: "mini-persist-load",
            command: "sleep 99",
            description: "fixture",
            cwd: process.cwd(),
            state: "running",
            exit_code: null,
            created_at: "2026-08-17 00:00:00",
            updated_at: "2026-08-17 00:00:00",
            last_viewed_at: null,
            ring: ["still-here\n"],
          },
        ]),
        "utf8",
      );
      const recovered = new MiniBackend();
      recovered.setPersistPath(file);
      const rec = recovered.list("mini-persist-load")[0];
      expect(rec?.id).toBe("was-running");
      expect(rec?.state).toBe("interrupted");
      expect(await recovered.logs("was-running", "mini-persist-load", 20)).toMatch(/still-here/);
      recovered.shutdown();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("cleanupAgent 跳过 human_ 会话", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-mini-human-"));
    const file = join(dir, "terminals.json");
    try {
      be = new MiniBackend();
      be.setPersistPath(file);
      const r = await be.run("mini-clean", "echo agent-term", process.cwd(), "echo", 8000, 2000);
      const raw = JSON.parse(readFileSync(file, "utf8")) as Array<Record<string, unknown>>;
      raw.push({
        id: "human_keep",
        kind: "human",
        agent_name: "mini-clean",
        command: "",
        description: "interactive",
        cwd: process.cwd(),
        state: "running",
        exit_code: null,
        created_at: "2026-08-17 00:00:00",
        updated_at: "2026-08-17 00:00:00",
        last_viewed_at: null,
        ring: [],
      });
      be.shutdown();
      writeFileSync(file, JSON.stringify(raw), "utf8");
      const loaded = new MiniBackend();
      loaded.setPersistPath(file);
      loaded.cleanupAgent("mini-clean");
      const listed = loaded.list("mini-clean");
      expect(listed.some((t) => t.id === r.terminalId)).toBe(false);
      expect(listed.some((t) => t.id === "human_keep")).toBe(true);
      loaded.shutdown();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
