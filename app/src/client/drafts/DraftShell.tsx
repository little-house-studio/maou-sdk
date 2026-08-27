import { useEffect, useMemo } from "react";
import type { DraftShellProps } from "./types";
import { PortsProvider } from "../ports";
import { createDraftPorts } from "../ports/draft";
import { SlotsProvider, SlotOutlet } from "../slots";
import { createDraftHostSlots } from "../host/draft-slots";
import { useDraftHostBag } from "../host/draft-state";
import "./draft.css";
import "../composer/composer.css";

/**
 * Wireframe shell (see product sketch):
 *  top:  界面模式 | 功能按键 | 设置与 token | 文件 / diff
 *  left: agent 列表 / 会话列表
 *  mid:  后台列表 / 上下文 / 输入
 *  right: 文件列表
 *  bottom: 停靠卡片轨（日志/待办/终端/agent/任务）
 */
function DraftApp(props: DraftShellProps) {
  const bag = useDraftHostBag(props);
  return <SlotOutlet name="root" props={bag} />;
}

export function DraftShell({
  initialScenarioId = "normal",
  initialSettingsOpen = false,
}: DraftShellProps) {
  const ports = useMemo(() => createDraftPorts(), []);
  const slots = useMemo(() => createDraftHostSlots(), []);
  useEffect(() => () => slots.dispose(), [slots]);
  return (
    <PortsProvider ports={ports}>
      <SlotsProvider slots={slots}>
        <DraftApp
          initialScenarioId={initialScenarioId}
          initialSettingsOpen={initialSettingsOpen}
        />
      </SlotsProvider>
    </PortsProvider>
  );
}
