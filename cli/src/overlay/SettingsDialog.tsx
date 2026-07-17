/**
 * SettingsDialog —— 设置弹窗（Ctrl+, 触发）。
 * 一级菜单：Debug 显示 / API 配置 / 审批模式 / 思考级别 / 配色方案。
 */

import React, { useEffect, useMemo, useState } from "react";
import { Overlay } from "./Overlay.js";
import { SelectList, type SelectItem } from "./SelectList.js";
import { useStore } from "../state/store.js";
import {
  useTheme,
  useSetLoadedTheme,
  useLoadedTheme,
} from "../theme/theme-context.js";
import { registerNestedEscapeBack } from "../hooks/escape-cancel.js";
import type { AgentCliConfig } from "../types.js";
import {
  listThemesMeta,
  loadThemeById,
} from "../theme/load-theme.js";
import { setThemeBg } from "../render/vram-layer.js";
import { settingsForSurface } from "../config/cli-settings.js";

type View = "main" | "model" | "approval" | "thinking" | "theme";

export function SettingsDialog({ config }: { config: AgentCliConfig }) {
  const t = useTheme();
  const loaded = useLoadedTheme();
  const setLoadedTheme = useSetLoadedTheme();
  const setProviderModel = useStore((s) => s.setProviderModel);
  const setThinking = useStore((s) => s.setThinking);
  const toastMsg = useStore((s) => s.toastMsg);
  const [view, setView] = useState<View>("main");

  // Esc：二级页先返回一级，一级再关面板（统一取消栈 nested_back）
  useEffect(() => {
    registerNestedEscapeBack(() => {
      if (view !== "main") {
        setView("main");
        return true;
      }
      return false;
    });
    return () => registerNestedEscapeBack(null);
  }, [view]);

  const provider = useStore((s) => s.provider);
  const model = useStore((s) => s.model);
  const thinkingLevel = useStore((s) => s.thinkingLevel);
  const approvalMode = useStore((s) => s.approvalMode);
  const perfHud = useStore((s) => s.perfHud);
  const mouseCapture = useStore((s) => s.mouseCapture);
  const setApprovalMode = useStore((s) => s.setApprovalMode);
  const setMouseCapture = useStore((s) => s.setMouseCapture);

  const mainItems: SelectItem[] = useMemo(
    () =>
      settingsForSurface("ink", {
        provider,
        model,
        approvalMode,
        thinkingLevel,
        themeName: loaded.name || loaded.id,
        perfHud,
        mouseCapture,
      }),
    [
      provider,
      model,
      thinkingLevel,
      approvalMode,
      loaded.id,
      loaded.name,
      perfHud,
      mouseCapture,
    ],
  );

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

  const themeItems: SelectItem[] = useMemo(() => {
    return listThemesMeta().map((th) => ({
      value: th.id,
      label: th.name,
      description:
        th.id === loaded.id
          ? `当前 · ${th.source}`
          : th.source === "user"
            ? "用户 ~/.maou/themes"
            : "内置 assets/themes",
    }));
  }, [loaded.id]);

  const handleMain = (value: string) => {
    if (value === "model") setView("model");
    else if (value === "approval") setView("approval");
    else if (value === "thinking") setView("thinking");
    else if (value === "theme") setView("theme");
    else if (value === "perf_hud") {
      const st = useStore.getState();
      const on =
        typeof st.togglePerfHud === "function"
          ? st.togglePerfHud()
          : (() => {
              const next = !st.perfHud;
              st.setPerfHud?.(next);
              return next;
            })();
      toastMsg(on ? "Debug 显示已开启（已保存）" : "Debug 显示已关闭（已保存）", "ok");
    } else if (value === "mouse") {
      const next = !mouseCapture;
      setMouseCapture(next);
      toastMsg(next ? "鼠标捕获已开启（已保存）" : "鼠标捕获已关闭（已保存）", "ok");
    }
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
    if (value === "normal" || value === "auto" || value === "yolo") {
      setApprovalMode(value);
      toastMsg(`审核模式 → ${value}`, "ok");
    }
    setView("main");
  };

  const handleThinking = (value: string) => {
    setThinking(Number(value));
    toastMsg(`思考级别 → ${value}`, "ok");
    setView("main");
  };

  const handleTheme = (value: string) => {
    const th = loadThemeById(value);
    if (th) {
      setLoadedTheme(th, true);
      setThemeBg(th.tokens.bg);
      toastMsg(`配色 → ${th.name}`, "ok");
    } else {
      toastMsg(`未找到主题 ${value}`, "err");
    }
    setView("main");
  };

  const items =
    view === "main"
      ? mainItems
      : view === "model"
        ? modelItems
        : view === "approval"
          ? approvalItems
          : view === "theme"
            ? themeItems
            : thinkingItems;
  const onSelect =
    view === "main"
      ? handleMain
      : view === "model"
        ? handleModel
        : view === "approval"
          ? handleApproval
          : view === "theme"
            ? handleTheme
            : handleThinking;
  const title =
    view === "main"
      ? "设置"
      : view === "model"
        ? "API 配置"
        : view === "approval"
          ? "审批模式"
          : view === "theme"
            ? "配色方案"
            : "思考级别";

  return (
    <Overlay title={title} footer="↑↓ 选择 · Enter 确认 · Esc 返回/关闭" width={52}>
      <SelectList items={items} onSelect={onSelect} innerWidth={52} />
    </Overlay>
  );
}
