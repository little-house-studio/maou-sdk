/**
 * 通用工具函数 + 常量
 * 被所有层共享的基础设施
 */

import { relative as pathRelative } from 'node:path'

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** Maou 版本号（与 package.json 保持同步） */
export const MAOU_VERSION = '0.3.0'

/** Maou 默认端口 */
export const DEFAULT_PORT = 8099

/** 最大请求体大小 */
export const MAX_BODY_SIZE = 10 * 1024 * 1024

/** 文件代理最大文件大小 */
export const MAX_FILE_PROXY_SIZE = 100 * 1024 * 1024

/** URL 代理超时时间 */
export const URL_PROXY_TIMEOUT_MS = 15_000

/** SSE 心跳间隔 */
export const SSE_PING_INTERVAL_MS = 30_000

/** 默认监听地址 */
export const DEFAULT_HOST = '127.0.0.1'

// 注：飞书专属常量（FEISHU_*）已移出 core —— 它们属于飞书插件/应用层，不属于通用 core。

// ─── 工具函数 ────────────────────────────────────────────────────────────────

/** 安全路径检查：candidate 必须在 root 内 */
export function isWithinPath(root: string, candidate: string): boolean {
  const rel = pathRelative(root, candidate)
  return !rel.startsWith('..') && !rel.startsWith('/')
}

/** 安全布尔值解析 */
export function coerceBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim()
    if (lower === 'true' || lower === '1' || lower === 'yes') return true
    if (lower === 'false' || lower === '0' || lower === 'no') return false
  }
  if (typeof value === 'number') return value !== 0
  return fallback
}

/** HTML 转义，防止 XSS */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** ISO 时间戳 */
export function nowIso(): string {
  return new Date().toISOString()
}

/** 检测是否为连接错误 */
export function isConnectionError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as Record<string, unknown>).code
  if (typeof code === 'string') {
    return ['ECONNRESET', 'ECONNABORTED', 'EPIPE', 'ERR_STREAM_DESTROYED'].includes(code)
  }
  return false
}