/** 弹窗 —— 模型选择 / 命令面板 / 帮助（z-overlay 模态） */
import React, { useState, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { currentTheme } from "../theme.js";
import { useStore } from "../state/store.js";
import { getProviders, getModels } from "@little-house-studio/llm";

function Overlay({ title, children, width = 50 }: { title: string; children: React.ReactNode; width?: number }) {
  const t = currentTheme;
  return (
    <Box position="absolute" marginLeft={4} marginTop={2}>
      <Box flexDirection="column" borderStyle="double" borderColor={t.accent} paddingX={1} width={width}>
        <Box marginTop={-1}><Text color={t.accent} bold> {title} </Text></Box>
        {children}
      </Box>
    </Box>
  );
}

export function ModelPicker() {
  const t = currentTheme;
  const setModal = useStore((s) => s.setModal);
  const setProviderModel = useStore((s) => s.setProviderModel);
  const toastMsg = useStore((s) => s.toastMsg);
  const flat = useMemo(() => {
    const out: { provider: string; model: string; name: string }[] = [];
    for (const p of getProviders()) {
      for (const m of getModels(p.id).slice(0, 6)) out.push({ provider: p.id, model: m.id, name: m.name ?? m.id });
    }
    return out;
  }, []);
  const [sel, setSel] = useState(0);
  const [filter, setFilter] = useState("");
  const filtered = flat.filter((x) => (x.provider + x.model + x.name).toLowerCase().includes(filter.toLowerCase()));
  useInput((input, key) => {
    if (key.escape) return setModal(null);
    if (key.upArrow) return setSel((s) => Math.max(0, s - 1));
    if (key.downArrow) return setSel((s) => Math.min(filtered.length - 1, s + 1));
    if (key.return) {
      const c = filtered[sel];
      if (c) { setProviderModel(c.provider, c.model); toastMsg(`已切换到 ${c.provider}/${c.model}`, "ok"); }
      return setModal(null);
    }
    if (key.backspace || key.delete) return setFilter((f) => f.slice(0, -1));
    if (input && !key.ctrl) return setFilter((f) => f + input);
  });
  const window = filtered.slice(Math.max(0, sel - 4), Math.max(0, sel - 4) + 10);
  const base = Math.max(0, sel - 4);
  return (
    <Overlay title="◆ 选择模型" width={56}>
      <Text color={t.dim}>搜索: <Text color={t.fg}>{filter}</Text>▌</Text>
      <Box flexDirection="column" marginTop={1}>
        {window.map((x, i) => {
          const idx = base + i;
          const on = idx === sel;
          return (
            <Text key={idx} color={on ? t.bg : t.fg} backgroundColor={on ? t.accent : undefined}>
              {on ? "▶ " : "  "}{x.provider.padEnd(12)} {x.name}
            </Text>
          );
        })}
      </Box>
      <Text color={t.dim}>↑↓ 选择 · ↵ 确认 · Esc 取消 · {filtered.length} 个模型</Text>
    </Overlay>
  );
}

const COMMANDS = [
  { id: "new", label: "新建对话", desc: "清空当前会话" },
  { id: "model", label: "选择模型", desc: "切换 provider/model" },
  { id: "theme", label: "切换主题", desc: "vampire / cyber" },
  { id: "clear", label: "清屏", desc: "清空消息" },
  { id: "help", label: "帮助", desc: "快捷键说明" },
  { id: "quit", label: "退出", desc: "关闭 Maou CLI" },
];

export function CommandPalette({ onRun }: { onRun: (id: string) => void }) {
  const t = currentTheme;
  const setModal = useStore((s) => s.setModal);
  const [sel, setSel] = useState(0);
  const [filter, setFilter] = useState("");
  const filtered = COMMANDS.filter((c) => (c.label + c.desc).toLowerCase().includes(filter.toLowerCase()));
  useInput((input, key) => {
    if (key.escape) return setModal(null);
    if (key.upArrow) return setSel((s) => Math.max(0, s - 1));
    if (key.downArrow) return setSel((s) => Math.min(filtered.length - 1, s + 1));
    if (key.return) { const c = filtered[sel]; if (c) onRun(c.id); return; }
    if (key.backspace || key.delete) return setFilter((f) => f.slice(0, -1));
    if (input && !key.ctrl) return setFilter((f) => f + input);
  });
  return (
    <Overlay title="⚡ 命令面板" width={50}>
      <Text color={t.dim}>› <Text color={t.fg}>{filter}</Text>▌</Text>
      <Box flexDirection="column" marginTop={1}>
        {filtered.map((c, i) => (
          <Box key={c.id} justifyContent="space-between">
            <Text color={i === sel ? t.bg : t.fg} backgroundColor={i === sel ? t.accent : undefined}>{i === sel ? "▶ " : "  "}{c.label}</Text>
            <Text color={t.dim}>{c.desc}</Text>
          </Box>
        ))}
      </Box>
    </Overlay>
  );
}

export function HelpModal() {
  const t = currentTheme;
  const setModal = useStore((s) => s.setModal);
  useInput((_i, key) => { if (key.escape || key.return) setModal(null); });
  const keys = [
    ["↵ / Enter", "发送消息"],
    ["Esc", "中断流式 / 关闭弹窗"],
    ["Ctrl+K", "命令面板"],
    ["Ctrl+M", "选择模型"],
    ["Ctrl+N", "新对话"],
    ["Ctrl+B", "切换侧栏"],
    ["Ctrl+G", "切换 HUD"],
    ["Tab", "切换焦点面板"],
    ["鼠标点击", "聚焦面板 / 输入框光标定位"],
    ["Ctrl+C", "退出"],
  ];
  return (
    <Overlay title="? 快捷键" width={44}>
      <Box flexDirection="column">
        {keys.map(([k, d], i) => (
          <Box key={i} justifyContent="space-between">
            <Text color={t.accent} bold>{k}</Text>
            <Text color={t.fg}>{d}</Text>
          </Box>
        ))}
      </Box>
      <Text color={t.dim}>按 Esc 关闭</Text>
    </Overlay>
  );
}
