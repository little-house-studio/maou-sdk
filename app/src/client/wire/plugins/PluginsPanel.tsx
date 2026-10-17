/**
 * 插件中栏：磁盘插件开关 / 重载。live 与草稿站共用。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChromeMark } from "../icons/Marks";
import { t } from "../../i18n";
import { refreshThemeAndPlugins } from "../../plugin-ui";

export type PluginRow = {
  id: string;
  name: string;
  phase: string;
  enabled: boolean;
  error?: string;
  version?: string;
  ui?: boolean;
};

const PHASE_KEY: Record<string, string> = {
  declared: "plugins.phase.declared",
  waiting_deps: "plugins.phase.waiting",
  loading: "plugins.phase.loading",
  ready: "plugins.phase.ready",
  failed: "plugins.phase.failed",
  unloading: "plugins.phase.unloading",
  disabled: "plugins.phase.disabled",
};

function phaseLabel(phase: string): string {
  return t(PHASE_KEY[phase] ?? "plugins.phase.unknown");
}

export type PluginsPanelProps = {
  plugins?: readonly PluginRow[];
};

export function PluginsPanel({ plugins }: PluginsPanelProps) {
  const [rows, setRows] = useState<PluginRow[]>(() =>
    plugins ? [...plugins] : [],
  );
  const controlled = plugins !== undefined;

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    if (controlled) return;
    setLoading(true);
    try {
      const r = await fetch("/api/plugins");
      if (!r.ok) throw new Error(`读取插件失败 (${r.status})`);
      const j = await r.json();
      if (!Array.isArray(j.plugins)) throw new Error("插件列表格式无效");
      setRows(j.plugins);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [controlled]);

  useEffect(() => {
    if (controlled) {
      setRows([...plugins]);
      return;
    }
    void load();
  }, [controlled, plugins, load]);

  const mutate = async (url: string, body?: unknown) => {
    if (controlled || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(url, {
        method: "POST",
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (!r.ok) throw new Error(`插件操作失败 (${r.status})`);
      await load();
      await refreshThemeAndPlugins();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const reload = () => { void mutate("/api/plugins/reload"); };
  const toggle = (id: string, enabled: boolean) => {
    void mutate("/api/plugins/toggle", { id, enabled });
  };

  return (
    <section className="wire-plugins" aria-label={t("plugins.title")}>
      <div className="wire-plugins-sheet">
        <header className="wire-plugins-head">
          <ChromeMark kind="mode_plugins" size={18} decorative />
          <div className="wire-plugins-head-copy">
            <h2 className="wire-plugins-title">{t("plugins.title")}</h2>
            <p className="wire-plugins-sub">{t("plugins.sub")}</p>
          </div>
          <button
            type="button"
            className="wire-plugins-reload"
            disabled={controlled || busy || loading}
            onClick={reload}
          >
            {t("settings.plugins.reload")}
          </button>
        </header>
        {error ? <p role="alert">{error} <button type="button" disabled={busy || loading} onClick={() => void load()}>重试</button></p> : null}
        {loading ? <p role="status">加载插件…</p> : null}
        {rows.length === 0 ? (
          <div className="wire-plugins-empty">
            <p className="wire-plugins-sub">{t("settings.plugins.empty")}</p>
          </div>
        ) : (
          <ul className="wire-plugins-list">
            {rows.map((p) => (
              <li
                key={p.id}
                className={`wire-plugin-row is-${p.phase}${
                  p.enabled ? " is-on" : ""
                }`}
              >
                <label className="wire-plugin-toggle">
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    disabled={controlled || busy || loading}
                    onChange={(e) => toggle(p.id, e.target.checked)}
                  />
                  <span className="wire-plugin-copy">
                    <span className="wire-plugin-name">
                      {p.name}
                      {p.version ? (
                        <span className="wire-plugin-ver">{p.version}</span>
                      ) : null}
                    </span>
                    <span className="wire-plugin-meta">
                      {p.id}
                      {p.ui ? ` · ${t("plugins.hasUi")}` : ""}
                      {p.error ? ` · ${p.error}` : ""}
                    </span>
                  </span>
                </label>
                <span className={`wire-plugin-phase is-${p.phase}`}>
                  {phaseLabel(p.phase)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
