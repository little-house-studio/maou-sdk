/**
 * ModelDialog —— 模型选择（getProviders/getModels 两级）。
 * 阶段 4 简化：列出所有 provider/model 组合，单级选择。
 */

import React, { useMemo } from "react";
import { Text } from "ink";
import { Overlay } from "./Overlay.js";
import { SelectList, type SelectItem } from "./SelectList.js";
import { useStore } from "../state/store.js";
import { useTheme } from "../theme/theme-context.js";
import type { AgentCliConfig } from "../types.js";

export function ModelDialog({ config }: { config: AgentCliConfig }) {
  const t = useTheme();
  const { setProviderModel, toastMsg } = useStore();

  const items: SelectItem[] = useMemo(() => {
    const providers = config.getProviders?.() ?? [];
    return providers.flatMap(p =>
      (config.getModels?.(p.id) ?? []).map(m => ({
        value: `${p.id}\0${m.id}`,
        label: `${p.name ?? p.id} // ${m.name ?? m.id}`,
      }))
    );
  }, [config]);

  const onSelect = (value: string) => {
    const [p, m] = value.split("\0");
    if (p && m) {
      setProviderModel(p, m);
      const preset = config.getPreset(p, m) as { maxContext?: number; maxTokens?: number };
      useStore.getState().setAgentMeta(useStore.getState().agentName, p, m, preset.maxContext ?? preset.maxTokens ?? 0);
      toastMsg(`已切换 ${p}/${m}`, "ok");
    }
    useStore.getState().setOverlay(null);
  };

  return (
    <Overlay title="模型" footer="↑↓ 选择 · Enter 切换 · Esc 关闭" width={50}>
      {items.length === 0 ? (
        <Text color={t.dim}>无可用模型（检查 ~/.maou/config.json）</Text>
      ) : (
        <SelectList items={items} onSelect={onSelect} />
      )}
    </Overlay>
  );
}
