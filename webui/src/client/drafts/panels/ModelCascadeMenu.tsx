/**
 * Provider → Model 多级菜单（合并原双 select）
 * 触发器 chip；面板 portal 到 body，fixed 定位，避免 composer overflow 裁切。
 */
import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import { createPortal } from "react-dom";
import { fetchModels } from "../../api";

export type ModelOption = { id: string; name?: string };
export type ProviderOption = { id: string; name?: string };

export type ModelCascadeMenuProps = {
  provider: string;
  model: string;
  providers: ProviderOption[];
  /** 当前 provider 下已缓存的 models（父级可先塞入） */
  models: ModelOption[];
  onSelect: (provider: string, model: string) => void | Promise<void>;
  /** 父级同步 models 列表（切换 provider 预览时） */
  onModelsLoaded?: (provider: string, models: ModelOption[]) => void;
  className?: string;
  disabled?: boolean;
};

export type ModelCascadeMenuHandle = {
  focus: () => void;
  open: () => void;
};

function shortLabel(provider: string, model: string): string {
  const p = (provider || "—").trim();
  const m = (model || "—").trim();
  if (!p || p === "—") return m || "选择模型";
  if (p === m) return m;
  const max = 28;
  const s = `${p} · ${m}`;
  return s.length > max ? `${m.slice(0, max - 1)}…` : s;
}

type PanelPos = { left: number; top: number; openUp: boolean; minWidth: number };

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
    className = "",
    disabled = false,
  },
  ref,
) {
  const uid = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [hoverProvider, setHoverProvider] = useState(provider || "");
  const [panelModels, setPanelModels] = useState<ModelOption[]>(models);
  const [loading, setLoading] = useState(false);
  const [pos, setPos] = useState<PanelPos | null>(null);
  const cacheRef = useRef<Map<string, ModelOption[]>>(new Map());

  useImperativeHandle(ref, () => ({
    focus: () => triggerRef.current?.focus(),
    open: () => {
      setOpen(true);
      setHoverProvider(provider || providers[0]?.id || "");
    },
  }));

  useEffect(() => {
    if (provider && models.length) {
      cacheRef.current.set(provider, models);
      if (hoverProvider === provider || !hoverProvider) {
        setPanelModels(models);
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
    [onModelsLoaded],
  );

  useEffect(() => {
    if (!open) return;
    const pid = hoverProvider || provider || providers[0]?.id || "";
    if (pid) void loadProviderModels(pid);
  }, [open, hoverProvider, provider, providers, loadProviderModels]);

  const updatePos = useCallback(() => {
    const trig = triggerRef.current;
    if (!trig) return;
    const r = trig.getBoundingClientRect();
    const panelH = panelRef.current?.offsetHeight ?? 280;
    const panelW = Math.max(340, Math.min(440, window.innerWidth - 16));
    const gap = 6;
    const spaceAbove = r.top;
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceAbove >= panelH + gap || spaceAbove > spaceBelow;

    let top = openUp ? r.top - gap - panelH : r.bottom + gap;
    // clamp vertical
    top = Math.max(8, Math.min(top, window.innerHeight - 8 - Math.min(panelH, window.innerHeight - 16)));

    let left = r.left;
    // keep panel in viewport
    left = Math.max(8, Math.min(left, window.innerWidth - panelW - 8));

    setPos({
      left,
      top,
      openUp,
      minWidth: Math.max(r.width, 280),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    updatePos();
    // second pass after paint (panel measured)
    const id = requestAnimationFrame(() => updatePos());
    return () => cancelAnimationFrame(id);
  }, [open, panelModels, loading, hoverProvider, updatePos]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => updatePos();
    const onResize = () => updatePos();
    window.addEventListener("resize", onResize);
    // capture scroll from any scrollable ancestor
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, updatePos]);

  // outside click / escape
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = async (pid: string, mid: string) => {
    setOpen(false);
    await onSelect(pid, mid);
  };

  const list = providers.length
    ? providers
    : provider
      ? [{ id: provider, name: provider }]
      : [];

  const panel =
    open && typeof document !== "undefined" ? (
      <div
        ref={panelRef}
        id={`${uid}-panel`}
        className={`model-cascade-panel xp-skin${pos?.openUp ? " is-up" : " is-down"}`}
        role="menu"
        aria-label="选择方案与模型"
        style={
          pos
            ? {
                position: "fixed",
                left: pos.left,
                top: pos.top,
                minWidth: Math.max(pos.minWidth, 360),
                zIndex: 10050,
              }
            : {
                position: "fixed",
                left: -9999,
                top: 0,
                visibility: "hidden",
                zIndex: 10050,
              }
        }
      >
        {/* Luna title bar */}
        <div className="model-cascade-titlebar" aria-hidden>
          <span className="model-cascade-titlebar-icon" />
          <span className="model-cascade-titlebar-text">选择模型</span>
          <button
            type="button"
            className="model-cascade-titlebar-close"
            tabIndex={-1}
            onClick={() => {
              setOpen(false);
              triggerRef.current?.focus();
            }}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <div className="model-cascade-body">
          <div className="model-cascade-col model-cascade-providers">
            <div className="model-cascade-col-head">方案</div>
            <ul className="model-cascade-list" role="none">
              {list.map((p) => {
                const active =
                  (hoverProvider || provider) === p.id ||
                  (!hoverProvider && provider === p.id);
                const selected = provider === p.id;
                return (
                  <li key={p.id} role="none">
                    <button
                      type="button"
                      role="menuitem"
                      className={`model-cascade-item${
                        active ? " is-active" : ""
                      }${selected ? " is-selected" : ""}`}
                      onMouseEnter={() => {
                        setHoverProvider(p.id);
                        void loadProviderModels(p.id);
                      }}
                      onFocus={() => {
                        setHoverProvider(p.id);
                        void loadProviderModels(p.id);
                      }}
                      onClick={() => {
                        setHoverProvider(p.id);
                        void loadProviderModels(p.id);
                      }}
                    >
                      <span className="model-cascade-item-text">
                        {p.name || p.id}
                      </span>
                      <span className="model-cascade-item-arrow" aria-hidden>
                        ►
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="model-cascade-col model-cascade-models">
            <div className="model-cascade-col-head">
              模型
              {loading ? (
                <span className="model-cascade-loading">…</span>
              ) : null}
            </div>
            <ul className="model-cascade-list" role="none">
              {panelModels.length === 0 ? (
                <li className="model-cascade-empty">
                  {loading ? "加载中…" : "无模型"}
                </li>
              ) : (
                panelModels.map((m) => {
                  const pid = hoverProvider || provider;
                  const selected = provider === pid && model === m.id;
                  return (
                    <li key={m.id} role="none">
                      <button
                        type="button"
                        role="menuitem"
                        className={`model-cascade-item${
                          selected ? " is-selected" : ""
                        }`}
                        onClick={() => void pick(pid, m.id)}
                      >
                        <span className="model-cascade-item-text">
                          {m.name || m.id}
                        </span>
                        {selected ? (
                          <span className="model-cascade-check" aria-hidden>
                            ✓
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </div>

        <div className="model-cascade-statusbar" aria-hidden>
          <span>
            {(hoverProvider || provider || "—") +
              (loading ? " · 加载中" : "")}
          </span>
        </div>
      </div>
    ) : null;

  return (
    <div
      ref={rootRef}
      className={`model-cascade xp-skin ${open ? "is-open" : ""} ${className}`.trim()}
      data-model-cascade="true"
    >
      <button
        ref={triggerRef}
        type="button"
        className="model-cascade-trigger"
        disabled={disabled || list.length === 0}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${uid}-panel`}
        title={`${provider || "—"} / ${model || "—"} · 下一轮生效 · Ctrl+M`}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => {
            const next = !v;
            if (next) {
              setHoverProvider(provider || list[0]?.id || "");
            }
            return next;
          });
        }}
      >
        <span className="model-cascade-trigger-label">
          {shortLabel(provider, model)}
        </span>
        <span className="model-cascade-chevron" aria-hidden>
          <span className="model-cascade-chevron-glyph">▼</span>
        </span>
      </button>

      {panel && createPortal(panel, document.body)}
    </div>
  );
});
