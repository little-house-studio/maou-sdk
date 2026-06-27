/**
 * 终端命令审批策略 —— 三种模式 + 黑白名单 + 重复执行放行 + 可插拔小模型审核。
 *
 * 模式：
 * - normal（普通）：白名单直接执行；黑名单拒绝；非名单 → 询问（ask）。
 * - auto：白名单执行；黑名单拒绝；非名单 → 小模型审核：
 *     通过 → 加入白名单并执行；
 *     拒绝 → 加入黑名单 + 给出理由 + 提示"如果是误报，再次执行相同命令即可放行"。
 * - yolo：无视黑白名单与风险，全部执行。
 *
 * 重复放行（误报兜底）：被拒/被问的命令，若**原样再次执行**，视为用户确认 → 放行并加入白名单。
 *
 * 持久化：<root>/agents/<agent>/terminal-policy.json = { mode, whitelist[], blacklist[] }。
 * 名单匹配：规范化后「完全相等」或「前缀 + 空格」（如 "npm run" 命中 "npm run build"）。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export type TerminalMode = "normal" | "auto" | "yolo";
export type PolicyAction = "allow" | "deny" | "ask" | "review";

export interface PolicyDecision {
  action: PolicyAction;
  reason?: string;
  /** 命中的名单条目（用于日志） */
  matched?: string;
}

interface PolicyFile {
  mode: TerminalMode;
  whitelist: string[];
  blacklist: string[];
}

/** 小模型审核器：返回是否放行 + 理由。由 harness 注入（需 LLM 访问）。 */
export type TerminalReviewer = (
  command: string,
  ctx: { agentName: string; cwd?: string },
) => Promise<{ approve: boolean; reason: string }>;

let policyRoot = join(homedir(), ".maou");
let reviewer: TerminalReviewer | null = null;

/** 重复放行窗口：被拒/被问后多久内原样重试算"确认"（默认 10 分钟）。 */
const REPEAT_WINDOW_MS = 10 * 60 * 1000;
/** agentName::normalizedCmd → 最近一次被拒/被问的时间戳 */
const recentlyBlocked = new Map<string, number>();

/** 配置策略文件根目录（harness 初始化时调用）。 */
export function setTerminalPolicyRoot(root: string): void {
  if (root) policyRoot = root;
}

/** 注入小模型审核器（auto 模式用）。 */
export function setTerminalReviewer(fn: TerminalReviewer | null): void {
  reviewer = fn;
}

export function getTerminalReviewer(): TerminalReviewer | null {
  return reviewer;
}

function policyPath(agent: string): string {
  return join(policyRoot, "agents", agent || "main", "terminal-policy.json");
}

function loadPolicy(agent: string): PolicyFile {
  const p = policyPath(agent);
  if (existsSync(p)) {
    try {
      const d = JSON.parse(readFileSync(p, "utf-8")) as Partial<PolicyFile>;
      return {
        mode: (d.mode === "auto" || d.mode === "yolo" || d.mode === "normal") ? d.mode : "normal",
        whitelist: Array.isArray(d.whitelist) ? d.whitelist : [],
        blacklist: Array.isArray(d.blacklist) ? d.blacklist : [],
      };
    } catch { /* 损坏 → 回退默认 */ }
  }
  return { mode: "normal", whitelist: [], blacklist: [] };
}

function savePolicy(agent: string, pf: PolicyFile): void {
  const p = policyPath(agent);
  try {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(pf, null, 2), "utf-8");
  } catch { /* 落盘失败不影响执行 */ }
}

/** 规范化命令：去首尾空白、折叠中间空白。 */
export function normalizeCommand(cmd: string): string {
  return cmd.trim().replace(/\s+/g, " ");
}

/** 名单是否命中：完全相等或「条目 + 空格」前缀。 */
function listMatches(list: string[], norm: string): string | null {
  for (const entry of list) {
    const e = normalizeCommand(entry);
    if (!e) continue;
    if (norm === e || norm.startsWith(e + " ")) return entry;
  }
  return null;
}

function blockKey(agent: string, norm: string): string {
  return `${agent || "main"}::${norm}`;
}

/** 标记某命令刚被拒/被问（供重复放行判定）。 */
function markBlocked(agent: string, norm: string): void {
  recentlyBlocked.set(blockKey(agent, norm), Date.now());
}

/** 是否处于"原样重试即放行"窗口内。 */
function isRepeatConfirm(agent: string, norm: string): boolean {
  const t = recentlyBlocked.get(blockKey(agent, norm));
  return t !== undefined && Date.now() - t < REPEAT_WINDOW_MS;
}

export function getMode(agent: string): TerminalMode {
  return loadPolicy(agent).mode;
}

export function setMode(agent: string, mode: TerminalMode): void {
  const pf = loadPolicy(agent);
  pf.mode = mode;
  savePolicy(agent, pf);
}

export function addToWhitelist(agent: string, command: string): void {
  const pf = loadPolicy(agent);
  const norm = normalizeCommand(command);
  if (!pf.whitelist.some((e) => normalizeCommand(e) === norm)) pf.whitelist.push(norm);
  pf.blacklist = pf.blacklist.filter((e) => normalizeCommand(e) !== norm);
  savePolicy(agent, pf);
  recentlyBlocked.delete(blockKey(agent, norm));
}

export function addToBlacklist(agent: string, command: string): void {
  const pf = loadPolicy(agent);
  const norm = normalizeCommand(command);
  if (!pf.blacklist.some((e) => normalizeCommand(e) === norm)) pf.blacklist.push(norm);
  savePolicy(agent, pf);
}

/**
 * 决策一条命令该如何处理。注意：'review'（auto 非名单）由调用方拿到后再调小模型审核。
 * 重复放行优先级最高：被拒/被问后原样重试 → 直接 allow 并加白名单。
 */
export function decideCommand(command: string, agent: string, modeOverride?: TerminalMode): PolicyDecision {
  const norm = normalizeCommand(command);
  const pf = loadPolicy(agent);
  const mode = modeOverride ?? pf.mode;

  if (mode === "yolo") return { action: "allow", reason: "yolo 模式" };

  // 重复放行：上次被拒/被问，这次原样重试 → 视为用户确认
  if (isRepeatConfirm(agent, norm)) {
    addToWhitelist(agent, norm);
    return { action: "allow", reason: "重复执行确认放行（已加入白名单）" };
  }

  const wl = listMatches(pf.whitelist, norm);
  if (wl) return { action: "allow", matched: wl };

  const bl = listMatches(pf.blacklist, norm);
  if (bl) {
    markBlocked(agent, norm); // 允许"再次执行放行"
    return { action: "deny", matched: bl, reason: `命中黑名单条目「${bl}」` };
  }

  // 非名单 —— 标记为待定，使"原样重试即放行"对 ask/review 都生效
  markBlocked(agent, norm);
  if (mode === "auto") return { action: "review" };
  return { action: "ask" };
}

/** 小模型审核拒绝后调用：入黑名单 + 标记可重复放行。 */
export function recordReviewReject(agent: string, command: string): void {
  const norm = normalizeCommand(command);
  addToBlacklist(agent, norm);
  markBlocked(agent, norm);
}

/** 小模型审核通过后调用：入白名单。 */
export function recordReviewApprove(agent: string, command: string): void {
  addToWhitelist(agent, command);
}
