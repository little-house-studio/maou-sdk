/**
 * Maou 产品注册表 —— `maou <product>` 路由。
 *
 * 约定：
 *   maou                 → 默认启动机器级 ops agent
 *   maou ops             → 同上
 *   maou coding          → 启动当前目录 coding agent
 *   maou agent           → coding 的兼容别名
 *   maou <path|pkg>      → 加载自定义 AgentCliConfig
 *   后续：maou research / … 在此登记即可
 */

import type { AgentCliConfig } from "../types.js";

export type ProductScope = "global" | "project";

export type ProductUi = "tui" | "headless";

export interface MaouProduct {
  /** CLI 子命令名，如 coding */
  name: string;
  /** 写入 .maou/project.json 的 product 字段 */
  productId: string;
  /** global 产品不触发 cwd 项目门禁。 */
  scope: ProductScope;
  /** 缺省 tui；headless 不进 Ratatui。 */
  ui?: ProductUi;
  /** 产品缺省主题；显式 --theme 优先。 */
  defaultTheme?: string;
  description: string;
  /** 动态加载该产品的 AgentCliConfig */
  loadConfig: () => Promise<AgentCliConfig>;
}

/**
 * 内置产品。后续新 agent 案例只需在此追加一项
 * （或未来从 ~/.maou/products.json / 插件目录发现）。
 */
export const DEFAULT_PRODUCT = "ops";

export const BUILTIN_PRODUCTS: Record<string, MaouProduct> = {
  ops: {
    name: "ops",
    productId: "ops-agent",
    scope: "global",
    defaultTheme: "ops-ember",
    description: "电脑管家 Ops Agent —— 固定全局数据路径的机器级助手",
    loadConfig: async () => {
      const mod = await import("@little-house-studio/ops-agent/cli-config");
      return (mod.default ?? mod) as AgentCliConfig;
    },
  },
  coding: {
    name: "coding",
    productId: "coding-agent",
    scope: "project",
    description: "编程 Agent —— 绑定项目目录的编码助手",
    loadConfig: async () => {
      const mod = await import("@little-house-studio/coding-agent/cli-config");
      return (mod.default ?? mod) as AgentCliConfig;
    },
  },
  aiinstall: {
    name: "aiinstall",
    productId: "install-agent",
    scope: "global",
    ui: "headless",
    description: "安装员 —— 无 TUI，把托管仓库装到本机",
    loadConfig: async () => {
      const mod = await import("@little-house-studio/install-agent/cli-config");
      return (mod.default ?? mod) as AgentCliConfig;
    },
  },
};

/** 兼容旧命令 / 简称 → 正式产品名 */
export const PRODUCT_ALIASES: Record<string, string> = {
  agent: "coding",
  install: "aiinstall",
};

/** 系统子命令（非产品） */
export const SYSTEM_COMMANDS = new Set([
  "setup",
  "help",
  "doctor",
  "update",
  "session",
]);

export function resolveProduct(token: string): MaouProduct | null {
  const name = PRODUCT_ALIASES[token] ?? token;
  return BUILTIN_PRODUCTS[name] ?? null;
}

export function listProducts(): MaouProduct[] {
  return Object.values(BUILTIN_PRODUCTS);
}

export function formatProductList(): string {
  const lines = listProducts().map((p) => {
    const aliases = Object.entries(PRODUCT_ALIASES)
      .filter(([, v]) => v === p.name)
      .map(([k]) => k);
    const aliasHint = aliases.length ? `（别名: ${aliases.join(", ")}）` : "";
    return `  maou ${p.name.padEnd(12)} ${p.description}${aliasHint}`;
  });
  return lines.join("\n");
}

/**
 * 是否更像「配置路径 / 包名」而非产品名。
 * 路径优先于产品名，避免 `maou ./coding` 被当成产品。
 */
export function looksLikeConfigTarget(token: string): boolean {
  if (!token) return false;
  if (token.startsWith(".") || token.startsWith("/") || token.startsWith("~")) return true;
  if (token.includes("/") || token.includes("\\")) return true;
  if (token.startsWith("@")) return true;
  if (/\.(ts|tsx|js|mjs|cjs)$/i.test(token)) return true;
  return false;
}

/** 解析 CLI 首个非 flag 词：系统命令 | 产品 | 配置路径 | 未知 */
export type ResolvedToken =
  | { kind: "system"; cmd: string }
  | { kind: "product"; product: MaouProduct }
  | { kind: "config"; target: string }
  | { kind: "unknown"; token: string };

export function resolveCliToken(token: string): ResolvedToken {
  if (SYSTEM_COMMANDS.has(token)) {
    return { kind: "system", cmd: token };
  }
  // 路径 / 包优先（显式自定义配置）
  if (looksLikeConfigTarget(token)) {
    return { kind: "config", target: token };
  }
  const product = resolveProduct(token);
  if (product) {
    return { kind: "product", product };
  }
  return { kind: "unknown", token };
}
