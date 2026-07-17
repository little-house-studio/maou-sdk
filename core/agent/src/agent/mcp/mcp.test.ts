/**
 * MCP host/client 协议与工具桥测试。
 *
 * 使用官方 SDK InMemoryTransport + McpServer fixture，
 * 覆盖 initialize / tools / resources / prompts 与 ToolRegistry 集成。
 *
 * 跑：cd core/agent && pnpm test src/agent/mcp/mcp.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolRegistry } from "@little-house-studio/tools";
import type { ToolContext } from "@little-house-studio/tools";

import {
  McpSession,
  McpConnectionManager,
  McpToolExecutionError,
  namespacedMcpToolName,
  parseNamespacedMcpToolName,
  isNamespacedMcpToolName,
  sanitizeMcpSegment,
  mapListedToolToDescriptor,
  mapCallToolResultToToolResponse,
  flattenMcpContentToText,
  createMcpBridgeTool,
  createMcpProxyTools,
  createMcpProxyTool,
  parseMcpServersFile,
  discoverStandardMcpConnections,
  formatMcpCatalogPrompt,
  snapshotMcpCatalog,
  buildMcpCatalogPrompt,
} from "../../index.js";
import { defineMcpConnection, ConnectionRegistry } from "../define-connection.js";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── helpers ────────────────────────────────────────────────────────────────

function stubToolContext(): ToolContext {
  return {
    sessionId: "test",
    projectRoot: process.cwd(),
    promptRoot: process.cwd(),
    sandboxRoot: process.cwd(),
    sandboxMode: "off",
    agentName: "test",
    agentMode: "agent",
    pluginSettings: {},
    workingDir: process.cwd(),
  };
}

async function createFixturePair(connectionName = "fixture") {
  const server = new McpServer(
    { name: "maou-mcp-fixture", version: "1.0.0" },
    { capabilities: { logging: {} } },
  );

  server.registerTool(
    "echo",
    {
      description: "Echo back text",
      inputSchema: {
        text: z.string().describe("text to echo"),
      },
    },
    async ({ text }) => ({
      content: [{ type: "text" as const, text: `echo:${text}` }],
    }),
  );

  server.registerTool(
    "fail_soft",
    {
      description: "Tool execution error (isError)",
      inputSchema: {
        msg: z.string(),
      },
    },
    async ({ msg }) => ({
      content: [{ type: "text" as const, text: `soft-fail:${msg}` }],
      isError: true,
    }),
  );

  server.registerResource(
    "note",
    "fixture://note",
    {
      description: "Fixture note resource",
      mimeType: "text/plain",
    },
    async (uri) => ({
      contents: [
        {
          uri: String(uri),
          mimeType: "text/plain",
          text: "hello-resource",
        },
      ],
    }),
  );

  server.registerPrompt(
    "greet",
    {
      description: "Greeting prompt",
      argsSchema: {
        name: z.string(),
      },
    },
    async ({ name }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Hello, ${name}!`,
          },
        },
      ],
    }),
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const session = new McpSession({
    name: connectionName,
    description: "in-memory fixture",
    transportInstance: clientTransport,
    clientInfo: { name: "maou-mcp-test", version: "0.0.1" },
  });
  await session.connect();

  return {
    server,
    session,
    async close() {
      await session.disconnect().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}

// ── names / mappers ────────────────────────────────────────────────────────

describe("MCP names", () => {
  it("namespaces and parses tool names", () => {
    const name = namespacedMcpToolName("github", "search_repos");
    expect(name).toBe("mcp__github__search_repos");
    expect(isNamespacedMcpToolName(name)).toBe(true);
    expect(parseNamespacedMcpToolName(name)).toEqual({
      connectionName: "github",
      originalName: "search_repos",
    });
  });

  it("sanitizes unsafe segments", () => {
    expect(sanitizeMcpSegment("my server!")).toBe("my_server");
    const n = namespacedMcpToolName("a/b", "tool.name");
    expect(n).toBe("mcp__a_b__tool_name");
    expect(parseNamespacedMcpToolName(n)?.originalName).toBe("tool_name");
  });
});

describe("MCP mappers", () => {
  it("maps listed tool to descriptor", () => {
    const d = mapListedToolToDescriptor("conn1", {
      name: "do_thing",
      description: "Does a thing",
      inputSchema: {
        type: "object",
        properties: { x: { type: "number" } },
        required: ["x"],
      },
    });
    expect(d.name).toBe("mcp__conn1__do_thing");
    expect(d.originalName).toBe("do_thing");
    expect(d.connectionName).toBe("conn1");
    expect(d.parameters.type).toBe("object");
  });

  it("maps isError CallToolResult to ok:false", () => {
    const resp = mapCallToolResultToToolResponse(
      {
        content: [{ type: "text", text: "boom" }],
        isError: true,
      },
      { connectionName: "c", toolName: "t" },
    );
    expect(resp.ok).toBe(false);
    expect(resp.message).toContain("boom");
    expect(resp.payload.isError).toBe(true);
  });

  it("flattens multi content blocks", () => {
    const text = flattenMcpContentToText({
      content: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
    });
    expect(text).toBe("a\nb");
  });
});

// ── session protocol ops ───────────────────────────────────────────────────

describe("McpSession protocol ops (InMemory fixture)", () => {
  let pair: Awaited<ReturnType<typeof createFixturePair>>;

  beforeEach(async () => {
    pair = await createFixturePair("fixture");
  });

  afterEach(async () => {
    await pair.close();
  });

  it("initialize + server info", () => {
    expect(pair.session.connected).toBe(true);
    const ver = pair.session.getServerVersion();
    expect(ver?.name).toBe("maou-mcp-fixture");
    const caps = pair.session.getServerCapabilities();
    expect(caps?.tools).toBeTruthy();
  });

  it("tools/list", async () => {
    const tools = await pair.session.listTools({ force: true });
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain("echo");
    expect(names).toContain("fail_soft");
  });

  it("tools/call success", async () => {
    const result = await pair.session.callToolRaw("echo", { text: "hi" });
    expect(result.isError).toBeFalsy();
    expect(flattenMcpContentToText(result)).toBe("echo:hi");
  });

  it("tools/call isError path (not protocol throw)", async () => {
    const result = await pair.session.callToolRaw("fail_soft", { msg: "nope" });
    expect(result.isError).toBe(true);
    expect(flattenMcpContentToText(result)).toContain("soft-fail:nope");

    const resp = await pair.session.callToolAsResponse("fail_soft", { msg: "nope" });
    expect(resp.ok).toBe(false);
    expect(resp.payload.isError).toBe(true);
    expect(resp.payload.protocolError).toBeUndefined();
  });

  it("resources/list + resources/read", async () => {
    const resources = await pair.session.listResources();
    expect(resources.some((r) => r.uri === "fixture://note")).toBe(true);
    const read = await pair.session.readResource("fixture://note");
    expect(read.contents[0]?.text).toBe("hello-resource");
  });

  it("prompts/list + prompts/get", async () => {
    const prompts = await pair.session.listPrompts();
    expect(prompts.some((p) => p.name === "greet")).toBe(true);
    const got = await pair.session.getPrompt("greet", { name: "Ada" });
    expect(JSON.stringify(got.messages)).toContain("Hello, Ada!");
  });

  it("disconnect fail-closed", async () => {
    await pair.session.disconnect();
    expect(pair.session.connected).toBe(false);
    await expect(pair.session.listTools({ force: true })).rejects.toThrow(/not connected/);
  });
});

// ── tool bridge + manager ──────────────────────────────────────────────────

describe("MCP tool bridge + manager", () => {
  let manager: McpConnectionManager;
  let server: McpServer | null = null;

  afterEach(async () => {
    await manager?.disconnectAll().catch(() => {});
    await server?.close().catch(() => {});
    server = null;
  });

  it("registers namespaced tools and invokes via ToolRegistry", async () => {
    server = new McpServer({ name: "bridge-fixture", version: "1.0.0" });
    server.registerTool(
      "echo",
      {
        description: "Echo",
        inputSchema: { text: z.string() },
      },
      async ({ text }) => ({ content: [{ type: "text" as const, text: `echo:${text}` }] }),
    );
    server.registerTool(
      "fail_soft",
      {
        description: "Fail",
        inputSchema: { msg: z.string() },
      },
      async ({ msg }) => ({
        content: [{ type: "text" as const, text: msg }],
        isError: true,
      }),
    );
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);

    manager = new McpConnectionManager();
    await manager.connect({
      name: "bridge",
      description: "bridge test",
      transportInstance: ct,
    });

    const registry = new ToolRegistry();
    // flat mode（默认）：每个 MCP tool 一条 schema
    const names = manager.syncToRegistry(registry, "flat");
    expect(names).toContain("mcp__bridge__echo");
    expect(names).toContain("mcp__bridge__fail_soft");

    const echo = registry.get("mcp__bridge__echo");
    expect(echo).toBeTruthy();
    const okResult = await echo!.execute({ text: "world" }, stubToolContext());
    expect(okResult.ok).toBe(true);
    expect(okResult.message).toBe("echo:world");

    const fail = registry.get("mcp__bridge__fail_soft");
    const errResult = await fail!.execute({ msg: "x" }, stubToolContext());
    expect(errResult.ok).toBe(false);
    expect(errResult.message).toContain("x");

    // gateway mode：仅元工具 mcp
    const gwNames = manager.syncToRegistry(registry, "gateway");
    expect(gwNames).toEqual(["mcp"]);
    expect(registry.get("mcp__bridge__echo")).toBeUndefined();
    const gw = registry.get("mcp");
    expect(gw).toBeTruthy();
    const listOut = await gw!.execute({ action: "list" }, stubToolContext());
    expect(listOut.ok).toBe(true);
    expect(listOut.message).toContain("mcp__bridge__echo");
    const callOut = await gw!.execute(
      {
        action: "call",
        name: "mcp__bridge__echo",
        arguments: { text: "gw" },
      },
      stubToolContext(),
    );
    expect(callOut.ok).toBe(true);
    expect(callOut.message).toBe("echo:gw");
    // 切回 flat 供后续 proxy 测试
    manager.syncToRegistry(registry, "flat");

    // invoker path for subagent proxy: success returns text; isError throws McpToolExecutionError
    const invoker = manager.createInvoker();
    const text = await invoker("bridge", "echo", { text: "p" });
    expect(text).toBe("echo:p");
    await expect(invoker("bridge", "fail_soft", { msg: "e" })).rejects.toBeInstanceOf(
      McpToolExecutionError,
    );
    await expect(invoker("bridge", "fail_soft", { msg: "e" })).rejects.toThrow(/e/);

    // proxy tools reuse invoker
    const descs = manager.listDescriptors();
    const proxies = createMcpProxyTools(
      descs.map((descriptor) => ({ descriptor, invoker })),
    );
    expect(proxies.length).toBe(descs.length);
    const proxyEcho = proxies.find((t) => t.definition.name === "mcp__bridge__echo");
    const proxyOut = await proxyEcho!.execute({ text: "via-proxy" }, stubToolContext());
    expect(proxyOut.ok).toBe(true);
    expect(proxyOut.message).toBe("echo:via-proxy");

    // proxy isError → ok:false (not ok:true with "[isError] …")
    const proxyFail = proxies.find((t) => t.definition.name === "mcp__bridge__fail_soft");
    expect(proxyFail).toBeTruthy();
    const proxyErr = await proxyFail!.execute({ msg: "boom" }, stubToolContext());
    expect(proxyErr.ok).toBe(false);
    expect(proxyErr.message).toContain("boom");
    expect(proxyErr.message).not.toMatch(/^\[isError\]/);
    expect(proxyErr.payload.isError).toBe(true);
  });

  it("createMcpProxyTool maps legacy [isError] string prefix to ok:false", async () => {
    manager = new McpConnectionManager();
    const tool = createMcpProxyTool(
      {
        name: "mcp__legacy__t",
        description: "legacy",
        parameters: { type: "object", properties: {} },
        connectionName: "legacy",
        originalName: "t",
      },
      async () => "[isError] soft-fail body",
    );
    const resp = await tool.execute({}, stubToolContext());
    expect(resp.ok).toBe(false);
    expect(resp.message).toBe("soft-fail body");
    expect(resp.payload.isError).toBe(true);
  });

  it("createMcpBridgeTool maps protocol errors", async () => {
    manager = new McpConnectionManager();
    const tool = createMcpBridgeTool(
      {
        name: "mcp__x__y",
        description: "x",
        parameters: { type: "object", properties: {} },
        connectionName: "x",
        originalName: "y",
      },
      async () => {
        throw new Error("transport down");
      },
    );
    const resp = await tool.execute({}, stubToolContext());
    expect(resp.ok).toBe(false);
    expect(resp.payload.protocolError).toBe(true);
    expect(resp.message).toContain("transport down");
  });
});

// ── agent-switch lifecycle (shipped loadForAgent) ───────────────────────────

describe("McpConnectionManager agent switch lifecycle", () => {
  const roots: string[] = [];
  const servers: McpServer[] = [];
  let manager: McpConnectionManager;

  afterEach(async () => {
    await manager?.disconnectAll().catch(() => {});
    for (const s of servers) await s.close().catch(() => {});
    servers.length = 0;
    for (const r of roots) rmSync(r, { recursive: true, force: true });
    roots.length = 0;
  });

  async function spawnInMemoryServer(toolName: string, reply: string) {
    const server = new McpServer({ name: `srv-${toolName}`, version: "1.0.0" });
    server.registerTool(
      toolName,
      { description: toolName, inputSchema: { q: z.string().optional() } },
      async () => ({ content: [{ type: "text" as const, text: reply }] }),
    );
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    servers.push(server);
    return ct;
  }

  function writeAgentConnections(
    maouRoot: string,
    agentName: string,
    conns: Record<string, Record<string, unknown>>,
  ) {
    const dir = join(maouRoot, "agents", agentName, "connections");
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(conns)) {
      writeFileSync(join(dir, `${name}.json`), JSON.stringify(body), "utf-8");
    }
  }

  it("load agent A then B disconnects A sessions and tools (no leak)", async () => {
    const maouRoot = join(tmpdir(), `maou-mcp-switch-${Date.now()}`);
    roots.push(maouRoot);
    mkdirSync(maouRoot, { recursive: true });

    // Agent A / B configs only declare connection names; we inject transportInstance via connect
    // after load would fail without real command/url. Instead exercise loadForAgent switch
    // by connecting manually then calling loadForAgent with empty B (or use connect + agent switch API).
    // Honest path: connect sessions tagged under agent A via loadForAgent with transportInstance
    // is not in JSON — so we use connect() then loadForAgent which must disconnectAll on switch.

    manager = new McpConnectionManager();
    const registry = new ToolRegistry();

    // Simulate agent A connected
    const ctA = await spawnInMemoryServer("tool_a", "from-A");
    await manager.connect({
      name: "conn_a",
      description: "agent A only",
      transportInstance: ctA,
    });
    // Mark loaded as agent A without re-reading filesystem
    (manager as unknown as { loadedAgent: string | null }).loadedAgent = "agentA";
    manager.syncToRegistry(registry);
    expect(manager.sessionCount).toBe(1);
    expect(registry.get("mcp__conn_a__tool_a")).toBeTruthy();
    const aOut = await registry.get("mcp__conn_a__tool_a")!.execute({}, stubToolContext());
    expect(aOut.message).toBe("from-A");

    // Agent B has no connections on disk → loadForAgent must disconnectAll (agent switch)
    // includeIndustryPaths:false 避免本机 ~/.maou/mcp.json / Cursor 等污染测试
    writeAgentConnections(maouRoot, "agentB", {});
    const result = await manager.loadForAgent(maouRoot, "agentB", {
      includeIndustryPaths: false,
    });
    expect(result.discovered).toBe(0);
    expect(manager.sessionCount).toBe(0);
    expect(manager.listDescriptors()).toEqual([]);

    // Re-sync registry after switch: stale A tools must be gone
    manager.syncToRegistry(registry);
    expect(registry.get("mcp__conn_a__tool_a")).toBeUndefined();

    // Connect B and ensure A does not reappear
    const ctB = await spawnInMemoryServer("tool_b", "from-B");
    await manager.connect({
      name: "conn_b",
      description: "agent B only",
      transportInstance: ctB,
    });
    (manager as unknown as { loadedAgent: string | null }).loadedAgent = "agentB";
    manager.syncToRegistry(registry);
    expect(registry.get("mcp__conn_a__tool_a")).toBeUndefined();
    expect(registry.get("mcp__conn_b__tool_b")).toBeTruthy();

    // ensureLoadedForAgent short-circuits for same agent with sessions
    const ensured = await manager.ensureLoadedForAgent(maouRoot, "agentB");
    expect(ensured.ok).toBe(1);
    expect(manager.sessionCount).toBe(1);

    // Switch back to A (empty on disk) clears B
    writeAgentConnections(maouRoot, "agentA", {});
    await manager.loadForAgent(maouRoot, "agentA", { includeIndustryPaths: false });
    expect(manager.sessionCount).toBe(0);
    manager.syncToRegistry(registry);
    expect(registry.get("mcp__conn_b__tool_b")).toBeUndefined();
  });

  it("same-agent reload prunes connections removed from config", async () => {
    const maouRoot = join(tmpdir(), `maou-mcp-prune-${Date.now()}`);
    roots.push(maouRoot);

    manager = new McpConnectionManager();
    const ctKeep = await spawnInMemoryServer("keep", "keep-ok");
    const ctDrop = await spawnInMemoryServer("drop", "drop-ok");
    await manager.connect({ name: "keep", description: "keep", transportInstance: ctKeep });
    await manager.connect({ name: "drop", description: "drop", transportInstance: ctDrop });
    (manager as unknown as { loadedAgent: string | null }).loadedAgent = "coder";
    expect(manager.sessionCount).toBe(2);

    // Only "keep" remains enabled in config (use dummy command so JSON loads; connectAll will fail
    // for it — we only assert prune of "drop". Use transportInstance path instead:
    // loadForAgent with empty desired that only has keep name but fails connect is messy.
    // Direct unit of prune: call loadForAgent after writing only keep as disabled url so desiredNames={keep}
    // Actually desiredNames filters enabled !== false. Write keep with a bad command so connect fails
    // but name is desired; drop not listed → pruned.
    writeAgentConnections(maouRoot, "coder", {
      keep: {
        type: "mcp",
        description: "keep",
        // no real server — connect will fail; session already exists so connect() reconnects
        // Use a nonexistent command — will fail and remove? connect() disconnects existing first then fails.
        // So we'd lose keep. Better: write only keep with url that we won't re-connect successfully...
        // Simplest honest prune: desiredNames without "drop" by only listing keep, and for keep
        // re-pass via connect after prune by using transportInstance through connect not load.
        // loadForAgent will try connectAll which fails for fake stdio — that's ok for prune test:
        // we only need drop removed.
        command: "__maou_mcp_no_such_binary__",
        args: [],
        transport: "stdio",
        enabled: true,
      },
    });

    const beforeDrop = manager.getSession("drop");
    expect(beforeDrop).toBeTruthy();
    await manager.loadForAgent(maouRoot, "coder", { includeIndustryPaths: false });
    // drop pruned
    expect(manager.getSession("drop")).toBeUndefined();
    // keep may fail reconnect (fake command) — must not leave drop behind either way
    expect(manager.listDescriptors().some((d) => d.connectionName === "drop")).toBe(false);
  });
});

// ── defineConnection ───────────────────────────────────────────────────────

describe("defineMcpConnection + ConnectionRegistry", () => {
  it("defines stdio connection shape", () => {
    const factory = defineMcpConnection({
      description: "filesystem",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      transport: "stdio",
    });
    const conn = factory("fs");
    expect(conn.connectionType).toBe("mcp");
    expect(conn.command).toBe("npx");
    expect(conn.args?.[0]).toBe("-y");
    expect(conn.config.command).toBe("npx");
    expect(conn.url).toBeUndefined();
  });

  it("defines url connection", () => {
    const conn = defineMcpConnection({
      description: "remote",
      url: "https://example.com/mcp",
      transport: "streamable-http",
    })("remote");
    expect(conn.url).toContain("example.com");
    expect(conn.transport).toBe("streamable-http");
  });

  it("loads JSON connections from agent dir", async () => {
    const root = join(tmpdir(), `maou-mcp-reg-${Date.now()}`);
    const connDir = join(root, "agents", "coding", "connections");
    mkdirSync(connDir, { recursive: true });
    writeFileSync(
      join(connDir, "local.json"),
      JSON.stringify({
        type: "mcp",
        description: "local stdio",
        command: "node",
        args: ["server.js"],
        transport: "stdio",
        enabled: true,
      }),
      "utf-8",
    );
    writeFileSync(
      join(connDir, "remote.json"),
      JSON.stringify({
        type: "mcp",
        description: "remote",
        url: "http://127.0.0.1:9999/mcp",
        enabled: false,
      }),
      "utf-8",
    );

    try {
      const reg = new ConnectionRegistry(root);
      const n = await reg.loadForAgent("coding");
      expect(n).toBe(2);
      const local = reg.get("local");
      expect(local?.command).toBe("node");
      expect(local?.config.command).toBe("node");
      const remote = reg.get("remote");
      expect(remote?.enabled).toBe(false);
      expect(remote?.url).toContain("9999");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects connection without url or command", () => {
    expect(() =>
      defineMcpConnection({ description: "bad" })("bad"),
    ).toThrow(/url|command/);
  });
});

// ── 行业标准 mcpServers 发现 + catalog 提示词 ──────────────────────────────

describe("standard mcpServers discovery + catalog prompt", () => {
  it("parses Claude/Cursor-style mcpServers JSON", () => {
    const dir = join(tmpdir(), `maou-mcp-std-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const cfg = join(dir, "mcp.json");
    writeFileSync(
      cfg,
      JSON.stringify({
        mcpServers: {
          memory: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-memory"],
          },
          remote: {
            url: "https://example.com/mcp",
            type: "http",
            disabled: true,
          },
        },
      }),
      "utf-8",
    );
    try {
      const { connections, names } = parseMcpServersFile(cfg);
      expect(names.sort()).toEqual(["memory", "remote"]);
      const mem = connections.find((c) => c.name === "memory");
      expect(mem?.command).toBe("npx");
      expect(mem?.enabled).toBe(true);
      const rem = connections.find((c) => c.name === "remote");
      expect(rem?.url).toContain("example.com");
      expect(rem?.transport).toBe("streamable-http");
      expect(rem?.enabled).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("discoverStandardMcpConnections merges ~/.maou/mcp.json", () => {
    const maouRoot = join(tmpdir(), `maou-root-std-${Date.now()}`);
    mkdirSync(maouRoot, { recursive: true });
    writeFileSync(
      join(maouRoot, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          demo: {
            command: "node",
            args: ["server.js"],
            env: { FOO: "bar" },
          },
        },
      }),
      "utf-8",
    );
    try {
      const { connections, sources } = discoverStandardMcpConnections({
        maouRoot,
        includeIndustryPaths: false,
      });
      expect(sources.some((s) => s.path.endsWith("mcp.json"))).toBe(true);
      expect(connections.find((c) => c.name === "demo")?.args).toEqual(["server.js"]);
    } finally {
      rmSync(maouRoot, { recursive: true, force: true });
    }
  });

  it("builds catalog prompt from connected fixture (tools/list data)", async () => {
    const server = new McpServer({ name: "catalog-fixture", version: "1.0.0" });
    server.registerTool(
      "echo",
      { description: "Echo for catalog", inputSchema: { text: z.string() } },
      async ({ text }) => ({ content: [{ type: "text" as const, text }] }),
    );
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const manager = new McpConnectionManager();
    try {
      await manager.connect({
        name: "cat",
        description: "catalog test server",
        transportInstance: ct,
      });
      const prompt = await buildMcpCatalogPrompt(manager, { enrichLists: false });
      expect(prompt).toContain("<mcp_servers>");
      expect(prompt).toContain('name="cat"');
      expect(prompt).toContain("mcp__cat__echo");
      expect(prompt).toContain("Echo for catalog");
      expect(prompt).toContain("mcp__");

      const snap = snapshotMcpCatalog(manager);
      const formatted = formatMcpCatalogPrompt(snap);
      expect(formatted).toContain("mcp__cat__echo");
    } finally {
      await manager.disconnectAll().catch(() => {});
      await server.close().catch(() => {});
    }
  });

  it("loadForAgent picks up standard mcp.json + connects stdio fixture", async () => {
    const maouRoot = join(tmpdir(), `maou-load-std-${Date.now()}`);
    const fixture = join(
      // scripts next to package
      process.cwd(),
      "scripts/mcp-echo-fixture.mjs",
    );
    mkdirSync(join(maouRoot, "agents", "coding"), { recursive: true });
    writeFileSync(
      join(maouRoot, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          echo: {
            command: process.execPath,
            args: [fixture],
          },
        },
      }),
      "utf-8",
    );

    const manager = new McpConnectionManager();
    try {
      const result = await manager.loadForAgent(maouRoot, "coding", {
        includeIndustryPaths: false,
      });
      expect(result.discovered).toBeGreaterThanOrEqual(1);
      expect(result.ok).toBeGreaterThanOrEqual(1);
      const names = manager.listDescriptors().map((d) => d.name);
      expect(names).toContain("mcp__echo__echo");
      const catalog = await manager.buildCatalogPrompt({ enrichLists: true });
      expect(catalog).toContain("mcp__echo__echo");
      expect(catalog).toContain("<mcp_servers>");
    } finally {
      await manager.disconnectAll().catch(() => {});
      rmSync(maouRoot, { recursive: true, force: true });
    }
  });
});
