/**
 * 本地通用危险规则 — 补 DCG **默认 pack 未覆盖** 的资产/供应链风险。
 *
 * 与 hard-deny（致命）分工：
 *   - hard-deny → 永远 fatal
 *   - local-rules → fatal 或 dangerous（可二次确认）
 *
 * 领域特例（如某 skill 清临时目录）不要写在这里，放在对应工具旁。
 */

import type { SecurityTier } from "./types.js";

export interface LocalRuleHit {
  id: string;
  tier: SecurityTier;
  reason: string;
}

const RULES: Array<{
  id: string;
  tier: SecurityTier;
  re: RegExp;
  reason: string;
}> = [
  // ── 供应链 / 远程执行 ─────────────────────────────────────
  {
    id: "local.supply:curl-pipe-shell",
    tier: "fatal",
    re: /\bcurl\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/i,
    reason: "curl|sh / curl|bash 远程管道执行，可导致任意代码与资产损失",
  },
  {
    id: "local.supply:wget-pipe-shell",
    tier: "fatal",
    re: /\bwget\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/i,
    reason: "wget|sh 远程管道执行",
  },
  {
    id: "local.supply:curl-pipe-python",
    tier: "fatal",
    re: /\bcurl\b[^|\n]*\|\s*(?:sudo\s+)?python[0-9.]*\b/i,
    reason: "curl|python 远程管道执行",
  },
  {
    id: "local.supply:eval-curl",
    tier: "fatal",
    re: /\beval\s*\(?\s*\$?\(?\s*(?:curl|wget)\b/i,
    reason: "eval 远程下载内容",
  },
  {
    id: "local.supply:base64-pipe-shell",
    tier: "dangerous",
    re: /\bbase64\s+(-d|--decode)\b[^|\n]*\|\s*(?:ba)?sh\b/i,
    reason: "base64 解码后直接交 shell，常见于恶意载荷",
  },

  // ── 权限与磁盘（DCG system.disk 默认开，此处双保险）────────
  {
    id: "local.os:chmod-777-recursive-here",
    tier: "dangerous",
    re: /\bchmod\s+(-R\s+)?777\s+(\.(\s|$)|\.\/)/,
    reason: "对当前树 chmod 777 会扩大攻击面与误授权",
  },
  {
    id: "local.os:dd-device",
    tier: "fatal",
    re: /\bdd\b.*\bof=\/dev\//i,
    reason: "dd 写入块设备可毁盘",
  },
  {
    id: "local.os:mkfs",
    tier: "fatal",
    re: /\bmkfs(\.|$|\s)/i,
    reason: "mkfs 会毁掉文件系统",
  },
  {
    id: "local.os:write-block-dev",
    tier: "fatal",
    re: />\s*\/dev\/sd[a-z]/i,
    reason: "重定向写入磁盘设备",
  },

  // ── 云 / 容器 / IaC / DB（DCG 默认未开 pack）──────────────
  {
    id: "local.asset:docker-system-prune",
    tier: "dangerous",
    re: /\bdocker\s+system\s+prune\b/i,
    reason: "docker system prune 可删除未使用镜像/卷，造成环境资产损失",
  },
  {
    id: "local.asset:docker-compose-down-v",
    tier: "dangerous",
    re: /\bdocker\s+compose\s+down\b[^\n]*\s-v\b/i,
    reason: "compose down -v 会删卷，数据可能不可恢复",
  },
  {
    id: "local.asset:kubectl-delete-ns",
    tier: "dangerous",
    re: /\bkubectl\s+delete\s+(ns|namespace)\b/i,
    reason: "删除 K8s namespace 会连带销毁其中工作负载与配置",
  },
  {
    id: "local.asset:terraform-destroy",
    tier: "dangerous",
    re: /\bterraform\s+destroy\b/i,
    reason: "terraform destroy 会拆除云资源，可能产生费用与资产损失",
  },
  {
    id: "local.asset:pulumi-destroy",
    tier: "dangerous",
    re: /\bpulumi\s+destroy\b/i,
    reason: "pulumi destroy 拆除基础设施",
  },
  {
    id: "local.asset:sql-drop-database",
    tier: "dangerous",
    re: /\bDROP\s+(DATABASE|SCHEMA)\b/i,
    reason: "DROP DATABASE/SCHEMA 销毁数据库资产",
  },
  {
    id: "local.asset:sql-drop-table",
    tier: "dangerous",
    re: /\bDROP\s+TABLE\b/i,
    reason: "DROP TABLE 销毁表数据",
  },
  {
    id: "local.asset:sql-truncate",
    tier: "dangerous",
    re: /\bTRUNCATE\s+(TABLE\s+)?\w+/i,
    reason: "TRUNCATE 清空表数据",
  },
  {
    id: "local.asset:redis-flush",
    tier: "dangerous",
    re: /\bFLUSH(ALL|DB)\b/i,
    reason: "Redis FLUSHALL/FLUSHDB 清空缓存数据",
  },
  {
    id: "local.asset:aws-s3-rb",
    tier: "dangerous",
    re: /\baws\s+s3\s+(rb|rm)\b[^\n]*--force/i,
    reason: "强制删除 S3 桶/对象",
  },
  {
    id: "local.asset:gh-repo-delete",
    tier: "dangerous",
    re: /\bgh\s+repo\s+delete\b/i,
    reason: "删除 GitHub 仓库",
  },
  {
    id: "local.asset:npm-publish",
    tier: "dangerous",
    re: /\bnpm\s+publish\b/i,
    reason: "npm publish 向公共/私有 registry 发布包，影响供应链与品牌",
  },
  {
    id: "local.asset:pypi-upload",
    tier: "dangerous",
    re: /\b(twine\s+upload|poetry\s+publish)\b/i,
    reason: "发布 Python 包到索引",
  },

  // ── 密钥外泄倾向（危险，需确认）────────────────────────────
  {
    id: "local.secret:curl-auth-header-hardcoded",
    tier: "dangerous",
    re: /\bcurl\b[^\n]*(-H|--header)\s*['\"][^'\"]*(Authorization|api[_-]?key|token)\s*:/i,
    reason: "命令行明文携带 Authorization/API Key，易进日志与历史",
  },
];

/**
 * 检查本地通用规则。按数组顺序，首中即返回。
 */
export function checkLocalSecurityRules(command: string): LocalRuleHit | null {
  const cmd = command || "";
  for (const r of RULES) {
    if (r.re.test(cmd)) {
      return { id: r.id, tier: r.tier, reason: r.reason };
    }
  }
  return null;
}

export function listLocalSecurityRules(): Array<{ id: string; tier: SecurityTier; reason: string }> {
  return RULES.map(({ id, tier, reason }) => ({ id, tier, reason }));
}
