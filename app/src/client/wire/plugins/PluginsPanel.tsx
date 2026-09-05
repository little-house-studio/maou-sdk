/**
 * 插件中栏：磁盘插件开关 / 重载。live 与草稿站共用。
 */
import React, { useCallback, useEffect, useState } from "react";
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

  const load = useCallback(() => {
    if (controlled) return;
    void fetch("/api/plugins")
      .then((r) => r.json())
      .then((j) => {
        if (Array.isArray(j.plugins)) setRows(j.plugins);
      })
      .catch(() => setRows([]));
  }, [controlled]);

  useEffect(() => {
    if (controlled) {
      setRows([...plugins]);
      return;
    }
    load();
  }, [controlled, plugins, load]);

  const reload = () => {
    void fetch("/api/plugins/reload", { method: "POST" }).then(() => {
      load();
      void refreshThemeAndPlugins();
    });
  };

  const toggle = (id: string, enabled: boolean) => {
    void fetch("/api/plugins/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    }).then(() => {
      load();
      void refreshThemeAndPlugins();
    });
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
            onClick={reload}
          >
            {t("settings.plugins.reload")}
          </button>
        </header>
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
