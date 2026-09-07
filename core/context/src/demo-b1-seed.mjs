/**
 * B1 演示：压缩工作集如何「复用」而不是每轮从全量 session 重压
 *
 * 运行：
 *   cd core/context && node src/demo-b1-seed.mjs
 * 或（先 build）：
 *   cd core/context && pnpm build && node dist/demo-b1-seed.js
 *
 * 本文件用 dist 编译产物；若无 dist 则用 vitest 同源 API 的动态 import 失败时提示 build。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const rootPkg = pathToFileURL(join(import.meta.dirname, "../dist/index.js")).href;

function line(title) {
  console.log("\n" + "─".repeat(60));
  console.log(" " + title);
  console.log("─".repeat(60));
}

function bar(label, n, max = 30) {
  const w = Math.max(1, Math.round((n / max) * 20));
  console.log(`  ${label.padEnd(28)} ${"█".repeat(w)}${"░".repeat(20 - w)} ${n} 条`);
}

function makeMsgs(n, tag = "") {
  const out = [];
  for (let i = 0; i < n; i++) {
    const user = i % 2 === 0;
    out.push({
      role: user ? "user" : "assistant",
      content: user
        ? `[${tag}U${i}] 请查日志 ${"x".repeat(80)}`
        : `[${tag}A${i}] 结果如下 ${"y".repeat(160)}`,
      createdAt: new Date(Date.now() + i * 1000).toISOString(),
    });
  }
  return out;
}

async function main() {
  let ContextEngine, HarnessSessionStore, estimateTokens;
  try {
    const mod = await import(rootPkg);
    ContextEngine = mod.ContextEngine;
    HarnessSessionStore = mod.HarnessSessionStore;
    estimateTokens = mod.estimateTokens;
  } catch (e) {
    console.error("需要先编译 context 包：");
    console.error("  cd maou-sdk/core/context && pnpm build");
    console.error(e);
    process.exit(1);
  }

  const root = mkdtempSync(join(tmpdir(), "maou-b1-demo-"));
  const sessionId = "demo-session";
  const harness = new HarnessSessionStore({ maouRoot: root });

  const makeEngine = () =>
    new ContextEngine({ sessionId, harnessStore: harness });

  console.log(`
╔══════════════════════════════════════════════════════════╗
║  B1 演示：为什么「压了还是每轮重压」→ 现在怎么复用        ║
╚══════════════════════════════════════════════════════════╝

比喻：
  SessionStore  = 完整聊天记录本（UI 要看全部历史，永不删）
  HarnessStore  = 给模型看的「浓缩笔记」（可压、可复用）

  修 B1 之前：每轮考试都把整本记录本塞给模型，压完扔掉浓缩笔记
  修 B1 之后：考试用浓缩笔记 + 只贴上「上次以后的新页」
`);

  // ─── 第 1 轮：还没有 harness ───
  line("第 1 轮 · 首次对话（还没有浓缩笔记）");
  let session = makeMsgs(12, "r1-");
  console.log(`  SessionStore（完整记录）: ${session.length} 条消息`);

  let engine = makeEngine();
  let seed = engine.seedWorkingSet(session);
  console.log(`
  seedWorkingSet 结果:
    fromHarness     = ${seed.fromHarness}   ← 没有旧笔记，只能用全量 session
    useAsLlmHistory = ${seed.useAsLlmHistory}
    appended        = ${seed.appended}
  工作集条数 = ${engine.getHistory().length}（= 全量）
`);
  bar("Session 全量", session.length);
  bar("给模型的工作集", engine.getHistory().length);

  // ─── 强制压缩 ───
  line("第 1 轮末 · 上下文超阈值 → 压缩并写入 harness");
  const tokBefore = estimateTokens(engine.getHistory());
  const report = await engine.compress(Math.max(400, Math.floor(tokBefore * 0.35)), {
    knownTokens: tokBefore,
    force: true,
    sourceSessionMessages: session,
  });
  const afterCompressLen = engine.getHistory().length;
  const rec = harness.getCurrentRecord(sessionId);

  console.log(`
  compress 报告:
    stage             = ${report.stage}
    tokens            = ${report.originalTokens} → ${report.compressedTokens}
  harness 落盘:
    工作集条数        = ${afterCompressLen}
    已覆盖 session 条 = ${rec?.sourceSessionMessageCount}
    尾指纹            = ${String(rec?.sourceTailFingerprint ?? "").slice(0, 40)}…
`);
  bar("Session 全量(仍保留)", session.length);
  bar("Harness 浓缩笔记", afterCompressLen);
  console.log(`
  ✅ SessionStore 仍是 ${session.length} 条（UI 完整历史）
  ✅ Harness 只有 ${afterCompressLen} 条（给模型的浓缩版）
`);

  // ─── 修前伪代码对比 ───
  line("【对比】如果按 B1 修复前的做法（每轮 init 全量）");
  console.log(`
  // 旧代码（每轮）:
  engine.initFromSessionMessages(session);  // 永远 12 条全量
  if (tokens >= 70%) await engine.compress(...); // 每轮重新压一遍！

  第 2 轮即使用户只多说了 2 句：
    工作集起点仍是 14 条全量 → 又压一次 → 摘要可能变、浪费 token
`);
  bar("旧：每轮起点", session.length + 2);

  // ─── 第 2 轮：有 harness，只 append ───
  line("第 2 轮 · B1 修复后（复用浓缩笔记 + 只贴新页）");
  session = [
    ...session,
    {
      role: "user",
      content: "[新] 用户又问：刚才那台机器磁盘满了吗？",
      createdAt: new Date().toISOString(),
    },
    {
      role: "assistant",
      content: "[新] 助手：df -h 显示 /data 92%，建议清理。",
      createdAt: new Date().toISOString(),
    },
  ];
  console.log(`  SessionStore 现在: ${session.length} 条（+2 新消息）`);

  engine = makeEngine(); // 模拟「新一轮 / 新进程」只读盘
  seed = engine.seedWorkingSet(session);
  console.log(`
  seedWorkingSet 结果:
    fromHarness     = ${seed.fromHarness}   ← 找到浓缩笔记了！
    useAsLlmHistory = ${seed.useAsLlmHistory}  ← 发给模型用 harness，不是全量
    appended        = ${seed.appended}      ← 只追加 session 里多出来的 2 条
  工作集条数 = ${engine.getHistory().length}
           = 浓缩笔记 ${afterCompressLen} + 新消息 ${seed.appended}
`);
  bar("Session 全量", session.length);
  bar("旧做法起点(全量)", session.length);
  bar("B1 工作集(复用+增量)", engine.getHistory().length);

  const texts = engine
    .getHistory()
    .map((m) => m.contents.map((c) => c.text).join(""))
    .join("\n");
  console.log(`
  工作集里能看到新消息？
    含「磁盘满了」: ${texts.includes("磁盘满了") ? "是 ✅" : "否 ❌"}
    含「df -h」:     ${texts.includes("df -h") ? "是 ✅" : "否 ❌"}
`);

  // ─── 第 3 轮：无新消息 ───
  line("第 3 轮 · 无新消息（例如只刷新 UI）");
  engine = makeEngine();
  seed = engine.seedWorkingSet(session);
  console.log(`
  fromHarness = ${seed.fromHarness}, appended = ${seed.appended}
  工作集条数 = ${engine.getHistory().length}（与第 2 轮相同，不会重复 append）
`);

  // ─── 异常：session 被清空重写 ───
  line("异常 · 用户 /new 截断 session（指纹对不上）");
  const rewritten = [
    { role: "user", content: "全新会话第一句", createdAt: new Date().toISOString() },
  ];
  engine = makeEngine();
  seed = engine.seedWorkingSet(rewritten);
  console.log(`
  旧 harness 还在盘上，但尾指纹对不上新 session
    fromHarness = ${seed.fromHarness}  ← 安全回退，不用旧笔记
    工作集条数  = ${engine.getHistory().length}（= 新 session 全量）
`);

  line("一句话总结");
  console.log(`
  Session = 完整日记本（给人看）
  Harness = 浓缩提纲（给模型看）

  B1 修的是：提纲写好后不要扔掉，下一轮带着提纲 + 只加新页，
  而不是每次把整本日记再塞回去压一遍。

  临时目录: ${root}
`);

  rmSync(root, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
