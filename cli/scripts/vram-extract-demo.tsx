/**
 * vram-extract-demo —— 验证从显存(lastGrid)提取选区文字是否完整。
 *
 * 用 ink-testing-library 渲染含 CJK / emoji / 多行 / soft-wrap / 带样式 的内容，
 * 调 initVramLayer patch Output.get（lastGrid 在每帧 get 里被填充），
 * 再 setSelection + extractSelection，比对"原文 vs 提取文本"。
 *
 * 跑法：cd cli && pnpm dlx tsx scripts/vram-extract-demo.tsx
 */
import React from "react";
import { Text, Box } from "ink";
import { render as inkTestRender } from "ink-testing-library";

import {
  initVramLayer,
  setSelection,
  extractSelection,
  clearSelection,
} from "../src/render/vram-layer.js";

/** 临时把 extractSelection 用的 stdout 尺寸钉成 100x10（对齐 ink-testing 的 100 列）。
 *  vram-layer 内部读 process.stdout.columns/rows，这里 mock 一下。 */
function withStdoutSize(cols: number, rows: number, fn: () => string): string {
  const real = process.stdout as any;
  const oc = real.columns, or_ = real.rows;
  real.columns = cols; real.rows = rows;
  try { return fn(); } finally { real.columns = oc; real.rows = or_; }
}

interface Case {
  name: string;
  render: () => React.ReactElement;
  /** 选区：1-based [startRow,startCol]→[endRow,endCol]，对齐 ink-testing 的 100 列视口 */
  sel: [[number, number], [number, number]];
  expect: string;
}

const cases: Case[] = [
  {
    name: "纯 ASCII 单行",
    render: () => <Text>{"Hello World"}</Text>,
    sel: [[1, 1], [1, 11]],
    expect: "Hello World",
  },
  {
    name: "CJK 单行（每个字占 2 列）",
    render: () => <Text>{"你好世界测试"}</Text>,
    sel: [[1, 1], [1, 12]],
    expect: "你好世界测试",
  },
  {
    name: "ASCII+CJK 混排",
    render: () => <Text>{"ab你好cd世界"}</Text>,
    sel: [[1, 1], [1, 13]],
    expect: "ab你好cd世界",
  },
  {
    name: "emoji（代理对，占 2 列）",
    render: () => <Text>{"a🎉b😂c"}</Text>,
    sel: [[1, 1], [1, 9]],
    expect: "a🎉b😂c",
  },
  {
    name: "多行（\\n 分隔）",
    render: () => (<Box flexDirection="column">
      <Text>第一行abc</Text>
      <Text>第二行def</Text>
      <Text>第三行ghi</Text>
    </Box>),
    // 每行视觉宽 9（3 CJK×2 + 3 ASCII），选满三行：[1,1]→[3,9]
    sel: [[1, 1], [3, 9]],
    expect: "第一行abc\n第二行def\n第三行ghi",
  },
  {
    name: "带颜色样式（不应影响提取）",
    render: () => <Text color="red" bold>{"红色加粗文字ABC"}</Text>,
    // 7 CJK×2=14 + ABC=3 = 17 视觉列
    sel: [[1, 1], [1, 17]],
    expect: "红色加粗文字ABC",
  },
  {
    name: "Box 带边框 + 内容（多行选区，尾行带行首边框——固有局限）",
    render: () => (<Box borderStyle="single" flexDirection="column">
      <Text>框内文字</Text>
      <Text>第二排</Text>
    </Box>),
    // 边框在第1列/末列；内容从第2列起(1-based)。框内文字=8列(2~9)，第二排=6列(2~7)。
    // 多行选区 [2,2]→[3,7]：首行从内容起，算法用"连续2空格"止于内容结尾→"框内文字"。
    // 尾行从行首(列1)开始选，列1是左边框│→带"│第二排"。这是 TUI 选区跨行首的固有行为，
    // 与 Claude Code 一致：显存无法区分边框与内容，行首在边框上则带边框。
    sel: [[2, 2], [3, 7]],
    expect: "框内文字\n│第二排",
  },
  {
    name: "Box 单行选区严格落在内容列内（不带边框）",
    render: () => (<Box borderStyle="single" flexDirection="column">
      <Text>框内文字</Text>
      <Text>第二排</Text>
    </Box>),
    // 单行选区 [2,2]→[2,9]：起点终点都落在内容列(2~9)，不触碰边框
    sel: [[2, 2], [2, 9]],
    expect: "框内文字",
  },
];

async function main() {
  await initVramLayer();
  let pass = 0, fail = 0;
  for (const c of cases) {
    // ink-testing 渲染一帧 → 触发 Output.get() → lastGrid 被填
    const { unmount } = inkTestRender(c.render());
    // 给 ink 一拍完成渲染（同步 render 已写入 lastGrid）
    setSelection(
      { row: c.sel[0][0], col: c.sel[0][1] },
      { row: c.sel[1][0], col: c.sel[1][1] },
    );
    const got = withStdoutSize(100, 10, () => extractSelection());
    clearSelection();
    unmount();
    const ok = got === c.expect;
    console.log(`${ok ? "✅" : "❌"} ${c.name}`);
    if (!ok) {
      fail++;
      console.log(`  expect: ${JSON.stringify(c.expect)}`);
      console.log(`  got   : ${JSON.stringify(got)}`);
      // 额外 dump lastGrid 该区域，辅助定位
    } else pass++;
  }
  console.log(`\n${pass} pass, ${fail} fail / ${cases.length} total`);
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
