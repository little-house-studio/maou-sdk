/** 侧边栏 / HUD / 状态栏 / 顶栏 / 弹窗（磁带未来主义 · 密集布局）
 *  - 线条分割而非留白（DESIGN.md §4.1）
 *  - VFD 荧光显示屏反色填色（DESIGN.md §2.1 / §6.4）
 *  - 垂直空间极度珍惜，组件间距 0（DESIGN.md §4.1）
 */
import React from "react";
import { Box, Text } from "ink";
import { Panel, VfdTag, Divider } from "./Panel.js";
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
    <Box justifyContent="space-between" paddingX={1} flexShrink={0}>
      <Box flexDirection="column">
        {LOGO.map((l, i) => <Text key={i} color={t.accent} bold>{l}</Text>)}
      </Box>
      <Box flexDirection="column" alignItems="center">
        <Text color={t.role.assistant} bold>{expression}</Text>
        <Text color={streaming ? t.accent2 : t.dim}>{streaming ? "► 思考中" : "■ 待命"}</Text>
      </Box>
      <Box flexDirection="column" alignItems="flex-end">
        <VfdTag label="LLM" value={provider} color={t.accent} />
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
    { icon: "►", label: "命令", key: "Ctrl+K" },
    { icon: "?", label: "帮助", key: "?" },
  ];
  return (
    <Panel title="菜单" icon="≡" focused={focused} width={20} height="100%" padX={1}>
      <Box flexDirection="column">
        {items.map((it, i) => (
          <Box key={i} justifyContent="space-between">
            <Text color={t.fg}>{it.icon} {it.label}</Text>
            <Text color={t.dim}>{it.key}</Text>
          </Box>
        ))}
        <Divider char="─" color={t.borderSoft} />
        <Text color={t.dim}>会话 · 消息 {messages.length}</Text>
        <Text color={t.dim}>磁带 · 轮次 {hud.round}</Text>
      </Box>
    </Panel>
  );
}

export function Hud({ frame, angle }: { frame: number; angle: number }) {
  const t = currentTheme;
  const { hud } = useStore();
  const lastTok = hud.tokenHistory[hud.tokenHistory.length - 1] ?? 0;
  return (
    <Panel title="状态" icon="❖" width={26} height="100%" padX={1}>
      <Box flexDirection="column">
        <Box justifyContent="center"><Wireframe angle={angle} model="crystal" width={11} height={5} /></Box>
        <Divider char="─" color={t.borderSoft} />
        <Box flexDirection="column">
          <Gauge label="TOK" value={lastTok} max={Math.max(8000, lastTok)} width={14} />
          <Gauge label="轮次" value={hud.round} max={Math.max(24, hud.round)} width={14} color={t.spark[2]} />
        </Box>
        <Divider char="─" color={t.borderSoft} />
        <Spark values={hud.tokenHistory} width={22} height={6} label="Token 历史" />
        <Divider char="─" color={t.borderSoft} />
        <Box flexDirection="column">
          <Text color={t.dim}>输入 <Text color={t.role.user}>{hud.totalInput}</Text> · 输出 <Text color={t.role.assistant}>{hud.totalOutput}</Text></Text>
          <Text color={t.dim}>成本 <Text color={t.status.ok}>${hud.totalCost.toFixed(4)}</Text></Text>
        </Box>
      </Box>
    </Panel>
  );
}

/** 状态栏 —— VFD 荧光显示屏风格（DESIGN.md §6.4）
 *  字段由 │ 分隔，Mode 字段反色填色
 */
export function StatusBar({ mode, input, mouse }: { mode: string; input: string; mouse?: boolean }) {
  const t = currentTheme;
  const { streaming } = useStore();
  // Mode 颜色：NORMAL 绿 / AUTO 琥珀 / 其他 红
  const modeColor = mode === "NORMAL" ? t.accent : mode === "AUTO" ? t.accent2 : t.status.err;
  return (
    <Box justifyContent="space-between" paddingX={1} flexShrink={0}>
      <Box>
        <VfdTag value={mode} color={modeColor} />
        <Text color={t.dim}> {streaming ? "□ Esc 中断" : "↵ 发送"} · Ctrl+K · Tab · Ctrl+C</Text>
      </Box>
      <Box>
        <Text color={mouse ? t.status.ok : t.dim}>■ {mouse ? "ON" : "OFF"}</Text>
        <Text color={t.dim}> │ </Text>
        <Text color={streaming ? t.accent2 : t.dim}>{streaming ? "● 流式" : "○ 空闲"}</Text>
      </Box>
    </Box>
  );
}

export function Toast() {
  const t = currentTheme;
  const { toast } = useStore();
  if (!toast) return null;
  const c = toast.kind === "err" ? t.status.err : toast.kind === "ok" ? t.status.ok : t.status.info;
  return (
    <Box paddingX={1} flexShrink={0}>
      <Text backgroundColor={c} color={t.bg} bold>
        {" "}{toast.kind === "err" ? "✗" : toast.kind === "ok" ? "✓" : "※"}{" "}{toast.text}{" "}
      </Text>
    </Box>
  );
}
