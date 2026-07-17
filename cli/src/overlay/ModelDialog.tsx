/**
 * ModelDialog —— 模型选择：Provider → Model 两级（与 Ratatui buildOverlay 对齐）。
 */

import React, { useEffect, useMemo, useState } from "react";
import { Text } from "ink";
import { Overlay } from "./Overlay.js";
import { SelectList, type SelectItem } from "./SelectList.js";
import { useStore } from "../state/store.js";
import { useTheme } from "../theme/theme-context.js";
import type { AgentCliConfig } from "../types.js";
import { registerNestedEscapeBack } from "../hooks/escape-cancel.js";

export function ModelDialog({ config }: { config: AgentCliConfig }) {
  const t = useTheme();
  const { setProviderModel, toastMsg } = useStore();
  const [providerId, setProviderId] = useState<string | null>(null);

  useEffect(() => {
    registerNestedEscapeBack(() => {
      if (providerId) {
        setProviderId(null);
        return true;
      }
      return false;
    });
    return () => registerNestedEscapeBack(null);
  }, [providerId]);

  const providers = useMemo(() => config.getProviders?.() ?? [], [config]);

  const items: SelectItem[] = useMemo(() => {
    if (!providerId) {
      return providers.map((p) => {
        const n = (config.getModels?.(p.id) ?? []).length;
        return {
          value: `provider:${p.id}`,
          label: p.name ?? p.id,
          description: n > 0 ? `${n} 个模型` : "无模型",
        };
      });
    }
    return (config.getModels?.(providerId) ?? []).map((m) => ({
      value: `${providerId}\0${m.id}`,
      label: m.name ?? m.id,
      description: m.id,
    }));
  }, [config, providers, providerId]);

  const onSelect = (value: string) => {
    if (value.startsWith("provider:")) {
      setProviderId(value.slice("provider:".length) || null);
      return;
    }
    const [p, m] = value.split("\0");
    if (p && m) {
      setProviderModel(p, m);
      const preset = config.getPreset(p, m) as {
        maxContext?: number;
        maxTokens?: number;
      };
      useStore
        .getState()
        .setAgentMeta(
          useStore.getState().agentName,
          p,
          m,
          preset.maxContext ?? preset.maxTokens ?? 0,
        );
      toastMsg(`已切换 ${p}/${m}`, "ok");
    }
    useStore.getState().setOverlay(null);
  };

  const title = providerId
    ? `模型 · ${providers.find((p) => p.id === providerId)?.name ?? providerId}`
    : "选择 Provider";
  const footer = providerId
    ? "↑↓ 选择 · Enter 切换 · Esc 回 Provider"
    : "↑↓ 选择 · Enter 进入模型 · Esc 关闭";

  return (
    <Overlay title={title} footer={footer} width={50}>
      {items.length === 0 ? (
        <Text color={t.dim}>无可用模型（检查 ~/.maou/config.json）</Text>
      ) : (
        <SelectList items={items} onSelect={onSelect} />
      )}
    </Overlay>
  );
}
