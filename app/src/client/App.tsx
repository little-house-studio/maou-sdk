/**
 * Production SPA host — live ports + slot chrome.
 *
 * Layout (WireShell seats):
 *   top:    modes 聊天 / 项目 / 插件 / 设置 + meta + 文件
 *   left:   chat = sessions only (ThreadRail portal); project = agent 名册
 *   center: live ChatPanel (stream / slash / approval / model)
 *   right:  LiveFilesRail when 文件 open
 *   bottom: BottomInfoBar dock boards (log / tasks / terminal / agent)
 *
 * TerminalPanel: dock terminal board expand or Ctrl+` / tool-card open.
 *
 * First paint: TerminalPanel / LiveProjectHost / ProactiveHost stay lazy
 * (host/live-state.tsx + host/live-slots.tsx).
 */
import { useEffect, useMemo } from "react";
import { PortsProvider, createLivePorts } from "./ports";
import { SlotsProvider } from "./slots";
import { createLiveHostSlots } from "./host/live-slots";
import { LiveApp } from "./host/LiveApp";
import "./wire/wire.css";
import "./composer/composer.css";
import "./live-shell.css";

export function App() {
  const ports = useMemo(() => createLivePorts(), []);
  const slots = useMemo(() => createLiveHostSlots(), []);
  useEffect(() => () => slots.dispose(), [slots]);
  return (
    <PortsProvider ports={ports}>
      <SlotsProvider slots={slots}>
        <LiveApp />
      </SlotsProvider>
    </PortsProvider>
  );
}
