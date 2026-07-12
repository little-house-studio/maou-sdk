/**
 * 致命硬拦（fatal）— maou 本地规则，与 DCG 互补。
 * 命中后不可 yolo / 二次确认 / 白名单绕过。
 */

export interface MaouHardDenyHit {
  id: string;
  reason: string;
}

const MAOU_HARD_DENY: Array<{ id: string; re: RegExp; reason: string }> = [
  {
    id: "maou.os:fork-bomb",
    re: /:\(\)\s*\{\s*:\|:&\s*\}\s*;\s*:/,
    reason: "检测到 shell fork bomb，禁止执行",
  },
  {
    id: "maou.os:shutdown",
    re: /\b(shutdown|reboot|halt|poweroff)\b/i,
    reason: "关机/重启类命令被 maou 硬策略禁止",
  },
  {
    id: "maou.os:init-runlevel",
    re: /\binit\s+[06]\b/,
    reason: "init 0/6 会关机或重启，禁止执行",
  },
  {
    id: "maou.os:chmod-root-777",
    re: /\bchmod\s+(-R\s+)?777\s+(\/(\s|$)|\/\s)/,
    reason: "对根路径 chmod 777 极度危险，禁止执行",
  },
  {
    id: "maou.os:chown-root",
    re: /\bchown\s+-R\s+\S+\s+\/(\s|$)/,
    reason: "对根路径递归 chown 极度危险，禁止执行",
  },
  {
    id: "maou.os:dd-device",
    re: /\bdd\b[\s\S]*\bof=\/dev\//i,
    reason: "dd 写入块设备可导致不可恢复的磁盘损坏",
  },
  {
    id: "maou.os:mkfs",
    re: /\bmkfs(\.|$|\s)/i,
    reason: "格式化文件系统会毁掉磁盘数据",
  },
  {
    id: "maou.os:write-block-dev",
    re: />\s*\/dev\/(sd|nvme|vd|xvd)[a-z0-9]*/i,
    reason: "重定向写入块设备",
  },
  {
    id: "maou.supply:curl-pipe-shell",
    re: /\bcurl\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/i,
    reason: "curl|bash 远程任意代码执行",
  },
  {
    id: "maou.supply:wget-pipe-shell",
    re: /\bwget\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/i,
    reason: "wget|bash 远程任意代码执行",
  },
];

export function checkMaouHardDeny(command: string): MaouHardDenyHit | null {
  const cmd = command || "";
  for (const rule of MAOU_HARD_DENY) {
    if (rule.re.test(cmd)) {
      return { id: rule.id, reason: rule.reason };
    }
  }
  return null;
}
