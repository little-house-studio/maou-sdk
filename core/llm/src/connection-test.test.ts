/**
 * connection-test unit: faux protocol 短路，不打真实 HTTP。
 */
import { describe, it, expect, afterEach } from "vitest";
import { testConnection } from "./connection-test.js";
import { clearFauxProviders, registerFauxProvider } from "./faux.js";

describe("testConnection", () => {
  afterEach(() => {
    clearFauxProviders();
  });

  it("returns ok + latency for faux preset", async () => {
    registerFauxProvider({
      model: "faux-model",
      responses: ["pong"],
    });
    const r = await testConnection(
      {
        name: "faux-test",
        url: "https://faux.local/v1",
        model: "faux-model",
        key: "sk-faux",
        protocol: "faux",
      },
      { timeoutMs: 5_000 },
    );
    expect(r.ok).toBe(true);
    expect(r.model).toBe("faux-model");
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(r.latencyMs).toBeLessThan(5_000);
    expect(r.replyPreview).toMatch(/pong/i);
  });

  it("fails fast when url missing", async () => {
    const r = await testConnection({
      name: "x",
      url: "",
      model: "m",
      key: "k",
      protocol: "openai",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/url/i);
    expect(r.latencyMs).toBe(0);
  });
});
