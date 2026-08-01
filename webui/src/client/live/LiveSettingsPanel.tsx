/**
 * Production settings — live backend providers/models/current selection.
 * Not draft SettingsPanel (no showcase sk-draft keys / fake gpt-5 as SoT).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchMeta,
  fetchModels,
  setModel,
  type Meta,
} from "../api";
import { ChromeMark } from "../drafts/icons/Marks";
import {
  buildLiveSettingsSnapshot,
  emptyLiveSettingsSnapshot,
  resolveModelAfterProviderChange,
  type LiveSettingsSnapshot,
} from "./settings-adapters";

export type LiveSettingsPanelProps = {
  onClose?: () => void;
  /** Push updated Meta to shell topbar / chat after setModel */
  onMetaChange?: (meta: Meta) => void;
  presentation?: "page" | "overlay";
};

export function LiveSettingsPanel({
  onClose,
  onMetaChange,
  presentation = "page",
}: LiveSettingsPanelProps) {
  const [snap, setSnap] = useState<LiveSettingsSnapshot>(() =>
    emptyLiveSettingsSnapshot(true),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  // Stabilize parent callbacks — App may pass inline functions each render.
  const onMetaChangeRef = useRef(onMetaChange);
  onMetaChangeRef.current = onMetaChange;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  /** Last provider/model pushed to parent (avoid thrash on every reload). */
  const lastPushedRef = useRef<{ provider: string; model: string } | null>(
    null,
  );

  const applySnapshot = useCallback(
    (
      meta: Meta | null,
      catalogs?: {
        providers?: { id: string; name?: string }[];
        models?: { id: string; name?: string }[];
      },
      opts?: { notifyParent?: boolean },
    ) => {
      const next = buildLiveSettingsSnapshot(meta, catalogs);
      setSnap(next);
      if (!meta || opts?.notifyParent === false) return;
      const prev = lastPushedRef.current;
      const changed =
        !prev ||
        prev.provider !== meta.provider ||
        prev.model !== meta.model;
      if (changed) {
        lastPushedRef.current = {
          provider: meta.provider || "",
          model: meta.model || "",
        };
        onMetaChangeRef.current?.(meta);
      }
    },
    [],
  );

  const reload = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const meta = await fetchMeta();
      const md = await fetchModels(meta.provider || undefined);
      applySnapshot(md.meta.provider ? md.meta : meta, {
        providers: md.providers,
        models: md.models,
      });
      setStatus("已从后端同步");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSnap(emptyLiveSettingsSnapshot(true));
    } finally {
      setBusy(false);
    }
  }, [applySnapshot]);

  // Mount-once load — deps [] so parent re-renders never re-fire /api/meta loop.
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onProviderChange = async (provider: string) => {
    if (!provider || provider === snap.provider) return;
    setBusy(true);
    setError(null);
    try {
      const md = await fetchModels(provider);
      const model = resolveModelAfterProviderChange(
        md.models,
        snap.model,
      );
      if (!model) {
        setSnap((s) => ({
          ...s,
          provider,
          models: md.models,
          model: "",
        }));
        setStatus("该 provider 暂无模型列表");
        return;
      }
      const meta = await setModel(provider, model);
      const again = await fetchModels(provider);
      applySnapshot(meta, {
        providers: again.providers.length ? again.providers : snap.providers,
        models: again.models,
      });
      setStatus(`已切换 ${provider} · ${model}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onModelChange = async (model: string) => {
    if (!model || model === snap.model) return;
    const provider = snap.provider;
    if (!provider) {
      setError("无 provider，无法切换模型");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const meta = await setModel(provider, model);
      applySnapshot(meta, {
        providers: snap.providers,
        models: snap.models,
      });
      setStatus(`已切换模型 ${model}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const isPage = presentation === "page";
  const rootClass = isPage ? "wire-settings-page" : "wire-settings-overlay";

  return (
    <div
      className={rootClass}
      role={isPage ? "region" : "dialog"}
      aria-modal={isPage ? undefined : true}
      aria-label="设置"
      data-settings-presentation={presentation}
      data-live-settings="true"
    >
      {!isPage ? (
        <button
          type="button"
          className="wire-settings-backdrop"
          aria-label="关闭设置"
          onClick={() => onClose?.()}
        />
      ) : null}
      <div className="wire-settings-panel">
        <header className="wire-settings-head">
          <div className="wire-settings-title-row">
            <ChromeMark kind="settings" size={16} decorative />
            <h2 className="wire-settings-title">设置</h2>
            <span className="wire-settings-sub">
              live · 后端配置
            </span>
          </div>
          {onClose ? (
            <button
              type="button"
              className="wire-text-btn wire-settings-close"
              onClick={onClose}
              title="返回聊天"
            >
              返回
            </button>
          ) : null}
        </header>

        <div className="wire-settings-body">
          <nav className="wire-settings-nav" aria-label="设置分类">
            <button
              type="button"
              className="wire-settings-nav-item active"
              aria-current="page"
            >
              连接与模型
            </button>
          </nav>

          <section
            className="wire-settings-section wire-settings-api"
            aria-labelledby="live-settings-heading"
            data-live-settings-section="connection"
          >
            <div className="wire-settings-section-head">
              <h3 id="live-settings-heading" className="wire-settings-h">
                连接与模型
              </h3>
              <p className="wire-settings-desc">
                数据来自后端 <code>/api/meta</code> 与{" "}
                <code>/api/models</code>
                ；切换调用 <code>POST /api/model</code>
                。密钥由 CLI / 环境配置，浏览器不展示 showcase 假 key。
              </p>
              <p className="wire-settings-default-hint">
                当前：
                <strong data-live-current-provider={snap.provider}>
                  {snap.provider || "—"}
                </strong>
                <span className="wire-settings-muted">
                  {" "}
                  ·{" "}
                  <span data-live-current-model={snap.model}>
                    {snap.model || "—"}
                  </span>
                  {" · "}
                  {snap.statusLabel}
                </span>
              </p>
            </div>

            <div className="wire-settings-api-layout">
              <div className="wire-settings-preset-list" role="list">
                <div className="wire-settings-list-head">
                  <span>Providers</span>
                  <button
                    type="button"
                    className="wire-text-btn"
                    onClick={() => void reload()}
                    disabled={busy}
                    title="重新从后端拉取"
                  >
                    刷新
                  </button>
                </div>
                {snap.providers.length === 0 ? (
                  <div className="wire-settings-empty" role="status">
                    {snap.offline
                      ? "后端离线 · 无法列出 providers"
                      : "暂无 provider 列表"}
                  </div>
                ) : (
                  snap.providers.map((p) => {
                    const active = p.id === snap.provider;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="listitem"
                        className={`wire-settings-preset-item${
                          active ? " is-selected is-default" : ""
                        }`}
                        onClick={() => void onProviderChange(p.id)}
                        disabled={busy}
                        data-live-provider={p.id}
                      >
                        <span className="wire-settings-preset-name">
                          {p.name || p.id}
                        </span>
                        <span className="wire-settings-preset-meta">
                          {active ? "当前" : p.id}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>

              <div className="wire-settings-preset-editor">
                <label className="wire-settings-field">
                  <span className="wire-settings-label">Provider</span>
                  <select
                    className="wire-settings-input"
                    value={snap.provider}
                    disabled={busy || snap.providers.length === 0}
                    onChange={(e) => void onProviderChange(e.target.value)}
                    data-live-provider-select=""
                  >
                    {snap.providers.length === 0 ? (
                      <option value="">—</option>
                    ) : (
                      snap.providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name || p.id}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <label className="wire-settings-field">
                  <span className="wire-settings-label">Model</span>
                  <select
                    className="wire-settings-input"
                    value={snap.model}
                    disabled={busy || snap.models.length === 0}
                    onChange={(e) => void onModelChange(e.target.value)}
                    data-live-model-select=""
                  >
                    {snap.models.length === 0 ? (
                      <option value="">—</option>
                    ) : (
                      snap.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name || m.id}
                        </option>
                      ))
                    )}
                  </select>
                </label>

                <div className="wire-settings-field">
                  <span className="wire-settings-label">项目路径</span>
                  <code className="wire-settings-readonly" title={snap.projectRoot}>
                    {snap.projectRoot || "—"}
                  </code>
                </div>

                <div className="wire-settings-field-row">
                  <div className="wire-settings-field">
                    <span className="wire-settings-label">Sandbox</span>
                    <code className="wire-settings-readonly">
                      {snap.sandboxMode}
                    </code>
                  </div>
                  <div className="wire-settings-field">
                    <span className="wire-settings-label">审批模式</span>
                    <code className="wire-settings-readonly">
                      {snap.approvalMode}
                    </code>
                  </div>
                  <div className="wire-settings-field">
                    <span className="wire-settings-label">Agent</span>
                    <code className="wire-settings-readonly">
                      {snap.agentName}
                    </code>
                  </div>
                </div>

                <p className="wire-settings-desc">
                  API Key / base URL 由服务端 CLI 配置（
                  <code>maou setup</code> / 环境变量）解析，不在此页用 showcase
                  假数据冒充。
                </p>

                {error ? (
                  <p className="wire-settings-error" role="alert">
                    {error}
                  </p>
                ) : null}
                {status && !error ? (
                  <p className="wire-settings-status" role="status">
                    {busy ? "…" : status}
                  </p>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
