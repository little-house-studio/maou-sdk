/**
 * Agent 模板引用解析 —— 共享工具函数。
 * 被 template.ts 和 preview.ts 同时使用，避免循环依赖。
 *
 * 引用模式：实例目录写 `.agent.ref` 指向产品模板目录（绝对路径）。
 * 仓库曾将 `agent/` 重命名为 `agent-products/`，旧 ref 需透明迁移。
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 将历史 monorepo 路径迁移到 agent-products。
 * 例：.../maou-sdk/agent/coding-agent/templates/coding
 *   → .../maou-sdk/agent-products/coding-agent/templates/coding
 */
export function migrateLegacyProductTemplatePath(ref: string): string | null {
  const raw = (ref || "").trim();
  if (!raw) return null;

  // 已是新路径
  if (raw.includes("/maou-sdk/agent-products/") && existsSync(raw)) {
    return raw;
  }

  // agent/ → agent-products/（只替换 monorepo 产品包段，避免误伤 .maou/agents）
  // 匹配：.../maou-sdk/agent/<pkg>/...  且 pkg 为 *-agent 或常见产品目录
  const re = /([/\\])maou-sdk\1agent\1((?:coding-agent|ops-agent|proactive-agent)(?:\1|$))/;
  if (re.test(raw)) {
    const next = raw.replace(
      /([/\\])maou-sdk\1agent\1/g,
      "$1maou-sdk$1agent-products$1",
    );
    // 防止 double: agent-products-products
    const normalized = next.replace(
      /agent-products-products/g,
      "agent-products",
    );
    if (normalized !== raw && existsSync(normalized)) return normalized;
  }

  // 宽松：仅当路径含 maou-sdk/agent/ 且不存在时尝试
  const idx = raw.indexOf("/maou-sdk/agent/");
  if (idx >= 0 && !raw.includes("/maou-sdk/agent-products/")) {
    const next =
      raw.slice(0, idx) +
      "/maou-sdk/agent-products/" +
      raw.slice(idx + "/maou-sdk/agent/".length);
    if (existsSync(next)) return next;
  }

  return null;
}

/**
 * 读取 .agent.ref 获取模板路径。
 * 如果不存在 .agent.ref，返回 null（可能是旧模式复制的 agent）。
 * 旧路径自动迁移并尽量写回磁盘。
 */
export function getTemplateRef(agentDir: string): string | null {
  const refPath = join(agentDir, ".agent.ref");
  if (!existsSync(refPath)) return null;
  try {
    const ref = readFileSync(refPath, "utf-8").trim();
    if (!ref) return null;
    if (existsSync(ref)) return ref;

    const migrated = migrateLegacyProductTemplatePath(ref);
    if (migrated) {
      try {
        writeFileSync(refPath, migrated + "\n", "utf-8");
      } catch {
        /* 只读环境：仍返回迁移后路径 */
      }
      return migrated;
    }
    return null;
  } catch {
    return null;
  }
}
