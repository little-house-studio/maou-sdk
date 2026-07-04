// ── 设置菜单（用 overlay 栈做多级菜单） ──────────────────────────────
//
// 一级菜单选设置项 → 关一级弹二级选具体值。
// 比 SettingsList 简单可控（SettingsList 对 CJK label 渲染有问题）。
//
// 从 agent.ts 拆出。函数接收 AgentDriver 引用（持有 tui/getProviders/
// getModels/setProviderModel/getApprovalMode/toast/getState）。

import { SelectList } from "@oh-my-pi/pi-tui";
import type { TUI, SelectItem } from "@oh-my-pi/pi-tui";
import { setTerminalMode } from "@little-house-studio/tools";
import { selectListTheme } from "../theme/themes.js";
import type { AgentDriver } from "../agent.js";

/** 设置菜单入口：弹一级菜单。 */
export function showSettings(driver: AgentDriver, tui: TUI): void {
  const agentName = driver.getAgentName();
  const currentMode = driver.getApprovalMode();
  // 一级菜单：设置项列表
  const pm = driver.getProviderModel();
  const items: SelectItem[] = [
    { value: "apiConfig", label: "API 配置", description: `当前: ${pm.provider}/${pm.model}` },
    { value: "approvalMode", label: "审批模式", description: `当前: ${currentMode}` },
  ];
  const list = new SelectList(items, 8, selectListTheme, { overflowSearch: false });
  const handle = tui.showOverlay(list, {
    anchor: "bottom-center",
    width: "100%",
    maxHeight: 8,
  });
  list.onSelect = (item) => {
    handle.hide();
    if (item.value === "approvalMode") {
      showApprovalModeSubmenu(driver, tui, agentName);
    } else if (item.value === "apiConfig") {
      showApiConfigSubmenu(driver, tui);
    }
  };
  list.onCancel = () => { handle.hide(); };
  tui.requestRender();
}

/** API 配置子菜单：先选 provider → 再选 model */
export function showApiConfigSubmenu(driver: AgentDriver, tui: TUI): void {
  const providers = driver.getProviders();
  if (providers.length === 0) {
    driver.toast("无可用 API 配置（~/.maou/config.json 为空）", "warn");
    return;
  }
  const providerItems: SelectItem[] = providers.map(p => ({
    value: p.id,
    label: p.name ?? p.id,
    description: p.id,
  }));
  const list = new SelectList(providerItems, 8, selectListTheme, { overflowSearch: false });
  const handle = tui.showOverlay(list, {
    anchor: "bottom-center",
    width: "100%",
    maxHeight: 10,
  });
  list.onSelect = (item) => {
    handle.hide();
    showModelSubmenu(driver, tui, item.value);
  };
  list.onCancel = () => { handle.hide(); };
  tui.requestRender();
}

/** Model 子菜单：选 provider 后选具体 model */
export function showModelSubmenu(driver: AgentDriver, tui: TUI, provider: string): void {
  const models = driver.getModels(provider);
  if (models.length === 0) {
    driver.toast(`provider ${provider} 下无可用模型`, "warn");
    return;
  }
  const modelItems: SelectItem[] = models.map(m => ({
    value: m.id,
    label: m.name ?? m.id,
    description: m.id,
  }));
  const list = new SelectList(modelItems, 8, selectListTheme, { overflowSearch: false });
  const handle = tui.showOverlay(list, {
    anchor: "bottom-center",
    width: "100%",
    maxHeight: 10,
  });
  list.onSelect = (item) => {
    handle.hide();
    driver.setProviderModel(provider, item.value);
    driver.toast(`API → ${provider}/${item.value}`, "ok");
  };
  list.onCancel = () => { handle.hide(); };
  tui.requestRender();
}

/** 二级菜单：审批模式选择（normal/auto/yolo） */
export function showApprovalModeSubmenu(driver: AgentDriver, tui: TUI, agentName: string): void {
  void driver; // 审批模式子菜单不直接用 driver（仅 toast 提示），但保留参数对称
  const subItems: SelectItem[] = [
    { value: "normal", label: "Normal", description: "每次命令需确认" },
    { value: "auto", label: "Auto", description: "小模型审核自动放行" },
    { value: "yolo", label: "Yolo", description: "全部放行不确认" },
  ];
  const subList = new SelectList(subItems, 8, selectListTheme, { overflowSearch: false });
  const subHandle = tui.showOverlay(subList, {
    anchor: "bottom-center",
    width: "100%",
    maxHeight: 8,
  });
  subList.onSelect = (item) => {
    subHandle.hide();
    setTerminalMode(agentName, item.value as "normal" | "auto" | "yolo");
    driver.toast(`审批模式 → ${item.value}`, "ok");
  };
  subList.onCancel = () => { subHandle.hide(); };
  tui.requestRender();
}
