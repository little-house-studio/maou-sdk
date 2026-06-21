/**
 * char-canvas 助手 —— 生成可塞进 Ink <Text> 的字符串
 * 盲文亚像素 + 块填充 + 渐变 + sparkline + 3D 线框
 */

// ── 盲文：每字符 2×4 点 ──────────────────────────────────────────────────────
// 点位 bit:  1=0x01 4=0x08 / 2=0x02 5=0x10 / 3=0x04 6=0x20 / 7=0x40 8=0x80
const BRAILLE_BASE = 0x2800;
/** 一个字符宽=2点，高=4点。给定像素网格（点开/关），转成盲文字符串行 */
export function brailleFromGrid(width: number, height: number, on: (x: number, y: number) => boolean): string[] {
  const cols = Math.ceil(width / 2);
  const rows = Math.ceil(height / 4);
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      let bits = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const x = c * 2 + dx, y = r * 4 + dy;
          if (x < width && y < height && on(x, y)) {
            const dotMap = [0x01, 0x02, 0x04, 0x40, 0x08, 0x10, 0x20, 0x80];
            bits |= dotMap[dy * 2 + dx];
          }
        }
      }
      line += String.fromCharCode(BRAILLE_BASE + bits);
    }
    out.push(line);
  }
  return out;
}

// ── 块字符填充（贴图质感）──────────────────────────────────────────────────
const BLOCK_RAMP = [" ", "·", "░", "▒", "▓", "█"]; // 0..1 → 6 级
export function blockFor(v: number): string {
  const i = Math.max(0, Math.min(BLOCK_RAMP.length - 1, Math.round(v * (BLOCK_RAMP.length - 1))));
  return BLOCK_RAMP[i]!;
}

// ── Gauge（血条）─────────────────────────────────────────────────────────────
/** 生成血条字符串，宽 w，进度 ratio 0..1，填充/空字符 + 分段 */
export function gaugeBar(ratio: number, w: number, fill = "▰", empty = "▱"): string {
  const r = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(r * w);
  return fill.repeat(filled) + empty.repeat(Math.max(0, w - filled));
}

// ── Sparkline（彩色函数曲线 + 填充）────────────────────────────────────────
/** 数值序列 → 盲文曲线（亚像素），返回每行字符串；填充曲线下方 */
export function sparkline(values: number[], width: number, height = 4): string[] {
  if (values.length === 0) return new Array(Math.ceil(height / 4)).fill("");
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const step = Math.max(1, values.length / width);
  const ny: number[] = [];
  for (let i = 0; i < width; i++) {
    const v = values[Math.floor(i * step)] ?? min;
    ny.push(Math.round((1 - (v - min) / range) * (height - 1))); // 大值在上
  }
  return brailleFromGrid(width, height, (x, y) => {
    const py = ny[x] ?? height;
    return y >= py; // 从曲线向下填充
  });
}

// ── 3D 线框（旋转）─────────────────────────────────────────────────────────
type Vec3 = [number, number, number];
export type WireModel = { verts: Vec3[]; edges: [number, number][] };

export const CUBE: WireModel = {
  verts: [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]],
  edges: [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]],
};

export const CRYSTAL: WireModel = {
  verts: [[0,-1.2,0],[0,1.2,0],[-1,0,-1],[1,0,-1],[1,0,1],[-1,0,1]],
  edges: [[0,2],[0,3],[0,4],[0,5],[1,2],[1,3],[1,4],[1,5],[2,3],[3,4],[4,5],[5,2]],
};

/** 渲染旋转线框（盲文），返回字符串行。ax/ay/az 为弧度。 */
export function renderWireframe(model: WireModel, width: number, height: number, ax: number, ay: number, az: number, scale = 1): string[] {
  const rotate = (v: Vec3, ax: number, ay: number, az: number): Vec3 => {
    let [x, y, z] = v;
    // X
    let cy = Math.cos(ax), sy = Math.sin(ax);
    [y, z] = [y * cy - z * sy, y * sy + z * cy];
    // Y
    let cx = Math.cos(ay), sx = Math.sin(ay);
    [x, z] = [x * cx + z * sx, -x * sx + z * cx];
    // Z
    let cz = Math.cos(az), sz = Math.sin(az);
    [x, y] = [x * cz - y * sz, x * sz + y * cz];
    return [x, y, z];
  };
  const projected = model.verts.map((v) => {
    const [x, y, z] = rotate(v, ax, ay, az);
    const persp = 3 / (3 + z);
    return [x * persp * scale, y * persp * scale] as [number, number];
  });
  const pw = width * 2, ph = height * 4;
  const cx = pw / 2, cy = ph / 2;
  const pxW = pw / 4, pxH = ph / 4;
  const grid: boolean[][] = Array.from({ length: ph }, () => new Array(pw).fill(false));
  const plot = (x: number, y: number) => {
    const ix = Math.round(x), iy = Math.round(y);
    if (iy >= 0 && iy < ph && ix >= 0 && ix < pw) grid[iy]![ix] = true;
  };
  for (const [a, b] of model.edges) {
    const [x0, y0] = projected[a]!, [x1, y1] = projected[b]!;
    const X0 = cx + x0 * pxW, Y0 = cy + y0 * pxH, X1 = cx + x1 * pxW, Y1 = cy + y1 * pxH;
    // Bresenham
    let xi = X0, yi = Y0;
    const dx = Math.abs(X1 - X0), dy = Math.abs(Y1 - Y0);
    const sx = X0 < X1 ? 1 : -1, sy = Y0 < Y1 ? 1 : -1;
    let err = dx - dy;
    for (let i = 0; i < 1000; i++) {
      plot(xi, yi);
      if (Math.abs(xi - X1) < 0.5 && Math.abs(yi - Y1) < 0.5) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; xi += sx; }
      if (e2 < dx) { err += dx; yi += sy; }
    }
  }
  return brailleFromGrid(pw, ph, (x, y) => grid[y]?.[x] ?? false);
}
