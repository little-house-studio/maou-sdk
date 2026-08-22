/**
 * Rust full 小集成：本机有新 .node 才跑，CI 无原生件则跳过。
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { resetTerminalBackendForTest } from "./resolve-backend.js";

const require = createRequire(import.meta.url);

function loadEngine(): {
  isNativeAvailable: boolean;
  hasResize?: boolean;
  hasOpenInteractive?: boolean;
  run: (
    agent: string,
    cmd: string,
    cwd: string,
    desc: string,
    timeout?: number,
    limit?: number,
  ) => Promise<{ ok: boolean; output: string; terminalId: string; exitCode: number | null }>;
  runBackground: (
    agent: string,
    cmd: string,
    cwd: string,
    desc: string,
    id?: string,
  ) => Promise<{ ok: boolean; terminalId: string; exitCode: number | null }>;
  write: (id: string, agent: string, data: string) => Promise<void>;
  stop: (id: string, agent: string) => Promise<void>;
  openInteractive?: (opts: {
    agentName: string;
    cwd: string;
    cols?: number;
    rows?: number;
    shell?: string;
  }) => string | Promise<string>;
  resize?: (id: string, cols: number, rows: number) => void;
  setPersistPath: (path: string) => void;
  list: (agent?: string) => Array<{
    id: string;
    state: string;
    agentName?: string;
    kind?: string;
  }>;
  logs: (id: string, agent: string, lines?: number) => Promise<string>;
  cleanupAgent: (agent: string) => void;
  remove: (id: string, agent: string) => Promise<void>;
} | null {
  try {
    const mod = require("@little-house-studio/terminal-engine");
    if (!mod?.isNativeAvailable) return null;
    return mod;
  } catch {
    return null;
  }
}

const engine = loadEngine();

const unix = process.platform !== "win32";

async function waitLogs(
  id: string,
  agentName: string,
  re: RegExp,
  ms = 5000,
): Promise<string> {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < ms) {
    last = await engine!.logs(id, agentName, 80);
    if (re.test(last)) return last;
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error(`timeout waiting ${re} in logs:\n${last}`);
}

describe.skipIf(!engine)("rust full backend (native)", () => {
  const agent = `full-native-${Date.now()}`;
  const temps: string[] = [];
  const live: Array<{ id: string; agent: string }> = [];

  afterEach(async () => {
    for (const t of live.splice(0)) {
      try {
        await engine?.stop(t.id, t.agent);
      } catch {
        /* ignore */
      }
    }
    try {
      engine?.cleanupAgent(agent);
    } catch {
      /* ignore */
    }
    resetTerminalBackendForTest();
    for (const d of temps.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* */
      }
    }
  });

  it("默认 PTY 能跑 echo", async () => {
    const r = await engine!.run(agent, "echo hello-full", process.cwd(), "echo", 8000, 2000);
    expect(r.output).toMatch(/hello-full/);
    expect(r.exitCode).toBe(0);
  });

  it("resize 在有符号时不抛", () => {
    if (!engine?.hasResize || typeof engine.resize !== "function") return;
    expect(() => engine.resize!("missing-id", 80, 24)).toThrow();
  });

  it("持久化：run 后落盘为 exited + ring，load 时 running→interrupted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-full-persist-"));
    temps.push(dir);
    const file = join(dir, "terminals.json");
    engine!.setPersistPath(file);

    const r = await engine!.run(agent, "echo hello-full-persist", process.cwd(), "echo", 8000, 2000);
    expect(r.exitCode).toBe(0);

    const raw = JSON.parse(readFileSync(file, "utf8")) as Array<{
      id: string;
      state: string;
      agent_name: string;
      ring: string[];
    }>;
    const saved = raw.find((t) => t.id === r.terminalId);
    expect(saved?.state).toBe("exited");
    expect(saved?.agent_name).toBe(agent);
    expect(saved?.ring.join("")).toMatch(/hello-full-persist/);

    const loadAgent = `${agent}-load`;
    const fixture = join(dir, "load.json");
    writeFileSync(
      fixture,
      JSON.stringify([
        {
          id: "full-was-running",
          agent_name: loadAgent,
          command: "sleep 99",
          description: "fixture",
          cwd: process.cwd(),
          state: "running",
          exit_code: null,
          created_at: "2026-08-17 00:00:00",
          updated_at: "2026-08-17 00:00:00",
          last_viewed_at: null,
          ring: ["hello-from-disk\n"],
        },
      ]),
      "utf8",
    );
    engine!.setPersistPath(fixture);
    const listed = engine!.list(loadAgent);
    const rec = listed.find((t) => t.id === "full-was-running");
    expect(rec?.state).toBe("interrupted");
    const logs = await engine!.logs("full-was-running", loadAgent, 20);
    expect(logs).toMatch(/hello-from-disk/);
    engine!.cleanupAgent(loadAgent);
  });

  it.skipIf(!engine?.hasOpenInteractive)("openInteractive 后 tty / TERM 为人壳", async () => {
    const id = await Promise.resolve(
      engine!.openInteractive!({ agentName: agent, cwd: process.cwd(), cols: 80, rows: 24 }),
    );
    live.push({ id, agent });
    expect(id.startsWith("human_")).toBe(true);
    if (!unix) return;
    await engine!.write(id, agent, "tty\n");
    await waitLogs(id, agent, /\/dev\/|not a tty/);
    const tty = await engine!.logs(id, agent, 40);
    expect(tty).toMatch(/\/dev\//);
    await engine!.write(id, agent, "echo TERM=$TERM\n");
    await waitLogs(id, agent, /TERM=xterm/);
  });

  it.skipIf(!engine?.hasOpenInteractive || !engine?.hasResize || !unix)(
    "活会话 resize 后再 stty size",
    async () => {
      const id = await Promise.resolve(
        engine!.openInteractive!({ agentName: agent, cwd: process.cwd(), cols: 80, rows: 24 }),
      );
      live.push({ id, agent });
      engine!.resize!(id, 100, 30);
      await new Promise((r) => setTimeout(r, 120));
      await engine!.write(id, agent, "stty size\n");
      await waitLogs(id, agent, /30\s+100/);
    },
  );

  it.skipIf(!engine?.hasOpenInteractive)("human_* 落盘 kind=human，新 persist 能 list", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-human-persist-"));
    temps.push(dir);
    const file = join(dir, "terminals.json");
    engine!.setPersistPath(file);
    const id = await Promise.resolve(
      engine!.openInteractive!({ agentName: agent, cwd: process.cwd(), cols: 80, rows: 24 }),
    );
    live.push({ id, agent });
    const raw = JSON.parse(readFileSync(file, "utf8")) as Array<{ id: string; kind?: string }>;
    expect(raw.find((t) => t.id === id)?.kind).toBe("human");

    const reloadAgent = `${agent}-human-load`;
    const fixture = join(dir, "human-load.json");
    writeFileSync(
      fixture,
      JSON.stringify([
        {
          id: "human_from_disk",
          kind: "human",
          agent_name: reloadAgent,
          command: "",
          description: "interactive",
          cwd: process.cwd(),
          state: "running",
          exit_code: null,
          created_at: "2026-08-17 00:00:00",
          updated_at: "2026-08-17 00:00:00",
          last_viewed_at: null,
          ring: ["human-disk\n"],
        },
      ]),
      "utf8",
    );
    engine!.setPersistPath(fixture);
    const rec = engine!.list(reloadAgent).find((t) => t.id === "human_from_disk");
    expect(rec?.kind).toBe("human");
    expect(rec?.state).toBe("interrupted");
    const logs = await engine!.logs("human_from_disk", reloadAgent, 20);
    expect(logs).toMatch(/human-disk/);
    engine!.cleanupAgent(reloadAgent);
    expect(engine!.list(reloadAgent).some((t) => t.id === "human_from_disk")).toBe(true);
    await engine!.remove("human_from_disk", reloadAgent);
  });

  it.skipIf(!engine?.hasOpenInteractive)("cleanupAgent 放过 human，清掉 Agent term", async () => {
    const hid = await Promise.resolve(
      engine!.openInteractive!({ agentName: agent, cwd: process.cwd(), cols: 80, rows: 24 }),
    );
    live.push({ id: hid, agent });
    const r = await engine!.run(agent, "echo bye-agent", process.cwd(), "echo", 8000, 2000);
    expect(r.exitCode).toBe(0);
    engine!.cleanupAgent(agent);
    const listed = engine!.list(agent);
    expect(listed.some((t) => t.id === hid)).toBe(true);
    expect(listed.some((t) => t.id === r.terminalId)).toBe(false);
  });

  it.skipIf(!unix)("人往 Agent PTY write 有回显", async () => {
    const bg = await engine!.runBackground(
      agent,
      "bash --noprofile --norc",
      process.cwd(),
      "agent-shell",
    );
    live.push({ id: bg.terminalId, agent });
    await new Promise((r) => setTimeout(r, 250));
    await engine!.write(bg.terminalId, agent, "echo xyz-echo\n");
    await waitLogs(bg.terminalId, agent, /xyz-echo/, 8000);
  }, 12_000);

  it.skipIf(!engine?.hasOpenInteractive || !unix)("人壳 jobs 能看到后台作业", async () => {
    const id = await Promise.resolve(
      engine!.openInteractive!({ agentName: agent, cwd: process.cwd(), cols: 80, rows: 24 }),
    );
    live.push({ id, agent });
    await engine!.write(id, agent, "sleep 5 &\n");
    await new Promise((r) => setTimeout(r, 200));
    await engine!.write(id, agent, "jobs\n");
    await waitLogs(id, agent, /sleep|Running|\[\d+\]/);
  });

  it.skipIf(!engine?.hasOpenInteractive || !unix)("test -t 0 / less+q 不挂死", async () => {
    const id = await Promise.resolve(
      engine!.openInteractive!({ agentName: agent, cwd: process.cwd(), cols: 80, rows: 24 }),
    );
    live.push({ id, agent });
    await engine!.write(id, agent, "test -t 0 && echo IS_TTY\n");
    await waitLogs(id, agent, /IS_TTY/);
    await engine!.write(id, agent, "less\n");
    await new Promise((r) => setTimeout(r, 200));
    await engine!.write(id, agent, "q");
    await new Promise((r) => setTimeout(r, 200));
    await engine!.write(id, agent, "echo after-less\n");
    await waitLogs(id, agent, /after-less/);
  });
});
