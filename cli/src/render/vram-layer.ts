/**
 * vram-layer —— 显存提取渲染层。
 *
 * monkey-patch Ink 的 Output.get，拦截渲染结果字符串（含 SGR + 文本 + \n），
 * 建二维字符网格（含样式 + 宽字符），注入选区蓝底/hover 后输出到真实 stdout。
 *
 * 用户用普通 <Text>/<Box> 即可，不需要 SelectableText。选区蓝底（含空格、边框）。
 * 光标只有输入框软光标（TextArea 的 \x1b[7m 反显，在 cell.sgr 里），无 hover 伪光标。
 */

import { PassThrough } from "node:stream";
import stringWidth from "string-width";

export interface GridCell {
  ch: string;
  sgr: string;
  w: number;
}

export type Selection = { start: { row: number; col: number }; end: { row: number; col: number } } | null;

let selAnchor: { row: number; col: number } | null = null;
let selFocus: { row: number; col: number } | null = null;

export function setSelection(start: { row: number; col: number } | null, end: { row: number; col: number } | null) {
  selAnchor = start; selFocus = end;
}
export function getSelection(): Selection {
  return selAnchor && selFocus ? { start: selAnchor, end: selFocus } : null;
}
export function clearSelection() { selAnchor = null; selFocus = null; }

// 主题背景色（渲染层统一填充用）。渲染层是 React 外的同步函数，靠 setThemeBg 接收当前主题。
// App 在主题变化时调用；index.tsx 首次渲染前用 TAU_CETI.bg 兜底。
let themeBgSgr = ""; // e.g. "\x1b[48;2;12;10;8m"

/** 注册当前主题背景色，使未显式设 backgroundColor 的空白格显示主题 bg 而非终端默认底。 */
export function setThemeBg(bg: string | null): void {
  if (!bg) { themeBgSgr = ""; return; }
  const m = /^#?([0-9a-f]{6})$/i.exec(bg.trim());
  if (!m) { themeBgSgr = ""; return; }
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  themeBgSgr = `\x1b[48;2;${r};${g};${b}m`;
}

function inSel(r: number, c: number): boolean {
  if (!selAnchor || !selFocus) return false;
  const r0 = r - 1, c0 = c - 1;
  let r1: number, c1: number, r2: number, c2: number;
  if (selAnchor.row < selFocus.row || (selAnchor.row === selFocus.row && selAnchor.col <= selFocus.col)) {
    r1 = selAnchor.row - 1; c1 = selAnchor.col - 1; r2 = selFocus.row - 1; c2 = selFocus.col - 1;
  } else {
    r1 = selFocus.row - 1; c1 = selFocus.col - 1; r2 = selAnchor.row - 1; c2 = selAnchor.col - 1;
  }
  return r0 >= r1 && r0 <= r2 && (r0 > r1 || c0 >= c1) && (r0 < r2 || c0 <= c2);
}

// Output.prototype 由 initVramLayer 传入（动态 import 拿，避免 createRequire 的 ESM 问题）
let OutputProto: any = null;
let lastInkOutput = "";
// Ink 内部 cell 形状（含 type/value/fullWidth/styles），用 any 避免与 Ink 内部类型硬绑
let lastGrid: any[][] | null = null;
let origGet: any = null;
// styledCharsToString 在 initVramLayer 里一次性 import 缓存，避免每次 get() 都动态 import
let styledCharsToString: ((chars: any[]) => string) | null = null;
// sliceAnsi：clip 水平截断用（保留 ANSI 样式）。从 ink 的 output.js 所在目录解析（ink 直接依赖）。
let sliceAnsi: ((input: string, begin: number, end: number) => string) | null = null;

export async function initVramLayer() {
  if (origGet) return; // 已初始化
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const req = createRequire(import.meta.url);
  const inkPath = req.resolve("ink");
  const outputJsPath = inkPath.replace(/index\.js$/, "output.js");
  const mod = await import(pathToFileURL(outputJsPath).href);
  OutputProto = mod.default.prototype;
  origGet = OutputProto.get;
  // 从 ink 的 output.js 目录解析 slice-ansi（它是 ink 的直接依赖，cli 自身未声明）。
  // slice-ansi@9 是纯 ESM 包（type:module），不能用 createRequire(require) 加载，
  // 需 resolve 路径后 pathToFileURL 再 ESM import（与 styledCharsToString 同类处理）。
  const reqFromInk = createRequire(pathToFileURL(outputJsPath).href);
  const sliceAnsiPath = reqFromInk.resolve("slice-ansi");
  const sliceAnsiMod = await import(pathToFileURL(sliceAnsiPath).href);
  sliceAnsi = sliceAnsiMod.default ?? sliceAnsiMod;
  // 一次性 import 缓存（get 是同步函数，不能在里面 await import）
  // ansi-tokenize 是纯 ESM 包（type:module，仅 import 条件），用 ESM import 命中 exports map。
  styledCharsToString = (await import("@alcalzone/ansi-tokenize")).styledCharsToString;
  // 重写 get：复制内部逻辑，在转字符串前把二维数组存到 lastGrid
  OutputProto.get = function () {
    // 复制 get 的内部逻辑：建 output[][]，遍历 operations 填充
    const output: any[][] = [];
    for (let y = 0; y < this.height; y++) {
      const row: any[] = [];
      for (let x = 0; x < this.width; x++) {
        row.push({ type: "char", value: " ", fullWidth: false, styles: [] });
      }
      output.push(row);
    }
    const clips: any[] = [];
    for (const operation of this.operations) {
      if (operation.type === "clip") clips.push(operation.clip);
      if (operation.type === "unclip") clips.pop();
      if (operation.type === "write") {
        const { text, transformers } = operation;
        let { x, y } = operation;
        let lines = text.split("\n");
        const clip = clips.at(-1);
        // clip 处理：Ink 的 Box overflow:hidden 会设 clip 矩形，超出区域的内容必须截断，
        // 否则 ScrollHistory 用 marginTop 负值滚动时溢出内容会写入下方行（InputBar 等）的网格，
        // 表现为"滚动内容穿透"。原版 output.js get() 用 sliceAnsi 水平截断 + lines.slice 垂直截断。
        if (clip) {
          const clipHorizontally = typeof clip?.x1 === "number" && typeof clip?.x2 === "number";
          const clipVertically = typeof clip?.y1 === "number" && typeof clip?.y2 === "number";
          // 文本整体在裁剪区外则跳过该 write
          if (clipHorizontally) {
            const width = this.caches.getWidestLine(text);
            if (x + width < clip.x1 || x > clip.x2) continue;
          }
          if (clipVertically) {
            const height = lines.length;
            if (y + height < clip.y1 || y > clip.y2) continue;
          }
          // 水平截断：每行按 [x1, x2] 切，保留 ANSI 样式
          if (clipHorizontally) {
            lines = lines.map((line: string) => {
              const from = x < clip.x1 ? clip.x1 - x : 0;
              const width = this.caches.getStringWidth(line);
              const to = x + width > clip.x2 ? clip.x2 - x : width;
              return sliceAnsi!(line, from, to);
            });
            if (x < clip.x1) {
              x = clip.x1;
            }
          }
          // 垂直截断：丢掉超出 [y1, y2] 的行
          if (clipVertically) {
            const from = y < clip.y1 ? clip.y1 - y : 0;
            const height = lines.length;
            const to = y + height > clip.y2 ? clip.y2 - y : height;
            lines = lines.slice(from, to);
            if (y < clip.y1) {
              y = clip.y1;
            }
          }
        }
        let offsetY = 0;
        for (const [index, line] of lines.entries()) {
          const currentLine = output[y + offsetY];
          if (!currentLine) { offsetY++; continue; }
          let curLine = line;
          for (const transformer of (transformers ?? [])) {
            curLine = transformer(curLine, index);
          }
          const characters = this.caches.getStyledChars(curLine);
          let offsetX = x;
          if (characters.length === 0) { offsetY++; continue; }
          const spaceCell = { type: "char", value: " ", fullWidth: false, styles: [] };
          if (currentLine[offsetX]?.value === "" && offsetX > 0 &&
              this.caches.getStringWidth(currentLine[offsetX - 1]?.value ?? "") > 1) {
            currentLine[offsetX - 1] = spaceCell;
          }
          for (const character of characters) {
            currentLine[offsetX] = character;
            const characterWidth = Math.max(1, this.caches.getStringWidth(character.value));
            if (characterWidth > 1) {
              for (let i = 1; i < characterWidth; i++) {
                currentLine[offsetX + i] = {
                  type: "char", value: "", fullWidth: false, styles: character.styles,
                };
              }
            }
            offsetX += characterWidth;
          }
          if (currentLine[offsetX]?.value === "") currentLine[offsetX] = spaceCell;
          offsetY++;
        }
      }
    }
    // 存二维数组供 extractSelection 直接用（不丢字符）
    lastGrid = output;
    // 转字符串（用 initVramLayer 缓存的 styledCharsToString，保持 get 同步）
    const fn = styledCharsToString!;
    const generatedOutput = output
      .map(line => {
        const lineWithoutEmptyItems = line.filter((item: any) => item !== undefined);
        return fn(lineWithoutEmptyItems).trimEnd();
      })
      .join("\n");
    lastInkOutput = generatedOutput;
    return { output: generatedOutput, height: output.length };
  };
}

export function unpatchOutput() {
  if (origGet && OutputProto) {
    OutputProto.get = origGet;
    origGet = null;
  }
}

export function createFakeStdout(): any {
  const fake: any = new PassThrough();
  fake.isTTY = true;
  fake.columns = process.stdout.columns || 80;
  fake.rows = process.stdout.rows || 24;
  fake.write = () => true;
  fake.setRawMode = () => fake;
  fake.isRaw = false;
  fake.ref = () => fake;
  fake.unref = () => fake;
  fake.resume = () => fake;
  return fake;
}

/** 从 lastGrid（Ink 原始二维数组）直接建 GridCell 网格，不解析字符串，不丢字符 */
function buildGrid(cols: number, rows: number): GridCell[][] {
  const grid: GridCell[][] = [];
  for (let r = 0; r < rows; r++) {
    grid.push(new Array(cols).fill(null).map(() => ({ ch: " ", sgr: "", w: 1 })));
  }
  if (!lastGrid) return grid;
  for (let r = 0; r < Math.min(lastGrid.length, rows); r++) {
    const srcRow = lastGrid[r];
    if (!srcRow) continue;
    for (let c = 0; c < Math.min(srcRow.length, cols); c++) {
      const cell = srcRow[c];
      if (!cell) continue;
      const ch = cell.value || " ";
      // value="" 是宽字符占位列，跳过（主列已记录）
      if (cell.value === "" && c > 0) {
        // 占位列：标记 w=0，不覆盖主列
        const prev = grid[r][c];
        if (prev.w > 0) {
          // 主列已在上一格设好，这里设占位
          grid[r][c] = { ch: "", sgr: "", w: 0 };
        }
        continue;
      }
      const w = stringWidth(ch) || 1;
      // styles 数组转 SGR 字符串
      let sgr = "";
      if (cell.styles && cell.styles.length > 0) {
        // styles 是 ansi-tokenize 的格式，每个含 endCode
        // 简化：直接从 styles 拼接 SGR
        for (const s of cell.styles) {
          if (s?.code) sgr += s.code;
        }
      }
      grid[r][c] = { ch, sgr, w };
      for (let k = 1; k < w && c + k < cols; k++) {
        grid[r][c + k] = { ch: "", sgr, w: 0 };
      }
    }
  }
  return grid;
}

export function renderWithSelection(cols: number, rows: number): void {
  const grid = buildGrid(cols, rows);
  let out = "\x1b[H\x1b[?25l";
  for (let r = 0; r < rows; r++) {
    let line = "";
    // lastSgr 初始为 themeBgSgr：行擦除 \x1b[K 前已发出 themeBgSgr（用主题 bg 清行），
    // 此时终端背景属性已是主题 bg，首个无背景 cell 的 targetSgr=themeBgSgr+cellSgr 开头也是 themeBgSgr，
    // 与 lastSgr 比较时前缀相同可省去冗余输出（实际 targetSgr 含前景码仍会不同，但背景部分不重复设）。
    let lastSgr = themeBgSgr || "\x1b[0m";
    let visW = 0;
    for (let c = 0; c < cols && visW < cols; c++) {
      const cell = grid[r][c];
      if (cell.w === 0) continue;
      if (inSel(r + 1, c + 1)) {
        line += `\x1b[0m${cell.sgr}\x1b[44m${cell.ch}\x1b[0m`;
        lastSgr = "\x1b[0m";
        visW += cell.w;
      } else {
        // 保留 cell.sgr（含 TextArea 软光标的 \x1b[7m 反显等），只在 SGR 变化时输出序列。
        // 空格也带 SGR（textarea 光标反显空格需要）。
        // 不再额外加 hover 反色：hover 反色块会在点击位置残留成"伪光标"，
        // 违背"只有输入框聚焦才有光标"的规则。
        // 渲染层注入主题 bg：未显式设 backgroundColor 的 cell（cell.sgr 不含背景码 48;）
        // 补 themeBgSgr，使空白区域显示主题 bg 而非终端默认底。已有背景的 cell 保留原 SGR。
        const cellSgr = cell.sgr || "";
        const hasBg = cellSgr.includes("48;");
        const targetSgr = (!hasBg && themeBgSgr) ? themeBgSgr + cellSgr : (cellSgr || "\x1b[0m");
        if (targetSgr !== lastSgr) {
          // SGR 变化时先 \x1b[0m reset 再设新 SGR——避免上一格的反显(\x1b[7m)等属性泄漏到本格
          line += `\x1b[0m${targetSgr}`;
          lastSgr = targetSgr;
        }
        line += cell.ch;
        visW += cell.w;
      }
    }
    // 行擦除：先 themeBgSgr 再 \x1b[K，使 \x1b[K 用主题 bg 清行而非终端默认底（透明感根因）。
    out += `\x1b[${r + 1};1H${themeBgSgr}\x1b[K${line}`;
  }
  out += "\x1b[0m\x1b[?25l";
  process.stdout.write(out);
}

export function extractSelection(): string {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const grid = buildGrid(cols, rows);
  if (!selAnchor || !selFocus) return "";
  let r1: number, c1: number, r2: number, c2: number;
  if (selAnchor.row < selFocus.row || (selAnchor.row === selFocus.row && selAnchor.col <= selFocus.col)) {
    r1 = selAnchor.row - 1; c1 = selAnchor.col - 1; r2 = selFocus.row - 1; c2 = selFocus.col - 1;
  } else {
    r1 = selFocus.row - 1; c1 = selFocus.col - 1; r2 = selAnchor.row - 1; c2 = selAnchor.col - 1;
  }
  // 起点若落在宽字符占位列（w===0），回退到主列，否则首字符会丢
  if (r1 >= 0 && r1 < rows && c1 >= 0 && c1 < cols) {
    while (c1 > 0 && grid[r1][c1].w === 0) c1--;
  }
  // 起点若落在空白区，前进到第一个有内容的列（避免从边框/padding 起步）
  if (r1 >= 0 && r1 < rows && c1 >= 0 && c1 < cols) {
    while (c1 < cols - 1 && grid[r1][c1].ch === " " && grid[r1][c1].w === 1) c1++;
  }
  // 终点若落在占位列，前进到主列，否则末字符会少（宽字符的主列在占位列左侧）
  if (r2 >= 0 && r2 < rows && c2 >= 0 && c2 < cols) {
    while (c2 < cols - 1 && grid[r2][c2].w === 0) c2++;
  }
  // 终点若落在空白区，回退到最后一个有内容的列（避免越过内容抓到边框/padding）
  if (r2 >= 0 && r2 < rows && c2 >= 0 && c2 < cols) {
    while (c2 > 0 && grid[r2][c2].ch === " " && grid[r2][c2].w === 1) c2--;
  }
  const lines: string[] = [];
  for (let r = r1; r <= r2; r++) {
    if (r < 0 || r >= rows) continue;
    // 每行内容边界：第一个/最后一个"有内容的列"（w>0 且非空格）。
    // 保留行内所有空格（缩进、对齐、多空格），只 trim 首尾 padding/边框空白。
    // 不再用"连续≥2空格=内容结束"启发式——那会截断代码缩进、列表前导空格、行内多空格。
    let firstContent = -1;
    let lastContent = -1;
    for (let c = 0; c < cols; c++) {
      const cell = grid[r][c];
      if (cell.w > 0 && cell.ch !== " ") {
        if (firstContent < 0) firstContent = c;
        lastContent = c;
      }
    }
    // 该行无内容（纯空白行）：保留为空行（跨行选区中间的空行不该丢）
    if (firstContent < 0) {
      lines.push("");
      continue;
    }
    // 首行从选区起点 c1 起（已对齐到内容），但不越过行首内容；
    // 中间行从 col 0 起取完整行（保留代码缩进/列表前导/对齐空格——蓝底也是整行覆盖），
    //   只 trimEnd 去掉行尾到边框的 padding；
    // 尾行从行首内容起，到选区终点 c2 止（已对齐）。
    const cs = r === r1 ? Math.max(c1, firstContent) : r === r2 ? firstContent : 0;
    const ce = r === r2 ? Math.min(c2, lastContent) : lastContent;
    const chars: string[] = [];
    for (let c = cs; c <= ce; c++) {
      if (c < 0 || c >= cols) continue;
      const cell = grid[r][c];
      if (cell.w === 0) continue; // 宽字符占位列，主列已记录字符
      chars.push(cell.ch);
    }
    lines.push(chars.join("").trimEnd());
  }
  return lines.join("\n");
}

/** 判断字符类型：英文/数字/中文/其他（分隔符） */
function charType(ch: string): "word" | "cjk" | "other" {
  if (ch === " " || ch === "") return "other";
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x4e00 && code <= 0x9fff) return "cjk"; // CJK 统一汉字
  if (code >= 0x3400 && code <= 0x4dbf) return "cjk"; // CJK 扩展A
  if (code >= 0x3000 && code <= 0x30ff) return "cjk"; // CJK 标点/假名
  if (code >= 0xff00 && code <= 0xffef) return "cjk"; // 全角字符
  if (/[a-zA-Z0-9_]/.test(ch)) return "word";
  return "other";
}

/** 从网格 (row, col) 查找词边界，返回 {startCol, endCol}（1-based 屏幕坐标） */
export function findWordAt(row: number, col: number): { startCol: number; endCol: number } {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const grid = buildGrid(cols, rows);
  const r = row - 1;
  const c = col - 1;
  if (r < 0 || r >= rows || c < 0 || c >= cols) return { startCol: col, endCol: col };

  const cell = grid[r][c];
  const ch = cell.ch;
  const type = charType(ch);

  if (type === "other") {
    // 标点/空格：单独一个字符为一个"词"
    return { startCol: col, endCol: col };
  }

  // 向左找词起点
  let startC = c;
  while (startC > 0 && charType(grid[r][startC - 1].ch) === type) startC--;
  // 向右找词终点
  let endC = c;
  while (endC < cols - 1 && charType(grid[r][endC + 1].ch) === type) endC++;

  return { startCol: startC + 1, endCol: endC + 1 }; // 转 1-based
}

/** 查找整行边界，返回 {startCol, endCol}（1-based） */
export function findLineBoundaries(row: number): { startCol: number; endCol: number } {
  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 24;
  const grid = buildGrid(cols, rows);
  const r = row - 1;
  if (r < 0 || r >= rows) return { startCol: 1, endCol: 1 };

  // 找行首（第一个非空格）
  let startC = 0;
  while (startC < cols && grid[r][startC].ch === " ") startC++;
  // 找行尾（最后一个非空格）
  let endC = cols - 1;
  while (endC >= 0 && grid[r][endC].ch === " ") endC--;
  if (endC < startC) { startC = 0; endC = 0; }

  return { startCol: startC + 1, endCol: endC + 1 };
}
