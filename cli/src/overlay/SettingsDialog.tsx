/**
 * SettingsDialog —— 设置弹窗（Ctrl+, 触发）。
 * 一级菜单：API 配置 / 审批模式 / 思考级别。
 * 选 API 配置 → 进入二级模型选择（复用 ModelDialog 逻辑）。
 */

import React, { useMemo, useState } from "react";
import { Text } from "ink";
import { Overlay } from "./Overlay.js";
import { SelectList, type SelectItem } from "./SelectList.js";
import { useStore } from "../state/store.js";
import { useTheme } from "../theme/theme-context.js";
import type { AgentCliConfig } from "../types.js";

type View = "main" | "model" | "approval" | "thinking";

export function SettingsDialog({ config }: { config: AgentCliConfig }) {
  const t = useTheme();
  const { setProviderModel, setThinking, toastMsg } = useStore();
  const [view, setView] = useState<View>("main");

  const provider = useStore((s) => s.provider);
  const model = useStore((s) => s.model);
  const thinkingLevel = useStore((s) => s.thinkingLevel);

  const mainItems: SelectItem[] = useMemo(() => [
    { value: "model", label: "API 配置", description: `${provider}/${model || "未选"}` },
    { value: "approval", label: "审批模式", description: "normal" },
    { value: "thinking", label: "思考级别", description: `${thinkingLevel} (${["off", "minimal", "low", "medium", "high", "xhigh"][thinkingLevel]})` },
  ], [provider, model, thinkingLevel]);

  const modelItems: SelectItem[] = useMemo(() => {
    const providers = config.getProviders?.() ?? [];
    return providers.flatMap(p =>
      (config.getModels?.(p.id) ?? []).map(m => ({
        value: `${p.id}\0${m.id}`,
        label: `${p.name ?? p.id} // ${m.name ?? m.id}`,
      }))
    );
  }, [config]);

  const approvalItems: SelectItem[] = [
    { value: "normal", label: "Normal", description: "每次询问" },
    { value: "auto", label: "Auto", description: "小模型审核自动放行" },
    { value: "yolo", label: "Yolo", description: "全部执行不问" },
  ];

  const thinkingItems: SelectItem[] = [
    { value: "0", label: "Off", description: "关闭思考" },
    { value: "1", label: "Minimal", description: "最小" },
    { value: "2", label: "Low", description: "低" },
    { value: "3", label: "Medium", description: "中" },
    { value: "4", label: "High", description: "高" },
    { value: "5", label: "Xhigh", description: "超高" },
  ];

  const handleMain = (value: string) => {
    if (value === "model") setView("model");
    else if (value === "approval") setView("approval");
    else if (value === "thinking") setView("thinking");
  };

  const handleModel = (value: string) => {
    const [p, m] = value.split("\0");
    if (p && m) {
      setProviderModel(p, m);
      const preset = config.getPreset(p, m) as { maxContext?: number; maxTokens?: number };
      useStore.getState().setAgentMeta(useStore.getState().agentName, p, m, preset.maxContext ?? preset.maxTokens ?? 0);
      toastMsg(`已切换 ${p}/${m}`, "ok");
    }
    setView("main");
  };

  const handleApproval = (value: string) => {
    toastMsg(`审批模式 → ${value}（需重启生效）`, "info");
    setView("main");
  };

  const handleThinking = (value: string) => {
    setThinking(Number(value));
    toastMsg(`思考级别 → ${value}`, "ok");
    setView("main");
  };

  const items = view === "main" ? mainItems
    : view === "model" ? modelItems
    : view === "approval" ? approvalItems
    : thinkingItems;
  const onSelect = view === "main" ? handleMain
    : view === "model" ? handleModel
    : view === "approval" ? handleApproval
    : handleThinking;
  const title = view === "main" ? "设置" : view === "model" ? "API 配置" : view === "approval" ? "审批模式" : "思考级别";

  return (
    <Overlay title={title} footer="↑↓ 选择 · Enter 确认 · Esc 返回/关闭" width={52}>
      <SelectList items={items} onSelect={onSelect} innerWidth={52} />
    </Overlay>
  );
}
