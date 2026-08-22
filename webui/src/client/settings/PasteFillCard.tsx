import React, { useRef, useState } from "react";
import {
  PASTE_FIELD_LABEL,
  PASTE_FIELDS,
  modelsFromParse,
  summarizePaste,
  type ClipboardParseResult,
  type PasteFieldName,
} from "./paste-fill";

export type PasteFillCardProps = {
  parse: (raw: string) => Promise<ClipboardParseResult>;
  onParsed: (result: ClipboardParseResult) => void;
  disabled?: boolean;
};

/**
 * 快递单式粘贴：贴一段乱文本，回调填表。不落盘。
 */
export function PasteFillCard({ parse, onParsed, disabled }: PasteFillCardProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<ClipboardParseResult | null>(null);
  const seq = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setLast(null);
      setStatus("");
      setError(null);
      return;
    }
    const id = ++seq.current;
    setBusy(true);
    setError(null);
    setStatus("正在识别…");
    try {
      const result = await parse(trimmed);
      if (id !== seq.current) return;
      setLast(result);
      setStatus(summarizePaste(result));
      onParsed(result);
    } catch (e) {
      if (id !== seq.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setStatus("");
    } finally {
      if (id === seq.current) setBusy(false);
    }
  };

  const schedule = (raw: string) => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void run(raw), 480);
  };

  const chips = last
    ? PASTE_FIELDS.filter((k) => last.fields[k]?.value).map((k) => ({
        id: k,
        confirm: last.needsConfirm.includes(k),
      }))
    : [];
  const modelIds = last ? modelsFromParse(last) : [];

  return (
    <div className="wire-paste-fill" data-paste-fill="true">
      <div className="wire-paste-fill-head">
        <span className="wire-paste-fill-title">粘贴识别</span>
        <span className="wire-paste-fill-meta">像填快递单 · 不自动保存</span>
      </div>
      <p className="wire-paste-fill-hint">
        把配置、密钥、接口整段贴进来。同一厂商下的多个模型会一次填进表单，共用 URL / Key，确认后再保存。
      </p>
      <textarea
        className="wire-paste-fill-input"
        data-paste-fill-input=""
        value={text}
        disabled={disabled || busy}
        spellCheck={false}
        autoComplete="off"
        rows={5}
        placeholder={"粘贴 TOML / JSON / 密钥和网址…\n例如 api_key、base_url、models、wire_api"}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          schedule(v);
        }}
        onPaste={(e) => {
          const clip = e.clipboardData.getData("text");
          if (!clip.trim()) return;
          const next = clip;
          // 等受控 value 更新后再识别整段
          requestAnimationFrame(() => {
            const el = e.target as HTMLTextAreaElement;
            void run(el.value || next);
          });
        }}
      />
      <div className="wire-paste-fill-actions">
        <button
          type="button"
          className="wire-text-btn on"
          disabled={disabled || busy || !text.trim()}
          data-paste-fill-run=""
          onClick={() => void run(text)}
        >
          {busy ? "识别中" : "识别"}
        </button>
        <button
          type="button"
          className="wire-text-btn"
          disabled={disabled || busy || !text}
          onClick={() => {
            setText("");
            setLast(null);
            setStatus("");
            setError(null);
          }}
        >
          清空
        </button>
        {chips.length ? (
          <span className="wire-paste-fill-chips" data-paste-fill-chips="">
            {chips.map((c) => (
              <span
                key={c.id}
                className={`wire-paste-fill-chip${c.confirm ? " is-confirm" : ""}`}
                data-paste-chip={c.id}
              >
                {PASTE_FIELD_LABEL[c.id as PasteFieldName]}
                {c.id === "model" && modelIds.length > 1 ? ` · ${modelIds.length}` : ""}
                {c.confirm ? " · 请核对" : ""}
              </span>
            ))}
            {modelIds.slice(0, 12).map((id) => (
              <span
                key={`m-${id}`}
                className="wire-paste-fill-chip is-model"
                data-paste-model={id}
              >
                {id}
              </span>
            ))}
            {modelIds.length > 12 ? (
              <span className="wire-paste-fill-chip is-model">等 {modelIds.length} 个</span>
            ) : null}
          </span>
        ) : null}
      </div>
      {error ? (
        <p className="wire-paste-fill-err" data-paste-fill-error="">
          {error}
        </p>
      ) : status ? (
        <p className="wire-paste-fill-status" data-paste-fill-status="">
          {status}
        </p>
      ) : null}
    </div>
  );
}
