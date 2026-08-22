/**
 * 诊断收敛控制器 —— 核心难点。
 * publishDiagnostics 是推送、多批、无完成信号。三级收敛取最先触发：
 *   1. 进度门控：等诊断相关 $/progress 令牌 end（rust-analyzer 等 flycheck）
 *   2. 静默期：最后一批诊断后 quietMs 无新事件
 *   3. 硬超时：到点返回 settled:false，绝不谎报"无错误"
 */

import type { LanguageServer } from "./server.js";
import type { SettleInfo } from "./types.js";

export interface SettleOptions {
  quietMs: number;
  hardMs: number;
  /** 是否门控 check 令牌（rust-analyzer 等） */
  gateOnCheck: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 单文件诊断收敛：等待**指定 uri** 在 startedAt 之后收到新一批 publishDiagnostics，
 * 再观察 quietMs 静默。避免用全局 lastDiagAt 时被其它文件的旧时间戳误判收敛。
 * @param expectFresh 是否刚发出 didOpen/didChange（true 时必须等新 publish；false 时现有诊断即当前态）
 */
export async function waitSettleFile(
  server: LanguageServer,
  uri: string,
  startedAt: number,
  opts: SettleOptions & { expectFresh: boolean },
): Promise<SettleInfo> {
  const deadline = startedAt + opts.hardMs;
  const hasCheckToken = opts.gateOnCheck && server.spec.progressTokens?.check;

  // 文档未变更：现有诊断即当前状态，直接返回
  if (!opts.expectFresh && server.diagAt.get(uri) !== undefined) {
    return { settled: true, reason: "quiet-timeout", waitedMs: 0 };
  }

  // 进度门控（rust-analyzer flycheck 等）
  if (hasCheckToken) {
    while (Date.now() < deadline) {
      if (server.progress.lastCheckEndAt > startedAt && server.progress.active.size === 0) break;
      await sleep(150);
    }
  }

  while (Date.now() < deadline) {
    const fileDiagAt = server.diagAt.get(uri) ?? 0;
    const gotFresh = fileDiagAt > startedAt;
    const idle = server.progress.active.size === 0;
    if (gotFresh && idle && Date.now() - fileDiagAt >= opts.quietMs) {
      return { settled: true, reason: "quiet-timeout", waitedMs: Date.now() - startedAt };
    }
    await sleep(100);
  }
  return { settled: false, reason: "hard-timeout", waitedMs: Date.now() - startedAt };
}

/**
 * 等待诊断收敛。
 * @param server 语言服务器（持有 diagnostics sink + progress 状态）
 * @param startedAt 触发分析（didOpen/didChange）的时间戳
 */
export async function waitSettle(
  server: LanguageServer,
  startedAt: number,
  opts: SettleOptions,
): Promise<SettleInfo> {
  const deadline = startedAt + opts.hardMs;
  const hasCheckToken = opts.gateOnCheck && server.spec.progressTokens?.check;

  // 阶段 A：若有 check 令牌，先等它出现并结束
  if (hasCheckToken) {
    // 等 check 令牌 end（lastCheckEndAt > startedAt）或硬超时
    while (Date.now() < deadline) {
      if (server.progress.lastCheckEndAt > startedAt && server.progress.active.size === 0) {
        break; // check 已结束且无活跃进度
      }
      await sleep(150);
    }
  }

  // 阶段 B：静默期。
  // 关键：在收到第一批 publishDiagnostics（lastDiagAt>0）之前，绝不以"静默"判定收敛——
  // 否则会在诊断到达前谎报"0 错误"（假干净）。tsserver/pyright 即使文件无错也会推空数组 []，
  // 因此 lastDiagAt 变正是"分析已跑完一轮"的可靠信号。
  // 进度门控结束（lastCheckEndAt）同样可作为收敛信号（适配只发 $/progress 不发空诊断的服务器）。
  while (Date.now() < deadline) {
    const gotFirstDiag = server.lastDiagAt > 0;
    const checkEnded = hasCheckToken ? server.progress.lastCheckEndAt > startedAt : false;
    const idle = server.progress.active.size === 0;

    if (gotFirstDiag && idle && Date.now() - server.lastDiagAt >= opts.quietMs) {
      return { settled: true, reason: "quiet-timeout", waitedMs: Date.now() - startedAt };
    }
    if (checkEnded && idle && !gotFirstDiag) {
      // 进度结束但服务器未推诊断——视为已收敛（无诊断=无错误）
      return { settled: true, reason: "progress-end", waitedMs: Date.now() - startedAt };
    }
    await sleep(120);
  }

  // 阶段 C：硬超时——从未收到诊断/进度结束，绝不谎报"无错误"
  return { settled: false, reason: "hard-timeout", waitedMs: Date.now() - startedAt };
}
