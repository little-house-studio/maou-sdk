/**
 * 应用日志器（pino）
 *
 * 用于 LLM POST 日志等关键链路的结构化输出。
 * - 开发环境启用 pino-pretty
 * - 生产环境输出 JSON
 *
 * 注：这是应用级日志（写 raw.jsonl 等），随通用 Runtime 门面一并并入 agent 层，
 * 供所有 agent 复用。不强制全局注入，仅提供可复用工厂。
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
