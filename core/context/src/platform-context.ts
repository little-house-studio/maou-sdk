/**
 * 平台上下文 SDK — 允许插件向 agent 系统提示词注入平台特定信息
 *
 * 使用场景：
 *   飞书、微信、Slack 等插件可通过此 SDK 注册上下文构建器，
 *   runtime 在构建消息时自动追加在 system prompt 之后。
 *   非该平台的会话不会注入任何内容。
 *
 * 流程：
 *   1. 插件注册 provider：PlatformContextRegistry.register(feishuProvider)
 *   2. 插件调用 /api/run 时传 platform_context 字符串
 *   3. runtime 收到后在 buildMessages() 中作为第二条 system message 注入
 *
 * 也可以由插件自行构建字符串直接传入，无需注册 provider。
 * 此 SDK 提供的是标准化类型、构建工具、和集中注册能力。
 */

// ─── 类型定义 ──────────────────────────────────────────────────────────────

/** 平台上下文构建请求 */
export interface PlatformContextRequest {
  /** 会话 ID */
  sessionId: string;
  /** 聊天类型：群聊 / 私聊 */
  chatType?: 'group' | 'p2p';
  /** 平台特定的额外参数 */
  extras?: Record<string, unknown>;
}

/** 平台上下文构建器接口 — 插件实现此接口并注册 */
export interface PlatformContextProvider {
  /** 平台唯一标识（如 "feishu"、"wechat"、"slack"） */
  platformId: string;
  /** 构建注入到 system prompt 之后的上下文文本 */
  buildContext(request: PlatformContextRequest): string;
}

// ─── 注册表 ────────────────────────────────────────────────────────────────

/** 全局平台上下文注册表 */
export class PlatformContextRegistry {
  private providers = new Map<string, PlatformContextProvider>();

  /** 注册一个平台上下文构建器 */
  register(provider: PlatformContextProvider): void {
    this.providers.set(provider.platformId, provider);
  }

  /** 注销一个平台 */
  unregister(platformId: string): boolean {
    return this.providers.delete(platformId);
  }

  /** 获取指定平台的构建器 */
  get(platformId: string): PlatformContextProvider | undefined {
    return this.providers.get(platformId);
  }

  /** 列出所有已注册的平台 ID */
  list(): string[] {
    return [...this.providers.keys()];
  }

  /** 用指定平台的构建器生成上下文文本 */
  build(platformId: string, request: PlatformContextRequest): string | undefined {
    const provider = this.providers.get(platformId);
    if (!provider) return undefined;
    return provider.buildContext(request);
  }
}

/** 全局单例注册表 */
export const platformContextRegistry = new PlatformContextRegistry();

// ─── 构建工具 ──────────────────────────────────────────────────────────────

/** 获取当前时间字符串（ISO 格式，含时区偏移） */
function nowISO(): string {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

/** 平台上下文构建选项 */
export interface BuildPlatformContextOptions {
  /** 平台显示名称（如 "飞书（Feishu/Lark）"） */
  platformName: string;
  /** 聊天类型 */
  chatType: 'group' | 'p2p';
  /** 自定义指令追加（会拼接在通用指令之后） */
  extraInstructions?: string;
}

/**
 * 通用平台上下文构建器
 *
 * 生成标准化的平台上下文文本，包含：
 *   - 平台声明
 *   - 回复机制说明
 *   - 上下文感知提示
 *   - 输出约束
 *   - 当前时间
 *   - 可选的自定义指令
 *
 * 插件可直接使用此函数，也可自行实现 PlatformContextProvider 接口。
 */
export function buildPlatformContext(opts: BuildPlatformContextOptions): string {
  const chatLabel = opts.chatType === 'group' ? '群聊' : '私聊';

  let ctx = `<platform_context>
当前你运行在${opts.platformName}${chatLabel}环境中。

<reply_mechanism>
- 你的 content 输出就是用户收到的回复，不要通过 bash、echo 或其他工具输出回复内容。
- 如果你不需要调用工具，直接输出回复即可，无需任何前置操作。
</reply_mechanism>

<context_awareness>
- 聊天记录已包含在你的上下文中，无需额外获取或搜索。
- 不要尝试打开外部网站、读取本地文件或调用 API 来获取聊天历史——它们已经在你的上下文里了。
- 总结聊天内容时，只基于上下文中实际存在的记录，不要编造不存在的人名、事件或对话。
</context_awareness>

<output_constraint>
- 对话场景下，通常不需要调用工具。直接输出回复即可。
- 只在用户明确要求执行操作（搜索、计算、文件操作等）时才调用工具。
- 不要为了"输出回复"而调用 bash。
</output_constraint>`;

  if (opts.extraInstructions) {
    ctx += `\n\n<extra>\n${opts.extraInstructions}\n</extra>`;
  }

  ctx += `\n\n当前时间：${nowISO()}\n</platform_context>`;

  return ctx;
}
