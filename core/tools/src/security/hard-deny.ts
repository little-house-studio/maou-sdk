/**
 * 致命硬拦（fatal）。命中后不可 yolo / 二次确认 / 白名单绕过。
 *
 * 仅含 DCG 现有 pack 仍 allow 的关机/重启缺口。
 */

export interface MaouHardDenyHit {
  id: string;
  reason: string;
}

const MAOU_HARD_DENY: Array<{ id: string; re: RegExp; reason: string }> = [
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
