/**
 * GallerySplash —— 新会话 / 空历史时的卢浮宫式 ASCII 画廊。
 *
 * 布局（博物馆墙）：
 *   ┌ 左上 MAOU 铭牌（固定贴顶，不参与垂直居中）
 *   │
 *   │  ↑ 光学留白（略少，~38%）
 *   │     ┌──────── 画框 ────────┐   ← 水平居中
 *   │     │                      │
 *   │     └──────────────────────┘
 *   │           题签 / 铭牌         ← 水平居中
 *   │  ↓ 光学留白（略多，~62%）
 *   └
 *
 * 关键：logo 不进垂直居中质量；画档按「画高预算」选，避免 md/lg 装爆导致 0 留白。
 */

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useTheme } from "../theme/theme-context.js";
import {
  pickGallerySize,
  pickGalleryWork,
  formatPlaque,
  GALLERY_ART_ROWS,
  shouldShowGalleryArt,
  type GallerySize,
  type GalleryWork,
} from "./catalog.js";
import {
  loadFramedArt,
  centerBlock,
  centerTextLine,
  galleryVerticalPads,
} from "./load-art.js";
import { maouLogoLines } from "./maou-logo.js";

export function GallerySplash({
  seed,
  work: forcedWork,
  /** 对话区内宽（一般 term.cols-2）；缺省用 term.cols-2 */
  contentCols,
  /** 可用行数（扣除底栏后）；缺省用 term.rows-8 */
  contentRows,
}: {
  seed?: string;
  work?: GalleryWork;
  contentCols?: number;
  contentRows?: number;
}) {
  const term = useTerminalSize();
  const t = useTheme();
  const muted = t.muted;
  const accent = t.accent;
  const artColor = t.fg ?? t.muted;

  const cols = Math.max(24, contentCols ?? term.cols - 2);
  // 底栏约 EventBlock+Input+Info+Nav ≈ 6～8 行；对话区边框 2
  const rows = Math.max(12, contentRows ?? term.rows - 8);

  const work = forcedWork ?? pickGalleryWork(seed);
  // 固定 logo，不随终端宽高变体
  const logo = useMemo(() => maouLogoLines(), []);
  const plaqueFull = useMemo(() => formatPlaque(work), [work]);

  /**
   * 选档 + 紧凑铭牌：
   * logo 固定 5 行；挂画区过矮则整幅油画+铭牌不展示；
   * 否则画档降档，垂直不够时只压缩题签（不缩小 logo）。
   */
  const layout = useMemo(() => {
    const logoH = logo.length;
    const hangArea = Math.max(0, rows - logoH);

    // 终端太矮：只留 logo，不挂油画
    if (!shouldShowGalleryArt(hangArea)) {
      return {
        size: "sm" as GallerySize,
        art: null as string[] | null,
        artH: 0,
        logo,
        logoH,
        plaque: [] as string[],
        showSizeLine: false,
        plaqueH: 0,
        hangH: 0,
        free: hangArea,
        fits: true,
        hasBreath: true,
        showArt: false,
      };
    }

    const order: GallerySize[] = ["lg", "md", "sm"];
    let size: GallerySize = pickGallerySize(cols, rows);
    let idx = Math.max(0, order.indexOf(size));

    const tryLayout = (s: GallerySize, compactPlaque: boolean) => {
      const art = loadFramedArt(work.id, s);
      const artH = art?.length ?? GALLERY_ART_ROWS[s];
      const plaque = compactPlaque ? plaqueFull.slice(0, 2) : plaqueFull;
      const showSizeLine = !compactPlaque;
      const plaqueH = 1 + plaque.length + (showSizeLine ? 1 : 0);
      const hangH = artH + plaqueH;
      const total = logoH + hangH;
      const free = rows - total;
      return {
        size: s,
        art,
        artH,
        logo,
        logoH,
        plaque,
        showSizeLine,
        plaqueH,
        hangH,
        free,
        fits: total <= rows,
        hasBreath: free >= 4,
        showArt: true,
      };
    };

    let best = tryLayout(order[idx]!, false);
    while (!best.fits && idx < order.length - 1) {
      idx += 1;
      best = tryLayout(order[idx]!, false);
    }
    // 垂直紧：只压缩题签，logo 样式不变
    if (!best.hasBreath) {
      const compact = tryLayout(best.fits ? best.size : "sm", true);
      if (compact.free > best.free || (compact.fits && !best.fits)) {
        best = compact;
      }
    }
    return best;
  }, [cols, rows, work.id, logo, plaqueFull]);

  const artLines = useMemo(
    () =>
      layout.showArt && layout.art ? centerBlock(layout.art, cols) : null,
    [layout.showArt, layout.art, cols],
  );

  // 挂画区 = 总高 − logo；在此区内光学分配上下留白
  const hangArea = Math.max(0, rows - layout.logoH);
  const hangH = layout.showArt
    ? (artLines?.length ?? layout.artH) + layout.plaqueH
    : 0;
  // 画作起点固定再下移 2 格（光学 top +2，下方相应减）
  const { top: aboveHang, bottom: bottomPad } = useMemo(() => {
    if (!layout.showArt) return { top: 0, bottom: 0 };
    const pads = galleryVerticalPads(hangArea, hangH);
    const free = pads.top + pads.bottom;
    if (free <= 0) return pads;
    const top = Math.min(free, pads.top + 2);
    return { top, bottom: free - top };
  }, [layout.showArt, hangArea, hangH]);

  return (
    <Box flexDirection="column" width={cols} height={rows} overflow="hidden">
      {/* ① 左上像素标：贴顶，不参与垂直居中；accent 荧光色 */}
      <Box flexDirection="column" marginLeft={1} flexShrink={0}>
        {layout.logo.map((ln, i) => (
          <Text key={`logo-${i}`} color={accent}>
            {ln}
          </Text>
        ))}
      </Box>

      {layout.showArt && (
        <>
          {/* ② logo → 画：光学上留白（略紧） */}
          {Array.from({ length: aboveHang }, (_, i) => (
            <Text key={`tpad-${i}`}>{" "}</Text>
          ))}

          {/* ③ 画框：水平居中（centerBlock 已按显示宽补空格） */}
          <Box flexDirection="column" width={cols} flexShrink={0}>
            {artLines ? (
              artLines.map((ln, i) => (
                <Text key={`art-${i}`} color={artColor}>
                  {ln}
                </Text>
              ))
            ) : (
              <Text color={muted}>
                {centerTextLine("〔画作 ASCII 未烘焙〕", cols)}
              </Text>
            )}
          </Box>

          {/* ④ 铭牌：与画 1 行呼吸，水平居中；标题白粗体，其余 muted */}
          <Text>{" "}</Text>
          <Box flexDirection="column" width={cols} flexShrink={0}>
            {layout.plaque.map((ln, i) => (
              <Text
                key={`pl-${i}`}
                color={i === 0 ? (t.fg ?? "white") : muted}
                bold={i === 0}
              >
                {centerTextLine(ln, cols)}
              </Text>
            ))}
            {layout.showSizeLine && (
              <Text color={muted} dimColor>
                {centerTextLine(`gallery · ${layout.size}`, cols)}
              </Text>
            )}
          </Box>

          {/* ⑤ 下方光学留白（略松 → 画视觉上略偏上） */}
          {Array.from({ length: bottomPad }, (_, i) => (
            <Text key={`bpad-${i}`}>{" "}</Text>
          ))}
        </>
      )}
    </Box>
  );
}
