/**
 * 统一应用日志器（pino）
 *
 * 用于 LLM POST 日志等关键链路的结构化输出。
 * 本次升级仅聚焦 LLM 层 POST 日志标准化，因此默认采用轻量初始化：
 * - 开发环境启用 pino-pretty
 * - 生产环境输出 JSON
 *
 * 这里不强制在全局注入，仅提供可复用的 logger 工厂。
 */

import pino from "pino";

const isDev = (process.env.NODE_ENV ?? "development") !== "production";

export function createAppLogger(options?: { level?: string }) {
  const level = options?.level ?? (isDev ? "info" : "info");

  if (isDev) {
    return pino({
      level,
      transport: {
        target: "pino-pretty",
        options: { colorize: true },
      },
    });
  }

  return pino({ level });
}
