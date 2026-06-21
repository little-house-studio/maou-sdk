/** 侧边栏 / HUD / 状态栏 / 顶栏 / 弹窗 */
import React from "react";
import { Box, Text } from "ink";
import { Panel } from "./Panel.js";
import { Gauge, Spark, Wireframe, Spinner } from "./graphics.js";
import { currentTheme } from "../theme.js";
import { useStore } from "../state/store.js";

const LOGO = [
  "╔╦╗╔═╗╔═╗╦ ╦",
  "║║║╠═╣║ ║║ ║",
  "╩ ╩╩ ╩╚═╝╚═╝",
];

export function TopBar({ frame }: { frame: number }) {
  const t = currentTheme;
  const { model, provider, expression, streaming } = useStore();
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Box flexDirection="column">
        {LOGO.map((l, i) => <Text key={i} color={t.accent} bold>{l}</Text>)}
      </Box>
      <Box flexDirection="column" alignItems="center">
        <Text color={t.role.assistant} bold>{expression}</Text>
        <Text color={t.dim}>{streaming ? "思考中…" : "待命"}</Text>
      </Box>
      <Box flexDirection="column" alignItems="flex-end">
        <Text color={t.borderSoft}>◆ {provider}</Text>
        <Text color={t.fg}>{model}</Text>
      </Box>
    </Box>
  );
}

export function Sidebar({ focused }: { focused: boolean }) {
  const t = currentTheme;
  const { messages, hud } = useStore();
  const items = [
    { icon: "✦", label: "新对话", key: "Ctrl+N" },
    { icon: "◆", label: "选模型", key: "Ctrl+M" },
    { icon: "⚡", label: "命令", key: "Ctrl+K" },
    { icon: "?", label: "帮助", key: "?" },
  ];
  return (
    <Panel title="菜单" icon="☰" focused={focused} width={20} height="100%">
      <Box flexDirection="column">
        {items.map((it, i) => (
          <Box key={i} justifyContent="space-between">
            <Text color={t.fg}>{it.icon} {it.label}</Text>
            <Text color={t.dim}>{it.key}</Text>
          </Box>
        ))}
        <Box marginTop={1}><Text color={t.borderSoft}>─── 会话 ───</Text></Box>
        <Text color={t.dim}>消息 {messages.length}</Text>
        <Text color={t.dim}>轮次 {hud.round}</Text>
      </Box>
    </Panel>
  );
}

export function Hud({ frame, angle }: { frame: number; angle: number }) {
  const t = currentTheme;
  const { hud } = useStore();
  const lastTok = hud.tokenHistory[hud.tokenHistory.length - 1] ?? 0;
  return (
    <Panel title="状态" icon="❖" width={26} height="100%">
      <Box flexDirection="column">
        <Box justifyContent="center"><Wireframe angle={angle} model="crystal" width={11} height={5} /></Box>
        <Box marginTop={1} flexDirection="column">
          <Gauge label="TOK" value={lastTok} max={Math.max(8000, lastTok)} width={14} />
          <Gauge label="轮次" value={hud.round} max={Math.max(24, hud.round)} width={14} color={t.spark[2]} />
        </Box>
        <Box marginTop={1}><Spark values={hud.tokenHistory} width={22} height={8} label="Token 历史" /></Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={t.dim}>总输入 <Text color={t.role.user}>{hud.totalInput}</Text></Text>
          <Text color={t.dim}>总输出 <Text color={t.role.assistant}>{hud.totalOutput}</Text></Text>
          <Text color={t.dim}>成本 <Text color={t.status.ok}>${hud.totalCost.toFixed(4)}</Text></Text>
        </Box>
      </Box>
    </Panel>
  );
}

export function StatusBar({ mode, input }: { mode: string; input: string }) {
  const t = currentTheme;
  const { streaming } = useStore();
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Box>
        <Text backgroundColor={t.accent} color={t.bg} bold> {mode} </Text>
        <Text color={t.dim}> {streaming ? "⏸ Esc 中断" : "↵ 发送"} · Ctrl+K 命令 · Tab 切换 · Ctrl+C 退出</Text>
      </Box>
      <Text color={t.dim}>{streaming ? "● 流式" : "○ 空闲"}</Text>
    </Box>
  );
}

export function Toast() {
  const t = currentTheme;
  const { toast } = useStore();
  if (!toast) return null;
  const c = toast.kind === "err" ? t.status.err : toast.kind === "ok" ? t.status.ok : t.status.info;
  return (
    <Box paddingX={1}>
      <Text backgroundColor={c} color={t.bg} bold> {toast.kind === "err" ? "✗" : toast.kind === "ok" ? "✓" : "ℹ"} {toast.text} </Text>
    </Box>
  );
}
