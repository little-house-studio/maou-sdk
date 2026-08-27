import React, { useEffect, useMemo, useState } from "react";
import type { DraftApiConfig, DraftApiPreset, DraftApiProtocol } from "../types";
import {
  API_PROTOCOLS,
  PROTOCOL_LABEL,
  addApiPreset,
  emptyApiPreset,
  capabilitySummary,
  getDefaultPreset,
  isApiPresetValid,
  maskApiKey,
  removeApiPreset,
  setDefaultApiPreset,
  updateApiPreset,
  validateApiPreset,
} from "../api-settings";
import { ChromeMark } from "../icons/Marks";
import { PasteFillCard } from "../../settings/PasteFillCard";
import {
  applyDraftPasteToPresets,
  modelsFromParse,
  type ClipboardParseResult,
} from "../../settings/paste-fill";
import { parsePasteLocal } from "../paste-parse-local";

export type SettingsPanelProps = {
  api: DraftApiConfig;
  onApiChange: (next: DraftApiConfig) => void;
  /** Leave settings mode (e.g. back to chat). Optional when used as a mode page. */
  onClose?: () => void;
  /**
   * page — full mid content under mode tabs (default).
   * overlay — legacy drawer over chat (optional).
   */
  presentation?: "page" | "overlay";
};

/**
 * Draft settings surface. Currently ships API 设置 (presets list + editor).
 * Session-local — parent owns persistence across mode switches.
 */
export function SettingsPanel({
  api,
  onApiChange,
  onClose,
  presentation = "page",
}: SettingsPanelProps) {
  const [selected, setSelected] = useState(() =>
    Math.min(Math.max(0, api.defaultPreset), Math.max(0, api.presets.length - 1)),
  );
  const [revealKey, setRevealKey] = useState(false);
  const [pasteFlash, setPasteFlash] = useState<string[]>([]);
  const [pasteConfirm, setPasteConfirm] = useState<string[]>([]);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Keep selection in range when list shrinks
  const selectedSafe = Math.min(
    selected,
    Math.max(0, api.presets.length - 1),
  );
  const preset: DraftApiPreset | null = api.presets[selectedSafe] ?? null;
  const errors = useMemo(
    () => (preset ? validateApiPreset(preset) : {}),
    [preset],
  );
  const defaultP = getDefaultPreset(api);

  const patchSelected = (patch: Partial<DraftApiPreset>) => {
    if (!preset) return;
    onApiChange(updateApiPreset(api, selectedSafe, patch));
  };

  const onAdd = () => {
    const next = addApiPreset(api);
    onApiChange(next);
    setSelected(next.presets.length - 1);
    setRevealKey(false);
  };

  const onRemove = () => {
    if (!preset) return;
    const next = removeApiPreset(api, selectedSafe);
    onApiChange(next);
    setSelected((i) => Math.min(i, Math.max(0, next.presets.length - 1)));
    setRevealKey(false);
  };

  const onSetDefault = () => {
    if (!preset) return;
    onApiChange(setDefaultApiPreset(api, selectedSafe));
  };

  const applyClipboardParse = (parsed: ClipboardParseResult) => {
    const models = modelsFromParse(parsed);
    const flash: string[] = [];
    if (parsed.fields.base_url?.value) flash.push("base_url");
    if (parsed.fields.api_key?.value) flash.push("api_key");
    if (parsed.fields.protocol?.value) flash.push("protocol");
    if (models.length) flash.push("model");
    setPasteFlash(flash);
    setPasteConfirm(parsed.needsConfirm.filter((k) => flash.includes(k)));
    if (parsed.fields.api_key?.value) setRevealKey(true);
    const applied = applyDraftPasteToPresets(
      api.presets,
      selectedSafe,
      parsed,
      (n) => emptyApiPreset(n),
    );
    onApiChange({ ...api, presets: applied.presets });
    setSelected(applied.selected);
  };

  const fieldFlash = (name: string) =>
    `${pasteFlash.includes(name) ? " is-paste-filled" : ""}${
      pasteConfirm.includes(name) ? " is-paste-confirm" : ""
    }`;

  const isPage = presentation === "page";
  const rootClass = isPage
    ? "wire-settings-page"
    : "wire-settings-overlay";

  return (
    <div
      className={rootClass}
      role={isPage ? "region" : "dialog"}
      aria-modal={isPage ? undefined : true}
      aria-label="设置"
      data-settings-presentation={presentation}
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
            <span className="wire-settings-sub">草稿 · 仅本地会话</span>
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
              API 设置
            </button>
          </nav>

          <section
            className="wire-settings-section wire-settings-api"
            aria-labelledby="wire-settings-api-heading"
          >
            <div className="wire-settings-section-head">
              <h3 id="wire-settings-api-heading" className="wire-settings-h">
                API 设置
              </h3>
              <p className="wire-settings-desc">
                对齐 core/llm <code>APIPreset</code>：连接 + maxContext/maxTokens +
                视觉/推理/工具能力（guardrails 同名）。默认项对应 defaultPreset；草稿站不写入磁盘。
              </p>
              {defaultP ? (
                <p className="wire-settings-default-hint">
                  当前默认：
                  <strong>{defaultP.name}</strong>
                  <span className="wire-settings-muted">
                    {" "}
                    · {defaultP.model} · {PROTOCOL_LABEL[defaultP.protocol]} ·{" "}
                    {capabilitySummary(defaultP)}
                  </span>
                </p>
              ) : null}
            </div>

            <PasteFillCard parse={parsePasteLocal} onParsed={applyClipboardParse} />

            <div className="wire-settings-api-layout">
              <div className="wire-settings-preset-list" role="list">
                <div className="wire-settings-list-head">
                  <span>Presets</span>
                  <button
                    type="button"
                    className="wire-text-btn"
                    onClick={onAdd}
                    title="新增 preset"
                  >
                    + 新增
                  </button>
                </div>
                {api.presets.map((p, i) => {
                  const isDef = i === api.defaultPreset;
                  const isSel = i === selectedSafe;
                  const valid = isApiPresetValid(p);
                  return (
                    <button
                      key={`${p.name}-${i}`}
                      type="button"
                      role="listitem"
                      className={`wire-settings-preset-item${
                        isSel ? " is-selected" : ""
                      }${isDef ? " is-default" : ""}${
                        !valid ? " is-invalid" : ""
                      }`}
                      onClick={() => {
                        setSelected(i);
                        setRevealKey(false);
                      }}
                      title={p.url}
                    >
                      <span className="wire-settings-preset-name">
                        {p.name || "（未命名）"}
                      </span>
                      <span className="wire-settings-preset-meta">
                        {p.model || "—"}
                      </span>
                      <span
                        className="wire-settings-preset-caps"
                        title={capabilitySummary(p)}
                      >
                        {capabilitySummary(p)}
                      </span>
                      {isDef ? (
                        <span className="wire-settings-badge">默认</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <div className="wire-settings-preset-editor">
                {preset ? (
                  <>
                    <p className="wire-settings-editor-section-label">
                      连接 connection
                    </p>
                    <div className="wire-settings-field">
                      <label htmlFor="api-preset-name">名称 name</label>
                      <input
                        id="api-preset-name"
                        type="text"
                        value={preset.name}
                        onChange={(e) => patchSelected({ name: e.target.value })}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      {errors.name ? (
                        <span className="wire-settings-err">{errors.name}</span>
                      ) : null}
                    </div>

                    <div className={`wire-settings-field${fieldFlash("base_url")}`}>
                      <label htmlFor="api-preset-url">接口 URL</label>
                      <input
                        id="api-preset-url"
                        type="url"
                        value={preset.url}
                        onChange={(e) => patchSelected({ url: e.target.value })}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      {errors.url ? (
                        <span className="wire-settings-err">{errors.url}</span>
                      ) : null}
                    </div>

                    <div className={`wire-settings-field${fieldFlash("api_key")}`}>
                      <label htmlFor="api-preset-key">
                        API Key
                        <span className="wire-settings-muted"> · 默认脱敏</span>
                      </label>
                      <div className="wire-settings-key-row">
                        {revealKey ? (
                          <input
                            id="api-preset-key"
                            type="text"
                            value={preset.key}
                            onChange={(e) =>
                              patchSelected({ key: e.target.value })
                            }
                            autoComplete="off"
                            spellCheck={false}
                            className="wire-settings-key-input"
                          />
                        ) : (
                          <div
                            id="api-preset-key"
                            className="wire-settings-key-mask"
                            title="点击「显示」查看或编辑完整 key"
                          >
                            {maskApiKey(preset.key)}
                          </div>
                        )}
                        <button
                          type="button"
                          className="wire-text-btn"
                          onClick={() => setRevealKey((v) => !v)}
                          aria-pressed={revealKey}
                        >
                          {revealKey ? "隐藏" : "显示"}
                        </button>
                      </div>
                    </div>

                    <div className={`wire-settings-field${fieldFlash("model")}`}>
                      <label htmlFor="api-preset-model">模型 model</label>
                      <input
                        id="api-preset-model"
                        type="text"
                        value={preset.model}
                        onChange={(e) =>
                          patchSelected({ model: e.target.value })
                        }
                        autoComplete="off"
                        spellCheck={false}
                      />
                      {errors.model ? (
                        <span className="wire-settings-err">{errors.model}</span>
                      ) : null}
                    </div>

                    <div className={`wire-settings-field${fieldFlash("protocol")}`}>
                      <label htmlFor="api-preset-protocol">协议 protocol</label>
                      <select
                        id="api-preset-protocol"
                        value={preset.protocol}
                        onChange={(e) =>
                          patchSelected({
                            protocol: e.target.value as DraftApiProtocol,
                          })
                        }
                      >
                        {API_PROTOCOLS.map((p) => (
                          <option key={p} value={p}>
                            {PROTOCOL_LABEL[p]} ({p})
                          </option>
                        ))}
                      </select>
                      {errors.protocol ? (
                        <span className="wire-settings-err">
                          {errors.protocol}
                        </span>
                      ) : null}
                    </div>

                    <p className="wire-settings-editor-section-label">
                      上下文与输出 window
                    </p>
                    <div className="wire-settings-field-row">
                      <div className="wire-settings-field">
                        <label htmlFor="api-preset-max-context">
                          maxContext
                          <span className="wire-settings-muted">
                            {" "}
                            · 输入窗口 / 压缩预算
                          </span>
                        </label>
                        <input
                          id="api-preset-max-context"
                          type="number"
                          min={1024}
                          step={1024}
                          value={preset.maxContext}
                          onChange={(e) =>
                            patchSelected({
                              maxContext: Number(e.target.value) || 0,
                            })
                          }
                          autoComplete="off"
                        />
                        {errors.maxContext ? (
                          <span className="wire-settings-err">
                            {errors.maxContext}
                          </span>
                        ) : null}
                      </div>
                      <div className="wire-settings-field">
                        <label htmlFor="api-preset-max-tokens">
                          maxTokens
                          <span className="wire-settings-muted">
                            {" "}
                            · 单次输出上限
                          </span>
                        </label>
                        <input
                          id="api-preset-max-tokens"
                          type="number"
                          min={1}
                          step={256}
                          value={preset.maxTokens}
                          onChange={(e) =>
                            patchSelected({
                              maxTokens: Number(e.target.value) || 0,
                            })
                          }
                          autoComplete="off"
                        />
                        {errors.maxTokens ? (
                          <span className="wire-settings-err">
                            {errors.maxTokens}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <p className="wire-settings-editor-section-label">
                      模型能力 capabilities
                      <span className="wire-settings-muted">
                        {" "}
                        · 对齐 LLM guardrails
                      </span>
                    </p>
                    <div
                      className="wire-settings-caps"
                      role="group"
                      aria-label="模型能力"
                    >
                      <label className="wire-settings-cap-toggle">
                        <input
                          id="api-preset-vision"
                          type="checkbox"
                          checked={preset.supportsVision}
                          onChange={(e) =>
                            patchSelected({
                              supportsVision: e.target.checked,
                            })
                          }
                        />
                        <span>
                          <strong>视觉 supportsVision</strong>
                          <em>图片附件</em>
                        </span>
                      </label>
                      <label className="wire-settings-cap-toggle">
                        <input
                          id="api-preset-reasoning"
                          type="checkbox"
                          checked={preset.supportsReasoning}
                          onChange={(e) =>
                            patchSelected({
                              supportsReasoning: e.target.checked,
                            })
                          }
                        />
                        <span>
                          <strong>推理 supportsReasoning</strong>
                          <em>思考 / reasoning</em>
                        </span>
                      </label>
                      <label className="wire-settings-cap-toggle">
                        <input
                          id="api-preset-tools"
                          type="checkbox"
                          checked={preset.nativeToolCalling}
                          onChange={(e) =>
                            patchSelected({
                              nativeToolCalling: e.target.checked,
                            })
                          }
                        />
                        <span>
                          <strong>工具 nativeToolCalling</strong>
                          <em>原生 tool schema</em>
                        </span>
                      </label>
                    </div>
                    <p
                      className="wire-settings-cap-summary"
                      data-api-cap-summary
                    >
                      {capabilitySummary(preset)}
                    </p>

                    <div className="wire-settings-editor-actions">
                      <button
                        type="button"
                        className="wire-text-btn on"
                        disabled={selectedSafe === api.defaultPreset}
                        onClick={onSetDefault}
                        title="设为 defaultPreset"
                      >
                        设为默认
                      </button>
                      <button
                        type="button"
                        className="wire-text-btn wire-settings-danger"
                        onClick={onRemove}
                        title={
                          api.presets.length <= 1
                            ? "清空并重置为空白 preset"
                            : "删除此 preset"
                        }
                      >
                        {api.presets.length <= 1 ? "重置" : "删除"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="wire-empty sm">暂无 preset，请新增</div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
