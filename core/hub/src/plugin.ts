/**
 * Hub 插件基类 — 服务/连接层插件的生命周期钩子
 *
 * 从 maou-agent 的 core/agent/agent_factory 迁来：插件系统本质是
 * 「服务/连接管理」，按设计归 hub 层，不再寄生在 agent 层。
 *
 * 所有插件必须继承 PluginBase，实现生命周期钩子。
 * 插件通过 hub/client 模块与 hub 通信。
 */

import type { ToolCall } from "@little-house-studio/types";

// ─── 插件内部最小化类型（避免与 hub/types.ts 的 HubMessage/HubEvent 混淆）──────

/** 插件收到的 SDK 消息（与 agent 层 sdk.types.Message 等价） */
export interface PluginMessage {
  id: string;
  /** "user" / "assistant" / "tool" / "system" */
  role: string;
  content: string;
  metadata: Record<string, unknown>;
  /** 来源标识 */
  source: string;
  timestamp: number;
}

/** 插件收到的事件（与 agent 层 sdk.types.AgentEvent 等价） */
export interface PluginEvent {
  type: string;
  data: Record<string, unknown>;
  source: string;
  timestamp: number;
}

// ─── 插件元数据 ──────────────────────────────────────────────────────────────

/** 插件元数据接口 */
export interface PluginMeta {
  id: string
  name: string
  description: string
  category: string
  version: string
}

/** 内置插件元数据列表 */
export const PLUGIN_METADATA: PluginMeta[] = [
  { id: 'json_spec', name: 'JSON 规范', description: '控制 AI 输出的 JSON 格式规范，确保结构一致性', category: 'core', version: '1.0.0' },
  { id: 'terminal_sandbox', name: '终端沙箱', description: '在隔离环境中执行终端命令，保护系统安全', category: 'security', version: '1.0.0' },
  { id: 'signal_render', name: '信号渲染', description: '渲染 AI 输出的特殊视觉信号和格式', category: 'display', version: '1.0.0' },
  { id: 'variable_store', name: '变量存储', description: '持久化跨轮次的变量状态，支持上下文共享', category: 'data', version: '1.0.0' },
  { id: 'skill_bridge', name: '技能桥接', description: '桥接外部技能库，扩展 AI 能力范围', category: 'integration', version: '1.0.0' },
  { id: 'test_lab', name: '测试实验室', description: '提供测试框架支持 AI 输出验证和回归测试', category: 'dev', version: '1.0.0' },
  { id: 'memory_write', name: '记忆写入', description: '将关键对话内容写入长期记忆存储', category: 'memory', version: '1.0.0' },
  { id: 'desktop_pet', name: '桌面宠物', description: '悬浮桌面宠物，实时展示 AI 表情和状态', category: 'display', version: '1.0.0' },
]

/**
 * 插件基类 — 8 个生命周期钩子 + 工具/提示词扩展
 *
 * 必须实现:
 *   - name (getter)
 *
 * 推荐实现:
 *   - onLoad()
 *   - onMessage(message)
 *
 * 可选实现:
 *   - version (getter)
 *   - description (getter)
 *   - onUnload()
 *   - onToolCall(toolCall)
 *   - onBeforeLLMCall(messages)
 *   - onAfterLLMCall(response)
 *   - onSessionCreate(session)
 *   - onSessionDelete(sessionId)
 */
export abstract class PluginBase {
  /** 插件名称，用于日志和识别（必须实现） */
  abstract get name(): string;

  /** 插件版本号 */
  get version(): string {
    return "1.0.0";
  }

  /** 插件描述 */
  get description(): string {
    return "";
  }

  /** 插件加载时调用，在此处注册监听器等 */
  onLoad(): void {
    // 默认空实现
  }

  /** 插件卸载时调用，在此处清理资源 */
  onUnload(): void {
    // 默认空实现
  }

  /** 收到消息时调用 */
  onMessage(_message: PluginMessage): void {
    // 默认空实现
  }

  /** 工具调用前触发（返回 false 可拦截） */
  onToolCall(_toolCall: ToolCall): boolean {
    return true;
  }

  /** LLM 调用前触发 */
  onBeforeLLMCall(_messages: Record<string, unknown>[]): void {
    // 默认空实现
  }

  /** LLM 调用后触发 */
  onAfterLLMCall(_response: Record<string, unknown>): void {
    // 默认空实现
  }

  /** 会话创建时触发 */
  onSessionCreate(_session: Record<string, unknown>): void {
    // 默认空实现
  }

  /** 会话删除时触发 */
  onSessionDelete(_sessionId: string): void {
    // 默认空实现
  }
}

/**
 * 自动发现 plugins/ 目录下的所有插件
 *
 * 扫描指定目录中导出 PluginBase 实例的模块。
 *
 * @param dir - 插件目录路径（默认 "plugins"）
 * @returns 插件实例列表
 */
export async function discoverPlugins(dir = "plugins"): Promise<PluginBase[]> {
  const plugins: PluginBase[] = [];

  try {
    const { readdir } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith("_") || entry.name.startsWith(".")) {
        continue;
      }

      const modulePath = join(dir, entry.name, "index.js");
      try {
        const mod = await import(modulePath);
        // 在模块导出中查找 PluginBase 实例
        for (const value of Object.values(mod)) {
          if (value instanceof PluginBase) {
            plugins.push(value);
            console.log(`[hub] 发现插件: ${value.name} (${entry.name})`);
            break;
          }
        }
      } catch (e) {
        console.warn(`[hub] 加载插件 ${entry.name} 失败:`, e);
      }
    }
  } catch {
    // 目录不存在时静默返回空列表
  }

  return plugins;
}
