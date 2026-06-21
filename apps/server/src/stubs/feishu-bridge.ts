/**
 * 飞书插件占位（plugins 未迁移到 SDK monorepo）。
 * 仅保留 harness/runtime.ts 用到的接口，全部为空实现——飞书功能在此版本中禁用。
 * 要恢复:把 plugins/feishu 也迁进来，并把 runtime.ts 的 import 指回真实实现。
 */
export class FeishuBridge {
  async start(): Promise<Record<string, unknown>> {
    return { enabled: false, reason: "feishu plugin not migrated to maou-sdk" };
  }
  stop(): Record<string, unknown> {
    return { ok: true };
  }
  getStatus(): Record<string, unknown> {
    return { enabled: false };
  }
}
