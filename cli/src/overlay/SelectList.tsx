/**
 * SelectList —— 自建交互式选择列表（@inkjs/ui 已移除，借鉴 ink-ui visibleFromIndex 窗口切片）。
 * ↑↓ 导航（外层 useCleanInput 捕获），Enter 选择，Esc 关闭。
 * 鼠标点击选项（useClickTarget）+ hover 高亮（项 7）。
 */

import React, { useState, useRef, useEffect } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useClickTarget } from "../input/click-target.js";

export interface SelectItem {
  value: string;
  label: string;
  description?: string;
}

interface Props {
  items: SelectItem[];
  onSelect: (value: string) => void;
  visibleCount?: number;
  innerWidth?: number;  // overlay 内容宽度（含左右│），每行撑满避免穿透
}

export function SelectList({ items, onSelect, visibleCount = 8, innerWidth = 42 }: Props) {
  const t = useTheme();
  const [selected, setSelected] = useState(0);
  const overlay = useStore((s) => s.overlay);

  // 窗口切片（借鉴 ink-ui visibleFromIndex/visibleToIndex）
  const from = Math.max(0, selected - Math.floor(visibleCount / 2));
  const to = Math.min(items.length, from + visibleCount);
  const visible = items.slice(from, to);

  // 捕获 ↑↓ Enter（overlay 开时）
  useSelectKeys((key) => {
    if (key === "up") setSelected(s => Math.max(0, s - 1));
    else if (key === "down") setSelected(s => Math.min(items.length - 1, s + 1));
    else if (key === "enter") onSelect(items[selected]?.value ?? "");
  });

  if (!overlay) return null;

  return (
    <Box flexDirection="column">
      {visible.map((it, i) => {
        const realIdx = from + i;
        const isSel = realIdx === selected;
        return <SelectRow key={it.value} item={it} isSel={isSel} onHover={() => setSelected(realIdx)} onClick={() => onSelect(it.value)} />;
      })}
    </Box>
  );
}

function SelectRow({ item, isSel, onHover, onClick }: {
  item: SelectItem; isSel: boolean; onHover: () => void; onClick: () => void;
}) {
  const t = useTheme();
  const ref = useRef<DOMElement | null>(null);
  const cid = useClickTarget(ref, onClick, [item.value]);
  const isHover = useStore((s) => s.hoverId) === cid;
  // hover 只变色，不改 selected（避免鼠标移动导致菜单自动滚动）。
  // 菜单滚动由滚轮/键盘↑↓驱动。点击仍触发 onSelect。
  const highlight = isSel || isHover;
  return (
    <Box ref={ref}>
      <Text color={highlight ? t.accent : t.fg} bold={highlight} backgroundColor={t.panelBg}>
        {isSel ? "▸ " : "  "}{item.label}
        {item.description && <Text color={t.muted} bold={false}> {item.description}</Text>}
      </Text>
    </Box>
  );
}

// 简易按键 hook（overlay 开时捕获 ↑↓ Enter）
import { useCleanInput } from "../hooks/useCleanInput.js";
function useSelectKeys(onKey: (k: "up" | "down" | "enter") => void): void {
  useCleanInput((char, key) => {
    const overlay = useStore.getState().overlay;
    if (!overlay) return;
    if (key.upArrow) onKey("up");
    else if (key.downArrow) onKey("down");
    else if (key.return) onKey("enter");
  });
}
