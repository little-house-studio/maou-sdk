/**
 * ink-scroll-bench —— 同栈最小滚动帧率 Demo
 *
 * 【推荐：自动测，不用滚、不用从屏幕复制】
 *   cd .../maou-sdk/cli
 *   npm run bench:scroll:pure
 *   npm run bench:scroll:vram
 *   npm run bench:scroll:heavy
 *   cat scroll-bench-result.txt   ← 把这个文件内容发给 AI
 *
 * 交互（可选）：滚轮 / ↑↓ / j k · a 自动 · q 退出
 *   pnpm dlx tsx scripts/ink-scroll-bench.tsx --mode vram --lines 86 --mount full
 */

import React, { useEffect, useSyncExternalStore, useState } from "react";
import { render, Box, Text, useInput, useApp } from "ink";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

// ── CLI args ──────────────────────────────────────────────
function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=").slice(1).join("=");
  return def;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const LINES = Math.max(10, Number(arg("lines", "86")) || 86);
const MODE = (arg("mode", "vram") as "pure" | "vram");
const HEAVY = flag("heavy");
const AUTO = flag("auto");
const AUTO_MS = Math.max(3000, Number(arg("auto-ms", "6000")) || 6000);
const VIEW_H = Math.max(8, Number(arg("view", "30")) || 30);
const MOUNT = (arg("mount", "full") as "full" | "viewport");
const RESULT_FILE = resolve(process.cwd(), "scroll-bench-result.txt");

// ── 模块级滚动状态（不依赖 React effect，AUTO 必达）────────
const contentH = LINES * (HEAVY ? 3 : 1);
// 用「行条目数」更准
const ITEM_COUNT = LINES;
const maxScroll = Math.max(0, ITEM_COUNT - VIEW_H);

let fromBottom = 0;
let scrollNotches = 0;
let lastDelta = 0;
let autoDir = 1;
const scrollListeners = new Set<() => void>();

function emitScroll() {
  for (const l of scrollListeners) l();
}

function applyScroll(deltaFromBottom: number) {
  if (deltaFromBottom === 0) return;
  scrollNotches += Math.abs(deltaFromBottom);
  lastDelta = deltaFromBottom;
  fromBottom = Math.max(0, Math.min(maxScroll, fromBottom + deltaFromBottom));
  emitScroll();
}

function subscribeScroll(cb: () => void) {
  scrollListeners.add(cb);
  return () => {
    scrollListeners.delete(cb);
  };
}
function getFromBottom() {
  return fromBottom;
}
function getScrollMeta() {
  return { scrollNotches, lastDelta, maxScroll };
}

// ── FPS ───────────────────────────────────────────────────
let inkFrames = 0;
let paintFrames = 0;
let lastReport = Date.now();
const reportLines: string[] = [];

function onInkFrame() {
  inkFrames++;
}
function onPaintFrame() {
  paintFrames++;
}

function takeReport(): string {
  const now = Date.now();
  const dt = Math.max(1, now - lastReport) / 1000;
  const ink = Math.round((inkFrames / dt) * 10) / 10;
  const pnt = Math.round((paintFrames / dt) * 10) / 10;
  inkFrames = 0;
  paintFrames = 0;
  lastReport = now;
  const rss = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const meta = getScrollMeta();
  return (
    `ink=${ink}/s paint=${pnt}/s rss=${rss}M lines=${LINES} mode=${MODE}` +
    `${HEAVY ? "+heavy" : ""} mount=${MOUNT} notches=${meta.scrollNotches} fb=${fromBottom}/${meta.maxScroll}`
  );
}

function logLine(msg: string) {
  process.stderr.write(msg + "\n");
  try {
    appendFileSync(RESULT_FILE, msg + "\n", "utf8");
  } catch {
    /* ignore */
  }
}

function initResultFile() {
  const head = [
    `# maou ink-scroll-bench result`,
    `# time=${new Date().toISOString()}`,
    `# mode=${MODE} lines=${LINES} heavy=${HEAVY} mount=${MOUNT} auto=${AUTO} autoMs=${AUTO_MS}`,
    `# cwd=${process.cwd()}`,
    `# result=${RESULT_FILE}`,
    ``,
  ].join("\n");
  writeFileSync(RESULT_FILE, head, "utf8");
  logLine(`[bench] 结果写入 → ${RESULT_FILE}`);
}

function writeSummary(tag: string) {
  logLine("");
  logLine(`[bench] === ${tag} ===`);
  for (const l of reportLines) logLine(`[bench] ${l}`);
  logLine(`[bench] final: ${takeReport()}`);
  logLine(`[bench] 文件: ${RESULT_FILE}`);
  logLine(`[bench] 把 scroll-bench-result.txt 全文发给 AI 即可（不用截屏复制）`);
}

// ── 内容 ──────────────────────────────────────────────────
function makeLines(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    if (HEAVY) {
      out.push(`◈ ↺${i} | agent:coding | ↓${100 + (i % 400)}`);
      out.push(`  第 ${i} 条模拟消息 · 中文 ASCII mix yoga width test`);
      out.push(`  │ cell · path/file.ts · \\w+`);
    } else {
      out.push(
        `L${String(i).padStart(4, "0")}  plain scroll bench — 中文宽度 abcdef ${i}`,
      );
    }
  }
  return out;
}
const ALL_LINES = makeLines(LINES);

// ── 鼠标滚轮 ──────────────────────────────────────────────
const MOUSE_RE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;
function enableMouse(out: NodeJS.WriteStream) {
  try {
    out.write("\x1b[?1000h\x1b[?1002h\x1b[?1006h");
  } catch {
    /* ignore */
  }
}
function disableMouse(out: NodeJS.WriteStream) {
  try {
    out.write("\x1b[?1006l\x1b[?1002l\x1b[?1000l");
  } catch {
    /* ignore */
  }
}
function parseWheelDelta(chunk: string): number {
  let delta = 0;
  const re = new RegExp(MOUSE_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk))) {
    const btn = parseInt(m[1]!, 10);
    if (btn & 64) delta += btn & 1 ? -1 : 1;
  }
  return delta;
}

// ── UI ────────────────────────────────────────────────────
function Hud() {
  const fb = useSyncExternalStore(subscribeScroll, getFromBottom, getFromBottom);
  const [hud, setHud] = useState("采样中…");
  const meta = getScrollMeta();
  useEffect(() => {
    const id = setInterval(() => {
      setHud(reportLines[reportLines.length - 1] ?? "…");
    }, 500);
    return () => clearInterval(id);
  }, []);
  // 订阅 scroll 以刷新 notches 显示
  useSyncExternalStore(subscribeScroll, getFromBottom, getFromBottom);
  const m = getScrollMeta();
  return (
    <Box flexDirection="column" width="100%">
      <Text color="yellow" bold>
        {`⚡ bench ${MODE}${HEAVY ? "+heavy" : ""} mount=${MOUNT} lines=${LINES}`}
      </Text>
      <Text color="cyan">{hud}</Text>
      <Text color="green" bold>
        {`偏移 ${fb}/${m.maxScroll}  滚过 ${m.scrollNotches} 格  上次Δ ${m.lastDelta}  auto=${AUTO || "按a"}`}
      </Text>
      <Text dimColor>
        {"滚轮或 ↑↓/jk · a自动 · q退出 · 结果在 scroll-bench-result.txt（勿从屏复制）"}
      </Text>
      <Text dimColor>{RESULT_FILE}</Text>
    </Box>
  );
}

function LineRow({ text, heavy }: { text: string; heavy: boolean }) {
  if (!heavy) {
    return (
      <Box width="100%">
        <Text>{text}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" width="100">
      <Box>
        <Text backgroundColor="blue" color="black" bold>
          {" tool "}
        </Text>
        <Text color="gray">{` ${text.slice(0, 50)}`}</Text>
      </Box>
    </Box>
  );
}

function App() {
  const { exit } = useApp();
  const fb = useSyncExternalStore(subscribeScroll, getFromBottom, getFromBottom);
  const mt = ITEM_COUNT > VIEW_H ? -(ITEM_COUNT - VIEW_H - fb) : 0;

  const slice =
    MOUNT === "viewport"
      ? ALL_LINES.slice(Math.max(0, maxScroll - fb), Math.max(0, maxScroll - fb) + VIEW_H)
      : ALL_LINES;

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) {
      writeSummary("EXIT");
      try {
        exit();
      } catch {
        /* ignore */
      }
      setTimeout(() => process.exit(0), 50);
      return;
    }
    if (input === "a") {
      // 手动开自动：模块级 interval 已在 AUTO 时启动；这里补一个
      startAutoLoop();
      return;
    }
    if (key.upArrow || input === "k") applyScroll(1);
    if (key.downArrow || input === "j") applyScroll(-1);
    if (key.pageUp) applyScroll(5);
    if (key.pageDown) applyScroll(-5);
  }, { isActive: true });

  // 鼠标滚轮
  useEffect(() => {
    if (!process.stdin.isTTY) return;
    if (process.stdout.isTTY) enableMouse(process.stdout);
    const onData = (buf: Buffer | string) => {
      const s = typeof buf === "string" ? buf : buf.toString("utf8");
      const d = parseWheelDelta(s);
      if (d) applyScroll(d);
    };
    process.stdin.on("data", onData);
    return () => {
      process.stdin.off("data", onData);
      if (process.stdout.isTTY) disableMouse(process.stdout);
    };
  }, []);

  return (
    <Box flexDirection="column" width="100%" height={VIEW_H + 8}>
      <Hud />
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        height={VIEW_H + 2}
        overflow="hidden"
        width="100%"
      >
        {MOUNT === "full" ? (
          <Box flexDirection="column" marginTop={mt} width="100%">
            {ALL_LINES.map((line, i) => (
              <LineRow key={i} text={line} heavy={HEAVY} />
            ))}
          </Box>
        ) : (
          slice.map((line, i) => (
            <LineRow key={`${fb}-${i}`} text={line} heavy={HEAVY} />
          ))
        )}
      </Box>
    </Box>
  );
}

// ── 模块级自动滚 + 强制收尾（不依赖 React）────────────────
let autoTimer: ReturnType<typeof setInterval> | null = null;
function startAutoLoop() {
  if (autoTimer) return;
  autoTimer = setInterval(() => {
    let next = fromBottom + autoDir * 2;
    if (next >= maxScroll) {
      next = maxScroll;
      autoDir = -1;
    } else if (next <= 0) {
      next = 0;
      autoDir = 1;
    }
    const delta = next - fromBottom;
    if (delta === 0) {
      autoDir *= -1;
      next = fromBottom + autoDir * 2;
    }
    const d = next - fromBottom;
    if (d === 0) return;
    scrollNotches += Math.abs(d);
    lastDelta = d;
    fromBottom = next;
    emitScroll();
  }, 16);
}

function makeFakeStdin(): NodeJS.ReadStream {
  const ee = new EventEmitter() as any;
  ee.isTTY = true;
  ee.setRawMode = () => ee;
  ee.ref = () => ee;
  ee.unref = () => ee;
  ee.readable = true;
  ee.read = () => null;
  return ee;
}

async function main() {
  initResultFile();
  logLine(
    `[bench] start mode=${MODE} lines=${LINES} heavy=${HEAVY} mount=${MOUNT} auto=${AUTO} ttyIn=${Boolean(process.stdin.isTTY)} ttyOut=${Boolean(process.stdout.isTTY)}`,
  );

  // 采样
  const sampleTimer = setInterval(() => {
    const line = takeReport();
    reportLines.push(line);
    if (reportLines.length > 40) reportLines.shift();
    logLine(`[bench] ${line}`);
  }, 2000);

  if (AUTO) {
    startAutoLoop();
    logLine(`[bench] 自动滚 ${AUTO_MS}ms → 结束后 cat scroll-bench-result.txt`);
    // 强制收尾，绝不挂死
    setTimeout(() => {
      clearInterval(sampleTimer);
      if (autoTimer) clearInterval(autoTimer);
      writeSummary("AUTO DONE");
      if (process.stdout.isTTY) disableMouse(process.stdout);
      process.exit(0);
    }, AUTO_MS);
  }

  const stdin = process.stdin.isTTY ? process.stdin : makeFakeStdin();

  if (MODE === "pure") {
    const out = process.stdout.isTTY
      ? process.stdout
      : (() => {
          const f: any = new PassThrough();
          f.isTTY = true;
          f.columns = 120;
          f.rows = 40;
          f.write = () => true;
          return f;
        })();

    render(React.createElement(App), {
      exitOnCtrlC: !AUTO,
      patchConsole: false,
      stdin: stdin as any,
      stdout: out as any,
      onRender: () => {
        onInkFrame();
        onPaintFrame();
      },
    });
    return;
  }

  // vram
  const {
    initVramLayer,
    createFakeStdout,
    scheduleFullPaint,
    setThemeBg,
  } = await import("../src/render/vram-layer.js");
  await initVramLayer();
  setThemeBg("#0a0a12");
  const fakeStdout = createFakeStdout();
  (fakeStdout as any).columns = process.stdout.columns || 120;
  (fakeStdout as any).rows = process.stdout.rows || 40;

  if (process.stdout.isTTY) {
    process.stdout.write(
      "\x1b[?1049h\x1b[H\x1b[2J\x1b[?1000h\x1b[?1002h\x1b[?1006h\x1b[?25l",
    );
  }

  render(React.createElement(App), {
    exitOnCtrlC: !AUTO,
    stdin: stdin as any,
    stdout: fakeStdout as any,
    patchConsole: false,
    onRender: () => {
      onInkFrame();
      scheduleFullPaint();
      onPaintFrame();
    },
  });
  setTimeout(() => scheduleFullPaint(), 80);
}

main().catch((e) => {
  logLine(String(e?.stack || e));
  process.exit(1);
});
