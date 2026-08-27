/**
 * DungeonLab — 复古地牢像素 UI 测试台
 *
 * 架构：
 *  - 主 canvas：纯 2d（不挂 layoutsubtree / 不调 polyfill API）
 *  - DOM HUD：叠层可见，始终可读
 *  - 独立 poly canvas：可选 drawElementImage 实验（不碰主场景）
 *  - canvas-ui：像素按钮 / 血条 / 位图字 + 暖色 Bayer dither
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";
import {
  applyOrderedDither,
  CanvasUi,
  DUNGEON_THEME,
  fillRect,
  pixelText,
} from "./canvas-ui";
import "./dungeon.css";

const TILE = 16;
const MAP_W = 28;
const MAP_H = 16;
const PIXEL_SCALE = 2;

/** 0 floor 1 wall 2 torch 3 chest 4 door 5 slime */
const MAP: number[][] = buildMap();

function buildMap(): number[][] {
  const m: number[][] = [];
  for (let y = 0; y < MAP_H; y++) {
    const row: number[] = [];
    for (let x = 0; x < MAP_W; x++) {
      if (x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1) row.push(1);
      else if ((x + y) % 11 === 0) row.push(1);
      else if (x === 5 && y === 5) row.push(2);
      else if (x === 20 && y === 8) row.push(3);
      else if (x === 14 && y === MAP_H - 2) row.push(4);
      else if (x === 10 && y === 10) row.push(5);
      else row.push(0);
    }
    m.push(row);
  }
  for (let y = 3; y < 7; y++) for (let x = 12; x < 18; x++) m[y]![x] = 0;
  for (let y = 3; y < 7; y++) {
    m[y]![12] = 1;
    m[y]![17] = 1;
  }
  for (let x = 12; x < 18; x++) {
    m[3]![x] = 1;
    m[6]![x] = 1;
  }
  m[6]![14] = 4;
  m[4]![14] = 3;
  return m;
}

/** 暖色地牢 tile 色 */
const TILE_COLORS: Record<number, string> = {
  0: "#2c2418",
  1: "#4a3c28",
  2: "#3a2c1c",
  3: "#3a2810",
  4: "#503020",
  5: "#24301c",
};

type Ctx2dHtml = CanvasRenderingContext2D & {
  drawElementImage?: (
    element: Element,
    dx: number,
    dy: number,
    dw?: number,
    dh?: number,
  ) => void;
};

export function DungeonLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const polyCanvasRef = useRef<HTMLCanvasElement>(null);
  const polyHudRef = useRef<HTMLDivElement>(null);
  const uiRef = useRef(new CanvasUi(DUNGEON_THEME));
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const [hp, setHp] = useState(72);
  const [mp, setMp] = useState(40);
  const [gold, setGold] = useState(128);
  const [log, setLog] = useState<string[]>([
    "* YOU ENTER THE KEEP",
    "* TORCHES FLICKER",
  ]);
  const [dither, setDither] = useState(true);
  const [htmlHud, setHtmlHud] = useState(true);
  const [polyOk, setPolyOk] = useState(false);
  const [polyDrawn, setPolyDrawn] = useState(false);
  const [tick, setTick] = useState(0);
  const player = useRef({ x: 3, y: 3 });
  const tilesetRef = useRef<HTMLImageElement | null>(null);

  const pushLog = useCallback((line: string) => {
    setLog((prev) => [...prev.slice(-8), line]);
  }, []);

  // polyfill 只服务独立实验 canvas；失败不挡主场景
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mod = await import("three-html-render/polyfill");
        mod.installHtmlInCanvasPolyfill?.({ force: false });
        if (!cancelled) setPolyOk(true);
      } catch (e) {
        console.warn("[DungeonLab] polyfill install failed", e);
        if (!cancelled) setPolyOk(false);
      }
    })();
    const img = new Image();
    img.src = "/dungeon/tileset.jpg";
    img.onload = () => {
      tilesetRef.current = img;
    };
    return () => {
      cancelled = true;
    };
  }, []);

  // 锁定主 canvas 纯 2d 上下文
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) {
      console.error("[DungeonLab] getContext(2d) failed");
      return;
    }
    ctx.imageSmoothingEnabled = false;
    ctxRef.current = ctx;
  }, []);

  // game loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      if (now - last > 80) {
        setTick((t) => t + 1);
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // draw — 纯 2d 主场景
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;

    const parent = canvas.parentElement;
    const cssW = Math.max(
      320,
      canvas.clientWidth ||
        parent?.clientWidth ||
        window.innerWidth - 260 ||
        640,
    );
    const cssH = Math.max(
      280,
      canvas.clientHeight ||
        parent?.clientHeight ||
        window.innerHeight - 80 ||
        400,
    );
    const iw = Math.max(320, Math.floor(cssW / PIXEL_SCALE) * PIXEL_SCALE);
    const ih = Math.max(280, Math.floor(cssH / PIXEL_SCALE) * PIXEL_SCALE);
    if (canvas.width !== iw || canvas.height !== ih) {
      canvas.width = iw;
      canvas.height = ih;
      ctx.imageSmoothingEnabled = false;
    }

    const lw = Math.max(160, Math.floor(iw / PIXEL_SCALE));
    const lh = Math.max(140, Math.floor(ih / PIXEL_SCALE));

    let off = offRef.current;
    if (!off || off.width !== lw || off.height !== lh) {
      off = document.createElement("canvas");
      off.width = lw;
      off.height = lh;
      offRef.current = off;
    }
    const octx = off.getContext("2d", { willReadFrequently: dither });
    if (!octx) return;
    octx.imageSmoothingEnabled = false;

    try {
      fillRect(octx, 0, 0, lw, lh, DUNGEON_THEME.bg);

      const ox = 8;
      const oy = 28;
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          const t = MAP[y]![x]!;
          const px = ox + x * TILE;
          const py = oy + y * TILE;
          fillRect(octx, px, py, TILE, TILE, TILE_COLORS[t] ?? "#1a1410");
          if (t === 1) {
            octx.fillStyle = "#6a5840";
            if ((x + y + tick) % 3 === 0) octx.fillRect(px + 2, py + 2, 3, 2);
            if ((x * 3 + y) % 5 === 0) octx.fillRect(px + 8, py + 10, 4, 2);
            octx.fillStyle = "#3a3020";
            if ((x + y) % 2 === 0) octx.fillRect(px, py + 7, TILE, 1);
          }
          if (t === 2) {
            const f = 4 + ((tick + x) % 3);
            fillRect(octx, px + 6, py + 4, 4, f, "#e09030");
            fillRect(octx, px + 7, py + 2, 2, 3, "#f0d060");
            fillRect(octx, px + 2, py + 12, 12, 3, "#5a3818");
          }
          if (t === 3) {
            fillRect(octx, px + 3, py + 6, 10, 8, "#b88830");
            fillRect(octx, px + 3, py + 6, 10, 2, "#d4a040");
            fillRect(octx, px + 7, py + 8, 2, 3, "#f0d080");
          }
          if (t === 4) {
            fillRect(octx, px + 2, py + 2, 12, 12, "#6a4028");
            fillRect(octx, px + 10, py + 8, 2, 2, "#d4a040");
          }
          if (t === 5) {
            fillRect(octx, px + 3, py + 6, 10, 8, "#5a9040");
            fillRect(octx, px + 5, py + 8, 2, 2, "#1a2010");
            fillRect(octx, px + 9, py + 8, 2, 2, "#1a2010");
          }
        }
      }

      const p = player.current;
      const ppx = ox + p.x * TILE;
      const ppy = oy + p.y * TILE;
      fillRect(octx, ppx + 4, ppy + 3, 8, 10, "#c8a060");
      fillRect(octx, ppx + 5, ppy + 5, 2, 2, "#1a1410");
      fillRect(octx, ppx + 9, ppy + 5, 2, 2, "#1a1410");
      fillRect(octx, ppx + 6, ppy + 9, 4, 1, "#8a4030");

      const ui = uiRef.current;
      ui.beginFrame();
      ui.panel(octx, { x: 4, y: 2, w: lw - 8, h: 22 }, "THE KEEP");
      pixelText(octx, `HP ${hp}`, 12, 18, "#c85840", 1);
      ui.bar(octx, { x: 48, y: 10, w: 60, h: 8 }, hp / 100, "#a84838");
      pixelText(octx, `MP ${mp}`, 120, 18, "#6890a0", 1);
      ui.bar(octx, { x: 156, y: 10, w: 50, h: 8 }, mp / 100, "#5080a0");
      pixelText(octx, `G ${gold}`, 220, 18, "#d4a040", 1);

      ui.button(octx, "atk", { x: 8, y: lh - 28, w: 52, h: 18 }, "ATK");
      ui.button(octx, "item", { x: 66, y: lh - 28, w: 52, h: 18 }, "ITEM");
      ui.button(octx, "map", { x: 124, y: lh - 28, w: 52, h: 18 }, "MAP");
      ui.button(octx, "rest", { x: 182, y: lh - 28, w: 52, h: 18 }, "REST");

      ui.panel(octx, { x: lw - 148, y: 28, w: 140, h: 120 }, "LOG");
      log.forEach((line, i) => {
        pixelText(
          octx,
          line.slice(0, 20),
          lw - 140,
          48 + i * 10,
          DUNGEON_THEME.muted,
          1,
        );
      });

      const ts = tilesetRef.current;
      if (ts && ts.complete) {
        octx.globalAlpha = 0.3;
        octx.drawImage(ts, lw - 90, lh - 70, 80, 45);
        octx.globalAlpha = 1;
      }

      if (dither) applyOrderedDither(octx, lw, lh, 4);

      ctx.fillStyle = DUNGEON_THEME.bg;
      ctx.fillRect(0, 0, iw, ih);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, iw, ih);
    } catch (err) {
      console.error("[DungeonLab] draw failed", err);
      try {
        ctx.fillStyle = "#1a1410";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#d4a574";
        ctx.font =
          '14px "Fusion Pixel 12 Mono", "Fusion Pixel 12", "HarmonyOS Sans SC"';
        ctx.fillText("DUNGEON DRAW ERROR — see console", 16, 32);
      } catch {
        /* ignore */
      }
    }
  }, [tick, hp, mp, gold, log, dither]);

  // 独立 polyfill canvas：把专用 DOM 子节点采样进去（不碰主 canvas / 可见 HUD）
  useEffect(() => {
    if (!htmlHud || !polyOk) {
      setPolyDrawn(false);
      return;
    }
    const poly = polyCanvasRef.current;
    const sample = polyHudRef.current;
    if (!poly || !sample) return;

    let cancelled = false;
    let raf = 0;
    let fails = 0;

    const tryDraw = () => {
      if (cancelled) return;
      const pctx = poly.getContext("2d") as Ctx2dHtml | null;
      if (!pctx || typeof pctx.drawElementImage !== "function") {
        setPolyDrawn(false);
        return;
      }
      if (sample.parentElement !== poly) {
        try {
          poly.appendChild(sample);
        } catch {
          setPolyDrawn(false);
          return;
        }
      }
      const dw = 260;
      const dh = 140;
      if (poly.width !== dw || poly.height !== dh) {
        poly.width = dw;
        poly.height = dh;
      }
      try {
        pctx.clearRect(0, 0, dw, dh);
        pctx.drawElementImage(sample, 0, 0, dw, dh);
        fails = 0;
        setPolyDrawn(true);
      } catch {
        fails++;
        if (fails > 3) setPolyDrawn(false);
      }
      raf = requestAnimationFrame(tryDraw);
    };
    raf = requestAnimationFrame(tryDraw);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [htmlHud, polyOk]);

  // pointer → canvas-ui
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ui = uiRef.current;
    ui.setClickHandler((id) => {
      if (id === "atk") {
        setMp((m) => Math.max(0, m - 5));
        setGold((g) => g + 3);
        pushLog("* SLASH! +3 GOLD");
      } else if (id === "item") {
        setHp((h) => Math.min(100, h + 12));
        pushLog("* DRANK POTION +12 HP");
      } else if (id === "map") {
        pushLog("* MAP: KEEP B1");
      } else if (id === "rest") {
        setHp((h) => Math.min(100, h + 5));
        setMp((m) => Math.min(100, m + 8));
        pushLog("* YOU REST...");
      }
    });
    const scalePos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / Math.max(1, rect.width);
      const sy = canvas.height / Math.max(1, rect.height);
      return {
        x: ((e.clientX - rect.left) * sx) / PIXEL_SCALE,
        y: ((e.clientY - rect.top) * sy) / PIXEL_SCALE,
      };
    };
    const onMove = (e: PointerEvent) => {
      const { x, y } = scalePos(e);
      ui.setPointer(x, y, e.buttons === 1);
    };
    const onDown = (e: PointerEvent) => {
      const { x, y } = scalePos(e);
      ui.setPointer(x, y, true);
    };
    const onUp = (e: PointerEvent) => {
      const { x, y } = scalePos(e);
      ui.setPointer(x, y, false);
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    return () => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
    };
  }, [pushLog]);

  // keyboard move
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = player.current;
      let nx = p.x;
      let ny = p.y;
      if (e.key === "ArrowLeft" || e.key === "a") nx--;
      else if (e.key === "ArrowRight" || e.key === "d") nx++;
      else if (e.key === "ArrowUp" || e.key === "w") ny--;
      else if (e.key === "ArrowDown" || e.key === "s") ny++;
      else return;
      e.preventDefault();
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) return;
      const cell = MAP[ny]![nx]!;
      if (cell === 1) {
        pushLog("* BONK WALL");
        return;
      }
      if (cell === 5) {
        setHp((h) => Math.max(1, h - 8));
        pushLog("* SLIME HITS -8");
      }
      if (cell === 3) {
        setGold((g) => g + 25);
        MAP[ny]![nx] = 0;
        pushLog("* CHEST! +25G");
      }
      p.x = nx;
      p.y = ny;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pushLog]);

  return (
    <div className="dungeon-lab">
      <aside className="dungeon-side">
        <h2 className="dungeon-title">THE KEEP</h2>
        <p className="dungeon-desc">
          复古地牢像素台：纯 2d 主场景 + <code>canvas-ui</code> HUD；DOM 任务栏
          始终可见。WASD 移动，点底部按钮。
        </p>
        <div className="dungeon-toggles">
          <label>
            <input
              type="checkbox"
              checked={dither}
              onChange={(e) => setDither(e.target.checked)}
            />
            Bayer dither（暖色）
          </label>
          <label>
            <input
              type="checkbox"
              checked={htmlHud}
              onChange={(e) => setHtmlHud(e.target.checked)}
            />
            DOM / polyfill HUD
          </label>
        </div>
        <div className={`dungeon-badge ${polyOk ? "ok" : "bad"}`}>
          polyfill: {polyOk ? "ready" : "off"}
          {polyOk && htmlHud ? (polyDrawn ? " · drawn" : " · sample") : ""}
        </div>
        <ul className="dungeon-hints">
          <li>暖褐 / 琥珀 / 羊皮纸，无霓虹紫青</li>
          <li>主 canvas 纯 2d，不挂 layoutsubtree</li>
          <li>CanvasUI 按钮 · HP/MP 条 · 像素字</li>
          <li>polyfill 仅独立小 canvas 采样</li>
        </ul>
      </aside>

      <div className="dungeon-stage">
        <canvas ref={canvasRef} className="dungeon-canvas" tabIndex={0} />

        {htmlHud && (
          <>
            <div
              className="dungeon-html-hud dungeon-html-hud-visible"
              style={{ width: 260, height: 140 }}
            >
              <div className="html-hud-inner">
                <header>QUEST LOG</header>
                <p className="html-hud-line">Find the chest in the keep.</p>
                <p className="html-hud-line">Slime waits near mid-map.</p>
                <div className="html-hud-actions">
                  <button type="button" onClick={() => pushLog("* QUEST PING")}>
                    PING
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHp(100);
                      setMp(100);
                      pushLog("* CHEAT FULL");
                    }}
                  >
                    FULL
                  </button>
                </div>
                <footer>
                  hp {hp} · mp {mp} · g {gold}
                </footer>
              </div>
            </div>

            {/* 独立 polyfill 实验：专用子节点 + layoutsubtree，与主场景隔离 */}
            <canvas
              ref={polyCanvasRef}
              className="dungeon-poly-canvas"
              {...({ layoutsubtree: "" } as HTMLAttributes<HTMLCanvasElement>)}
              width={260}
              height={140}
              title="html-in-canvas polyfill sample"
            />
            <div ref={polyHudRef} className="dungeon-poly-sample" aria-hidden>
              <div className="html-hud-inner">
                <header>POLY SAMPLE</header>
                <p className="html-hud-line">drawElementImage ok</p>
                <footer>
                  hp {hp} · g {gold}
                </footer>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
