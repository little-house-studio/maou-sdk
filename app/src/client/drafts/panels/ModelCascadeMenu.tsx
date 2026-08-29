/**
 * Provider → Model 两级菜单，外壳走 CascadeMenu。
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useAppPorts } from "../../ports";
import {
  CascadeMenu,
  type CascadeColumn,
  type CascadeMenuHandle,
} from "./CascadeMenu";
import { t } from "../../i18n";

export type ModelOption = { id: string; name?: string };
export type ProviderOption = { id: string; name?: string };

export type ModelCascadeMenuProps = {
  provider: string;
  model: string;
  providers: readonly ProviderOption[];
  models: readonly ModelOption[];
  onSelect: (provider: string, model: string) => void | Promise<void>;
  onModelsLoaded?: (provider: string, models: ModelOption[]) => void;
  onOpenSettings?: () => void;
  className?: string;
  disabled?: boolean;
};

export type ModelCascadeMenuHandle = CascadeMenuHandle;

function shortLabel(provider: string, model: string): string {
  const p = (provider || "—").trim();
  const m = (model || "—").trim();
  if (!p || p === "—") return m || "选择模型";
  if (p === m) return m;
  return p;
}

export const ModelCascadeMenu = forwardRef<
  ModelCascadeMenuHandle,
  ModelCascadeMenuProps
>(function ModelCascadeMenu(
  {
    provider,
    model,
    providers,
    models,
    onSelect,
    onModelsLoaded,
    onOpenSettings,
    className = "",
    disabled = false,
  },
  ref,
) {
  const { fetchModels } = useAppPorts().models;
  const innerRef = useRef<CascadeMenuHandle | null>(null);
  const [hoverProvider, setHoverProvider] = useState(provider || "");
  const [panelModels, setPanelModels] = useState<ModelOption[]>(() => [...models]);
  const [loading, setLoading] = useState(false);
  const cacheRef = useRef<Map<string, ModelOption[]>>(new Map());

  useImperativeHandle(ref, () => ({
    focus: () => innerRef.current?.focus(),
    open: () => innerRef.current?.open(),
    close: () => innerRef.current?.close(),
  }));

  useEffect(() => {
    if (provider && models.length) {
      cacheRef.current.set(provider, [...models]);
      if (hoverProvider === provider || !hoverProvider) {
        setPanelModels([...models]);
      }
    }
  }, [provider, models, hoverProvider]);

  const loadProviderModels = useCallback(
    async (pid: string) => {
      if (!pid) return;
      const hit = cacheRef.current.get(pid);
      if (hit) {
        setPanelModels(hit);
        return;
      }
      setLoading(true);
      try {
        const md = await fetchModels(pid);
        const list = md.models ?? [];
        cacheRef.current.set(pid, list);
        setPanelModels(list);
        onModelsLoaded?.(pid, list);
      } catch {
        setPanelModels([]);
      } finally {
        setLoading(false);
      }
    },
    [onModelsLoaded, fetchModels],
  );

  const list = providers.length
    ? providers
    : provider
      ? [{ id: provider, name: provider }]
      : [];

  const preview = hoverProvider || provider || list[0]?.id || "";

  const columns: CascadeColumn[] = [
    {
      key: "providers",
      heading: "方案",
      items: (list.length
        ? list
        : [{ id: "__empty__", name: t("composer.model.empty") }]
      ).map((p) => ({
        id: p.id,
        label: p.name || p.id,
        selected: provider === p.id,
        active: preview === p.id,
        trailing: "arrow" as const,
        dismiss: false,
        onHover: () => {
          setHoverProvider(p.id);
          void loadProviderModels(p.id);
        },
        onSelect: () => {
          if (p.id === "__empty__") {
            onOpenSettings?.();
            window.dispatchEvent(new CustomEvent("maou-open-settings"));
            return;
          }
          setHoverProvider(p.id);
          void loadProviderModels(p.id);
        },
      })),
    },
    {
      key: "models",
      heading: "模型",
      loading,
      empty: loading ? "加载中…" : "无模型",
      items: panelModels.map((m) => {
        const selected = provider === preview && model === m.id;
        return {
          id: m.id,
          label: m.name || m.id,
          selected,
          trailing: selected ? ("check" as const) : null,
          onSelect: () => {
            void onSelect(preview, m.id);
          },
        };
      }),
    },
  ];

  return (
    <CascadeMenu
      ref={innerRef}
      className={`model-cascade wire-composer-model-cascade ${className}`.trim()}
      triggerClassName="model-cascade-trigger"
      disabled={disabled}
      triggerLabel={shortLabel(provider, model)}
      triggerTitle={`${provider || "—"} / ${model || "—"} · 下一轮生效 · Ctrl+M`}
      ariaLabel={t("composer.model")}
      columns={columns}
      onOpen={() => {
        const pid = provider || list[0]?.id || "";
        setHoverProvider(pid);
        if (pid) void loadProviderModels(pid);
      }}
    />
  );
});
