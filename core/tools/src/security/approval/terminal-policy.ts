/**
 * 终端命令审批策略 —— 三种模式 + 黑白名单 + 重复执行放行 + 可插拔小模型审核。
 *
 * 模式：
 * - normal（普通）：白名单直接执行；黑名单拒绝；非名单 → 询问（ask）。
 * - auto：白名单执行；黑名单拒绝；非名单 → 小模型审核：
 *     通过 → 加入白名单并执行；
 *     拒绝 → 加入黑名单 + 给出理由 + 提示"如果是误报，再次执行相同命令即可放行"。
 * - yolo：无视用户黑白名单与审批，全部执行。
 *   注意：破坏性命令仍由 DCG（use_terminal 前置）硬拦，yolo 不能绕过 DCG。
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

/**
 * 交互式审批器：normal 模式 ask 分支调用，弹菜单让用户选 Yes/No。
 * 由 TUI 层注入（需交互能力）。返回 approve + persist（是否持久化到白/黑名单）。
 * 未注入时（非 TUI 场景如 harness/飞书）走旧文字 ask 兜底。
 */
export type TerminalApprover = (
  command: string,
  ctx: {
    agentName: string;
    cwd?: string;
    /** low=普通确认(黄) high=危险确认(红) */
    risk?: "low" | "high";
    /** 一句人话说明命令意图 */
    summary?: string;
    /** 短标签 */
    label?: string;
    /** 安全规则 id（若有） */
    ruleId?: string;
    /** 安全层原因 */
    reason?: string;
  },
) => Promise<{ approve: boolean; persist?: "whitelist" | "blacklist" | "none" }>;

let policyRoot = join(homedir(), ".maou");
let reviewer: TerminalReviewer | null = null;
let approver: TerminalApprover | null = null;

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

/** 注入交互式审批器（normal 模式 ask 用，TUI 场景注入）。 */
export function setTerminalApprover(fn: TerminalApprover | null): void {
  approver = fn;
}

export function getTerminalApprover(): TerminalApprover | null {
  return approver;
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

/**
 * 提取命令的"放行前缀"——用于"Yes且不再问"按命令类放行（而非完整命令串）。
 * 规则（模仿 Claude Code 的 Bash(prefix:*) 语义）：
 *   - 取命令第一个 token 作命令名（如 `curl -s "https://..."` → `curl`）
 *   - 返回 `命令名 *` 形式，匹配时按命令名前缀放行同类命令
 *   - 这样同意一次 curl，所有 curl 命令都放行（用户显式同意该命令类）
 */
export function commandPrefix(cmd: string): string {
  const norm = normalizeCommand(cmd);
  const firstToken = norm.split(" ")[0] ?? "";
  return firstToken ? `${firstToken} *` : norm;
}

/**
 * 名单是否命中。条目支持两种形式：
 *   - `命令名 *`：按命令名前缀放行同类（如 `curl *` 匹配所有 `curl ...`）
 *   - 无 `*`：完全相等或「条目 + 空格」前缀（原逻辑，兼容旧条目/精确匹配）
 */
function listMatches(list: string[], norm: string): string | null {
  const cmdName = norm.split(" ")[0] ?? "";
  for (const entry of list) {
    const e = normalizeCommand(entry);
    if (!e) continue;
    // 前缀通配：`命令名 *` → 同名命令都命中
    if (e.endsWith(" *")) {
      const prefix = e.slice(0, -2); // 去掉 " *"
      if (prefix && (norm === prefix || cmdName === prefix)) return entry;
      continue;
    }
    // 精确：完全相等或「条目+空格」前缀
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

/** 供三层安全策略：登记「危险指令待二次确认」 */
export function markCommandForRepeatConfirm(agent: string, command: string): void {
  markBlocked(agent, normalizeCommand(command));
}

/** 供三层安全策略：是否处于二次确认窗口 */
export function isCommandRepeatConfirm(agent: string, command: string): boolean {
  return isRepeatConfirm(agent, normalizeCommand(command));
}

/** 消费一次二次确认（放行后清除，避免无限免检；可选再写入白名单由调用方决定） */
export function consumeRepeatConfirm(agent: string, command: string): void {
  recentlyBlocked.delete(blockKey(agent, normalizeCommand(command)));
}

export function getRepeatConfirmWindowMs(): number {
  return REPEAT_WINDOW_MS;
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

  // 非名单 —— auto 模式标记为待定（小模型审核 + "原样重试放行"语义）；
  // normal 模式 ask 不标记：agent loop 里模型拿到 ask 后常原样重试，若 markBlocked 会自动入白名单，
  // 绕过用户确认，安全语义被架空。normal 的放行只走 addToWhitelist 显式确认路径。
  if (mode === "auto") {
    markBlocked(agent, norm);
    return { action: "review" };
  }
  return { action: "ask" };
}

/** 小模型审核拒绝后调用：入黑名单 + 标记可重复放行。 */
export function recordReviewReject(agent: string, command: string): void {
  const norm = normalizeCommand(command);
  addToBlacklist(agent, norm);
  // 不 markBlocked：review-reject 是小模型主动拒绝（非误报），
  // 若 markBlocked 会被"原样重试放行"覆盖、黑名单被一次重试清除，安全语义失效。
}

/** 小模型审核通过后调用：入白名单。 */
export function recordReviewApprove(agent: string, command: string): void {
  addToWhitelist(agent, command);
}
