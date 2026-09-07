/**
 * 能效探针：模拟一条超长改 bug 会话，跑过微压缩 → 80% 折叠 → 再涨再折。
 * 看折叠后模型还能否续工，而不是只看条数变少。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRoundMicroCompact, stampMicroBirth } from "@little-house-studio/context-components";
import { estimateTokens, segmentVisibleText } from "@little-house-studio/context-components";
import { compressMaou } from "./compressor.js";
import type { MaouMessage } from "./types/message.js";

const WINDOW = 32_000;

function msg(
  seqId: number,
  category: MaouMessage["category"],
  text: string,
  extra: Partial<MaouMessage> = {},
): MaouMessage {
  return {
    seqId,
    taskIds: [],
    contents: [{ text }],
    keepAfterCompress: false,
    category,
    originalRole:
      category === "tool_result"
        ? "tool"
        : category === "assistant" || category === "tool_call"
          ? "assistant"
          : category === "system"
            ? "system"
            : "user",
    ...extra,
  };
}

function visible(history: MaouMessage[]): string {
  return history.map((m) => segmentVisibleText(m.contents[0]!)).join("\n");
}

/** 一条像真实 coding 会话的长历史：目标、改口、读文件、终端报错、编辑、当前尾巴。 */
function buildLongBugSession(): MaouMessage[] {
  const out: MaouMessage[] = [];
  let seq = 0;
  const born = (turn: number, m: MaouMessage) => stampMicroBirth(m, turn);

  out.push(
    born(
      1,
      msg(
        seq++,
        "user",
        "修 auth 登录偶发 401。先查 session 过期，不要改 JWT 签名算法。",
      ),
    ),
  );
  out.push(
    born(
      1,
      msg(seq++, "assistant", "先读 session-store 和登录路由，再跑相关测试。"),
    ),
  );

  const sessionStoreBody = [
    "export class SessionStore {",
    "  // CRITICAL: ttl is 30 minutes, not 24h",
    "  private ttlMs = 30 * 60 * 1000;",
    "  load(id: string) { return this.map.get(id); }",
    ...Array.from({ length: 80 }, (_, i) => `  // impl line ${i} ${"x".repeat(40)}`),
    "}",
  ].join("\n");
  out.push(
    born(
      1,
      msg(seq++, "tool_call", "read", {
        toolName: "reader",
        toolCalls: [{ id: "r1", name: "reader", arguments: { path: "core/context/src/session-store.ts" } }],
      }),
    ),
  );
  out.push(
    born(
      1,
      msg(
        seq++,
        "tool_result",
        `[path=core/context/src/session-store.ts | total_chars=${sessionStoreBody.length}]\n${sessionStoreBody}`,
        { toolName: "reader", toolCallId: "r1", readPath: "core/context/src/session-store.ts" },
      ),
    ),
  );

  const testLog = [
    " RUN  v3.2.6 auth",
    ...Array.from({ length: 120 }, (_, i) => `ok ${i} ${"·".repeat(20)}`),
    " FAIL  src/auth/login.test.ts > expires mid-request",
    "AssertionError: expected 401 to be 200",
    " ❯ src/auth/login.ts:88:11",
    "   cookie.expires = Date.now() + 24 * 3600 * 1000",
    "Full output stored at: /tmp/sess/spill/test-401.txt",
  ].join("\n");
  out.push(
    born(
      2,
      msg(seq++, "tool_call", "use_terminal", {
        toolName: "use_terminal",
        toolCalls: [{ id: "t1", name: "use_terminal", arguments: { command: "pnpm test auth" } }],
      }),
    ),
  );
  out.push(
    born(
      2,
      msg(
        seq++,
        "tool_result",
        `[path=/tmp/sess/spill/test-401.txt | total_lines=126 | total_chars=${testLog.length}]\n${testLog}\n(Full output stored at: /tmp/sess/spill/test-401.txt. Retrieve with the read tool using offset / limit.)`,
        { toolName: "use_terminal", toolCallId: "t1" },
      ),
    ),
  );

  out.push(
    born(
      3,
      msg(
        seq++,
        "user",
        "不对，不是 JWT。我改口了：只动 cookie 过期，JWT helper 碰都不许碰。",
      ),
    ),
  );
  out.push(
    born(
      3,
      msg(
        seq++,
        "assistant",
        "收到。只改 cookie 过期，对齐 SessionStore.ttlMs=30min。JWT helper 不动。",
      ),
    ),
  );

  for (let i = 0; i < 18; i++) {
    const turn = 4 + i;
    out.push(born(turn, msg(seq++, "user", `继续查第 ${i + 1} 处调用点，看看谁写了 24h。`)));
    out.push(
      born(
        turn,
        msg(seq++, "assistant", `第 ${i + 1} 处：先 grep 再读文件。`),
      ),
    );
    out.push(
      born(
        turn,
        msg(seq++, "tool_call", "reader", {
          toolName: "reader",
          toolCalls: [{ id: `g${i}`, name: "reader", arguments: { path: `src/auth/call-${i}.ts` } }],
        }),
      ),
    );
    const dump = [
      `[path=src/auth/call-${i}.ts | total_chars=4000]`,
      `export function call${i}() {`,
      i === 7 ? "  // USER_CONSTRAINT: do not touch jwt-helper.ts" : `  const exp = 24 * 3600;`,
      ...Array.from({ length: 40 }, (_, k) => `  noop(${k});`),
      "}",
    ].join("\n");
    out.push(
      born(
        turn,
        msg(seq++, "tool_result", dump, {
          toolName: "reader",
          toolCallId: `g${i}`,
          readPath: `src/auth/call-${i}.ts`,
        }),
      ),
    );
    if (i % 3 === 0) {
      const term = [
        `[path=/tmp/sess/spill/run-${i}.txt | total_lines=80]`,
        `row-1 build ${i}`,
        ...Array.from({ length: 60 }, (_, k) => `log ${k} ${"z".repeat(30)}`),
        i === 6 ? "Error: EADDRINUSE 8787 — 用户说过不要换端口，先杀掉旧进程" : `ok ${i}`,
        `Full output stored at: /tmp/sess/spill/run-${i}.txt`,
      ].join("\n");
      out.push(
        born(
          turn,
          msg(seq++, "tool_result", term, { toolName: "use_terminal", toolCallId: `term${i}` }),
        ),
      );
    }
  }

  out.push(
    born(
      22,
      msg(
        seq++,
        "assistant",
        "准备改 cookie 过期。下一步只动 login.ts:88，测 expires mid-request。",
      ),
    ),
  );
  out.push(
    born(
      23,
      msg(
        seq++,
        "user",
        "CURRENT_TAIL 现在就改 login.ts:88，测过再提交。JWT helper 仍然不许动。",
      ),
    ),
  );
  return out;
}

const MUST_KEEP_IN_TAIL = [
  "CURRENT_TAIL",
  "login.ts:88",
  "JWT helper 仍然不许动",
];

const SHOULD_SURVIVE_SOMEWHERE = [
  "不要改 JWT",
  "我改口了",
  "cookie 过期",
  "ttlMs",
  "test-401.txt",
  "session-store.ts",
  "EADDRINUSE",
  "expires mid-request",
];

function hits(text: string, needles: string[]): { hit: string[]; miss: string[] } {
  const hit: string[] = [];
  const miss: string[] = [];
  for (const n of needles) (text.includes(n) ? hit : miss).push(n);
  return { hit, miss };
}

describe("fold efficacy probe", () => {
  it("runs a long session through micro-compact then 80% fold, twice", async () => {
    const dir = mkdtempSync(join(tmpdir(), "maou-efficacy-"));
    try {
      let history = buildLongBugSession();
      const afterMicro = applyRoundMicroCompact(history, 24, undefined, 3);
      history = afterMicro.history;

      const tokensBefore = estimateTokens(history);
      const charsBefore = visible(history).length;

      const first = await compressMaou(history, {
        maxTokens: WINDOW,
        knownTokens: Math.floor(WINDOW * 0.84),
        sessionRoot: dir,
        retainCount: Math.max(1, Math.floor(history.length * 0.16)),
      });
      history = first.history;

      const grown = history.concat(
        msg(900, "assistant", "改完 login.ts:88，cookie 改成 30min。"),
        msg(901, "tool_result", `${"ok ".repeat(200)} still running suite`, {
          toolName: "use_terminal",
        }),
        ...Array.from({ length: 12 }, (_, i) =>
          msg(910 + i, i % 2 === 0 ? "user" : "assistant", `尾巴补充 ${i} ${"n".repeat(80)}`),
        ),
        msg(999, "user", "CURRENT_TAIL 测过了吗？JWT helper 仍然不许动。"),
      );

      const second = await compressMaou(grown, {
        maxTokens: WINDOW,
        knownTokens: Math.floor(WINDOW * 0.86),
        sessionRoot: dir,
        retainCount: Math.max(1, Math.floor(grown.length * 0.16)),
        summarizer: async () =>
          [
            "## Primary Request and Intent",
            "- 修 auth 401；用户改口：只动 cookie 过期，禁止改 JWT helper",
            "## Files and Code",
            "- core/context/src/session-store.ts ttlMs=30min",
            "- src/auth/login.ts:88 cookie.expires 写成了 24h",
            "## Errors and Fixes",
            "- expires mid-request 401；EADDRINUSE 8787 先杀旧进程",
            "## Next Step",
            "- 改 login.ts:88 后跑测试再提交",
          ].join("\n"),
      });

      const text1 = visible(first.history);
      const text2 = visible(second.history);
      const tail1 = hits(text1, MUST_KEEP_IN_TAIL);
      const facts1 = hits(text1, SHOULD_SURVIVE_SOMEWHERE);
      const facts2 = hits(text2, SHOULD_SURVIVE_SOMEWHERE);
      const tokensAfter1 = estimateTokens(first.history);
      const tokensAfter2 = estimateTokens(second.history);

      const report = {
        window: WINDOW,
        messages: {
          built: buildLongBugSession().length,
          afterMicro: afterMicro.history.length,
          afterFirstFold: first.history.length,
          afterSecond: second.history.length,
        },
        stages: { first: first.stage, second: second.stage },
        tokens: {
          afterMicro: tokensBefore,
          afterFirstFold: tokensAfter1,
          afterSecond: tokensAfter2,
          firstCut: `${Math.round((1 - tokensAfter1 / tokensBefore) * 100)}%`,
        },
        chars: { before: charsBefore, afterFirst: text1.length, afterSecond: text2.length },
        tailIntact: tail1.miss.length === 0,
        tailMiss: tail1.miss,
        factsAfterFirst: facts1,
        factsAfterSecond: facts2,
        foldCards: first.history.filter((m) => m.compact?.type === "fold").length,
        archiveCards: second.history.filter((m) => m.compact?.type === "archive").length,
        foldPreview: text1
          .split("\n")
          .filter((l) => l.startsWith("- [") || l.startsWith("<folded") || l.startsWith("<archived"))
          .slice(0, 24),
      };

      // eslint-disable-next-line no-console
      console.log("\n[fold-efficacy]\n" + JSON.stringify(report, null, 2));

      expect(first.stage === "summaryStage" || first.stage === "archiveStage").toBe(true);
      expect(tail1.miss).toEqual([]);
      expect(first.history.length).toBeLessThan(afterMicro.history.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
