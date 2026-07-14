import { describe, expect, it } from "vitest";
import {
  looksLikeConfigTarget,
  resolveCliToken,
  resolveProduct,
  PRODUCT_ALIASES,
} from "./products.js";

describe("products registry", () => {
  it("resolves coding product", () => {
    const p = resolveProduct("coding");
    expect(p?.name).toBe("coding");
    expect(p?.productId).toBe("coding-agent");
  });

  it("aliases agent → coding", () => {
    expect(PRODUCT_ALIASES.agent).toBe("coding");
    expect(resolveProduct("agent")?.name).toBe("coding");
  });

  it("detects config paths", () => {
    expect(looksLikeConfigTarget("./foo")).toBe(true);
    expect(looksLikeConfigTarget("/abs/path")).toBe(true);
    expect(looksLikeConfigTarget("@little-house-studio/coding-agent/cli-config")).toBe(
      true,
    );
    expect(looksLikeConfigTarget("cli-config.ts")).toBe(true);
    expect(looksLikeConfigTarget("coding")).toBe(false);
    expect(looksLikeConfigTarget("agent")).toBe(false);
  });

  it("resolveCliToken routes correctly", () => {
    expect(resolveCliToken("setup").kind).toBe("system");
    expect(resolveCliToken("doctor").kind).toBe("system");
    expect(resolveCliToken("coding").kind).toBe("product");
    expect(resolveCliToken("agent").kind).toBe("product");
    expect(resolveCliToken("./my.ts").kind).toBe("config");
    expect(resolveCliToken("unknown-xyz").kind).toBe("unknown");
  });
});
