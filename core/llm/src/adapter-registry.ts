/**
 * adapter-registry —— 全局协议适配器注册表（供 base 子入口按需注册用）
 *
 * 主入口（index.ts）在 import 时通过 ProtocolGateway 自动注册全部 adapter；
 * base 子入口不自动注册，调用方从 provider 子入口 import register() 来按需注册，
 * 经此注册表写入 ProtocolGateway 使用的全局 map，实现 tree-shake 友好。
 */

import type { ProtocolAdapter } from "./adapters/types.js";

const REGISTRY = new Map<string, ProtocolAdapter>();

/** 注册一个协议适配器（按 protocolName） */
export function registerAdapter(adapter: ProtocolAdapter): void {
  REGISTRY.set(adapter.protocolName, adapter);
}

/** 取已注册的适配器 */
export function getAdapter(protocol: string): ProtocolAdapter | undefined {
  return REGISTRY.get(protocol);
}

/** 取整个注册表（ProtocolGateway 可消费） */
export function getAdapterRegistry(): Map<string, ProtocolAdapter> {
  return REGISTRY;
}

/** 清空（测试用） */
export function clearAdapters(): void {
  REGISTRY.clear();
}
