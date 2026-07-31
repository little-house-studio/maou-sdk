import type { DraftMeta, ScenarioId, UiMode } from "../types";
import { SCENARIO_CATALOG } from "../fixtures";
import { chromeMarkForMode } from "../visual-marks";
import { ChromeMark } from "../icons/Marks";

export type WireTopbarProps = {
  mode: UiMode;
  onModeChange: (m: UiMode) => void;
  meta: DraftMeta;
  usageLabel: string;
  showFiles: boolean;
  onToggleFiles: () => void;
  scenarioId: ScenarioId;
  onScenarioChange: (id: ScenarioId) => void;
};

const MODES: { id: UiMode; label: string }[] = [
  { id: "chat", label: "聊天" },
  { id: "project", label: "项目" },
  { id: "team", label: "Team" },
];

/** 顶栏：图标 + 标签，主操作更醒目 */
export function WireTopbar({
  mode,
  onModeChange,
  meta,
  usageLabel,
  showFiles,
  onToggleFiles,
  scenarioId,
  onScenarioChange,
}: WireTopbarProps) {
  return (
    <header className="wire-topbar">
      <div className="wire-topbar-left">
        <span className="wire-wordmark" title="UI 草稿">
          <ChromeMark kind="brand" size={14} decorative />
          Maou
        </span>
        <nav className="wire-mode-tabs" role="tablist" aria-label="界面模式">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              className={mode === m.id ? "active" : ""}
              onClick={() => onModeChange(m.id)}
            >
              <ChromeMark kind={chromeMarkForMode(m.id)} size={13} decorative />
              {m.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="wire-topbar-center" aria-label="功能">
        <div className="wire-action-group">
          <button type="button" className="wire-icon-only" title="新建">
            <ChromeMark kind="new" size={15} decorative />
          </button>
          <button type="button" className="wire-icon-only" title="停止">
            <ChromeMark kind="stop" size={14} decorative />
          </button>
          <button type="button" className="wire-icon-only" title="刷新">
            <ChromeMark kind="refresh" size={15} decorative />
          </button>
        </div>
        <span className="wire-sep" aria-hidden />
        <label className="wire-select-wrap">
          <select
            className="wire-select"
            value={scenarioId}
            aria-label="场景"
            onChange={(e) => onScenarioChange(e.target.value as ScenarioId)}
            title={
              SCENARIO_CATALOG.find((s) => s.id === scenarioId)?.description
            }
          >
            {SCENARIO_CATALOG.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="wire-topbar-right">
        <span
          className={`wire-meta${meta.offline ? " is-off" : ""}`}
          title={`${meta.provider || "—"} / ${meta.model || "—"} · ${usageLabel}`}
        >
          <span className="wire-meta-model">
            {meta.model || meta.provider || "离线"}
          </span>
          <span className="wire-meta-dim">{usageLabel}</span>
        </span>
        <button type="button" className="wire-icon-only" title="设置">
          <ChromeMark kind="settings" size={15} decorative />
        </button>
        <button
          type="button"
          className={`wire-text-btn${showFiles ? " on" : ""}`}
          onClick={onToggleFiles}
        >
          <ChromeMark kind="files" size={14} decorative />
          文件
        </button>
      </div>
    </header>
  );
}
