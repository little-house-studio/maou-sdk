/**
 * HTTP/HTTPS 代理支持（Node 专用）
 *
 * 对标 pi-ai：读取 http_proxy / https_proxy / no_proxy 环境变量走代理。
 * Node 的全局 fetch 基于 undici，可通过 `dispatcher` 选项指定代理 Agent。
 *
 * ⚠️ 本模块静态依赖 undici（node-only），不从浏览器安全的主入口 (core/llm) 导出，
 *    仅经子路径 `core/llm/proxy` 使用，避免污染浏览器依赖图。
 *
 * @example
 * import { createProxyFetch } from "core/llm/proxy"
 * const client = new LLMClient({ fetchImpl: createProxyFetch() })  // 自动读环境变量代理
 */

import { EnvHttpProxyAgent, ProxyAgent, type Dispatcher } from "undici";

export interface ProxyOptions {
  /** 显式代理 URI（如 "http://127.0.0.1:7890"）；缺省时读环境变量 http_proxy/https_proxy/no_proxy */
  uri?: string;
  /** 透传给 undici 的额外配置 */
  token?: string;
}

/**
 * 取一个代理 dispatcher：
 *   - 传了 uri → ProxyAgent(uri)
 *   - 否则 → EnvHttpProxyAgent（自动读 http_proxy/https_proxy/no_proxy）
 */
export function getProxyDispatcher(opts?: ProxyOptions): Dispatcher {
  if (opts?.uri) {
    return new ProxyAgent(opts.token ? { uri: opts.uri, token: opts.token } : opts.uri);
  }
  return new EnvHttpProxyAgent();
}

/**
 * 构造一个走代理的 fetch，直接传给 `new LLMClient({ fetchImpl })`。
 * dispatcher 在闭包内复用（保持连接池）。
 */
export function createProxyFetch(opts?: ProxyOptions): typeof fetch {
  const dispatcher = getProxyDispatcher(opts);
  const proxied = (input: unknown, init?: Record<string, unknown>) =>
    // dispatcher 是 undici 对 RequestInit 的扩展字段，标准 fetch 类型未包含，故 cast
    fetch(input as Parameters<typeof fetch>[0], { ...(init ?? {}), dispatcher } as Parameters<typeof fetch>[1]);
  return proxied as unknown as typeof fetch;
}
