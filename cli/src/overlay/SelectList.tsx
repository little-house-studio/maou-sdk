/**
 * SelectList —— @inkjs/ui Select 语义 + 鼠标胶水。
 *
 * 背景：@inkjs/ui 的 <Select> 不暴露受控 focusedValue / 选项 ref，无法挂
 * useClickTarget / overlayScrollCmd / hover。本组件用与 Select 相同的
 * Option 形状 + 窗口切片 + figures.pointer 视觉，键盘/滚轮/点击均保留。
 *
 * 旧实现：legacy/pre-lib-migration/overlay/SelectList.tsx
 */

import React, { useState, useRef, useEffect, useMemo } from "react";
import { Box, Text } from "ink";
import type { DOMElement } from "ink";
import type { Option } from "@inkjs/ui";
import figures from "figures";
import { useTheme } from "../theme/theme-context.js";
import { useStore } from "../state/store.js";
import { useClickTarget } from "../input/click-target.js";
import { useCleanInput } from "../hooks/useCleanInput.js";

export interface SelectItem {
  value: string;
  label: string;
  description?: string;
}

interface Props {
  items: SelectItem[];
  onSelect: (value: string) => void;
  visibleCount?: number;
  innerWidth?: number;
}

/** SelectItem → @inkjs/ui Option（description 并入 label） */
function toOptions(items: SelectItem[]): Option[] {
  return items.map((it) => ({
    value: it.value,
    label: it.description ? `${it.label}  ${it.description}` : it.label,
  }));
}

export function SelectList({ items, onSelect, visibleCount = 8, innerWidth = 42 }: Props) {
  const t = useTheme();
  const [selected, setSelected] = useState(0);
  const overlay = useStore((s) => s.overlay);
  const overlayScrollCmd = useStore((s) => s.overlayScrollCmd);

  const options = useMemo(() => toOptions(items), [items]);

  // 与 @inkjs/ui useSelectState 相同的窗口切片（选中项尽量居中）
  const count = Math.min(visibleCount, Math.max(1, options.length));
  const from = Math.max(0, Math.min(selected - Math.floor(count / 2), Math.max(0, options.length - count)));
  const to = Math.min(options.length, from + count);
  const visible = options.slice(from, to).map((opt, i) => ({ ...opt, index: from + i, item: items[from + i]! }));

  // items 变化时钳制 selected
  useEffect(() => {
    setSelected((s) => Math.max(0, Math.min(s, Math.max(0, items.length - 1))));
  }, [items.length]);

  // 键盘：对齐 @inkjs/ui useSelect（↑↓ focus，Enter select）
  useCleanInput((_char, key) => {
    if (!useStore.getState().overlay) return;
    if (key.upArrow) setSelected((s) => Math.max(0, s - 1));
    else if (key.downArrow) setSelected((s) => Math.min(items.length - 1, s + 1));
    else if (key.return) {
      const v = items[selected]?.value;
      if (v !== undefined) onSelect(v);
    }
  });

  // 滚轮 → overlayScrollCmd（鼠标不降级）
  useEffect(() => {
    if (overlayScrollCmd === null) return;
    if (overlayScrollCmd.dir === "up") setSelected((s) => Math.max(0, s - 1));
    else setSelected((s) => Math.min(items.length - 1, s + 1));
  }, [overlayScrollCmd, items.length]);

  if (!overlay) return null;

  return (
    <Box flexDirection="column" width={innerWidth}>
      {visible.map((opt) => {
        const isSel = opt.index === selected;
        return (
          <SelectRow
            key={opt.value}
            label={opt.label}
            isSel={isSel}
            onClick={() => onSelect(opt.value)}
            panelBg={t.panelBg}
            accent={t.accent}
            fg={t.fg}
          />
        );
      })}
    </Box>
  );
}

function SelectRow({
  label,
  isSel,
  onClick,
  panelBg,
  accent,
  fg,
}: {
  label: string;
  isSel: boolean;
  onClick: () => void;
  panelBg: string;
  accent: string;
  fg: string;
}) {
  const ref = useRef<DOMElement | null>(null);
  const cid = useClickTarget(ref, onClick, [label]);
  const isHover = useStore((s) => s.hoverId) === cid;
  // hover 只变色，不改 selected（避免鼠标移动导致菜单自动滚动）
  const highlight = isSel || isHover;
  const pointer = isSel ? `${figures.pointer} ` : "  ";
  return (
    <Box ref={ref}>
      <Text color={highlight ? accent : fg} bold={highlight} backgroundColor={panelBg}>
        {pointer}{label}
      </Text>
    </Box>
  );
}
