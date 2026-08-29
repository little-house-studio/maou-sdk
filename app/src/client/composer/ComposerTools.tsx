import React, { useEffect, useRef, useState } from "react";
import { ModelCascadeMenu } from "../drafts/panels/ModelCascadeMenu";
import { ChromeMark } from "../drafts/icons/Marks";
import { ContextMeter } from "./ContextMeter";
import { CommandFlyout } from "./CommandFlyout";
import type { AppCommand } from "./commands";
import {
  filesToComposerImages,
  mergeComposerImages,
} from "./images";
import { t } from "../i18n";
import {
  PERMISSION_PRESET_IDS,
  isPermissionPresetId,
  permissionPresetLabel,
  permissionPresetName,
} from "../live/settings-adapters";
import type { ComposerProps } from "./types";

function planOn(input: string) {
  return /^\s*\/plan(?:\s|$)/i.test(input);
}

function nextPlanInput(input: string) {
  if (planOn(input)) return input.replace(/^\s*\/plan\s?/i, "");
  const body = input.trim();
  return body ? `/plan ${body}` : "/plan ";
}

export function ModelSeat(props: ComposerProps) {
  if (props.variant === "draft") {
    const agents = (props.agents ?? []).filter((a) => !a.stale);
    return (
      <label className="chip-select wire-composer-chip composer-chip">
        <span className="visually-hidden">Agent</span>
        <select
          value={
            agents.find((a) => a.name === props.agentName)?.id ??
            agents[0]?.id ??
            ""
          }
          onChange={(e) => {
            const a = agents.find((x) => x.id === e.target.value);
            if (a) props.onAgentChange?.(a.id);
          }}
          title="当前 agent"
          aria-label="Agent"
        >
          {agents.length === 0 ? (
            <option value="">无可用 agent</option>
          ) : (
            agents.map((a) => {
              const prefix =
                a.group === "project" ? a.projectName || "project" : "系统";
              const sub = `/${a.name}`;
              return (
                <option key={a.id} value={a.id}>
                  {prefix}
                  {a.parent ? ` › ${a.parent}${sub}` : sub}
                </option>
              );
            })
          )}
        </select>
      </label>
    );
  }
  return (
    <ModelCascadeMenu
      ref={props.modelMenuRef}
      className="wire-composer-model-cascade"
      provider={props.provider}
      model={props.model}
      providers={props.providers}
      models={props.models}
      onSelect={(p, m) => void props.onModelSelect?.(p, m)}
      onModelsLoaded={props.onModelsLoaded}
    />
  );
}

function selectedPresetId(preset: string, approval: string): string {
  if (isPermissionPresetId(preset)) return preset;
  if (approval === "yolo") return "open+yolo";
  if (approval === "auto") return "workspace+auto";
  return "workspace+ask";
}

const PRESET_COMMANDS: readonly AppCommand[] = PERMISSION_PRESET_IDS.map((id) => ({
  name: permissionPresetName(id),
  label: permissionPresetLabel(id),
  description: id,
}));

export function ApprovalSeat(props: ComposerProps) {
  const selected = selectedPresetId(props.permissionPreset || "", props.approval);
  const name = permissionPresetName(selected);
  const comment = permissionPresetLabel(selected);
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t)) return;
      if ((e.target as HTMLElement | null)?.closest?.("[data-composer-overlay=command]")) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const selectedIdx = Math.max(
    0,
    PRESET_COMMANDS.findIndex((c) => c.name === name),
  );
  const activeIdx = hoverIdx ?? selectedIdx;
  return (
    <div className="composer-approval" ref={wrapRef} data-composer-approval="">
      <button
        ref={btnRef}
        type="button"
        className="composer-approval-trigger wire-composer-approval-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${name} ${comment}`}
        title={`${name} · ${comment}`}
        onClick={() => {
          setHoverIdx(null);
          setOpen((v) => !v);
        }}
      >
        <span
          className={`wire-cascade-led is-${selected.includes("yolo") ? "yolo" : selected.includes("auto") ? "auto" : "normal"}`}
          aria-hidden
        />
        <span className="composer-approval-name">{name}</span>
      </button>
      <CommandFlyout
        open={open}
        anchor={btnRef.current}
        namePrefix=""
        items={PRESET_COMMANDS}
        activeIdx={activeIdx}
        onHighlight={setHoverIdx}
        onPick={(picked) => {
          const id = PERMISSION_PRESET_IDS.find((p) => permissionPresetName(p) === picked);
          if (id) props.onApprovalChange(id);
          setHoverIdx(null);
          setOpen(false);
        }}
      />
    </div>
  );
}

export function AttachTool(props: ComposerProps) {
  return (
    <button
      type="button"
      className="composer-tool-btn"
      title="挂文件 · @"
      aria-label="挂文件"
      onClick={() => {
        const v = props.input;
        const next = v && !/\s$/.test(v) && v.length > 0 ? `${v} @` : `${v}@`;
        props.onInputChange(next);
        props.inputRef.current?.focus();
      }}
    >
      @
    </button>
  );
}

export function ImageAttachTool(props: ComposerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        onChange={(e) => {
          const files = e.target.files;
          if (!files?.length) return;
          void filesToComposerImages(files, props.images?.length ?? 0)
            .then((extra) => {
              if (!extra.length) return;
              props.onImagesChange?.(
                mergeComposerImages(props.images ?? [], extra),
              );
            })
            .catch((err: unknown) => {
              window.alert(err instanceof Error ? err.message : String(err));
            });
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className="composer-tool-btn"
        title={t("composer.attach")}
        aria-label={t("composer.attach")}
        disabled={(props.images?.length ?? 0) >= 4}
        onClick={() => inputRef.current?.click()}
      >
        <ChromeMark kind="files" size={14} decorative />
      </button>
    </>
  );
}

export function MoreTools(props: ComposerProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div className="composer-more" ref={wrapRef}>
      <button
        type="button"
        className="composer-tool-btn"
        aria-expanded={open}
        aria-haspopup="menu"
        title="更多 · 计划 / 重试 / 复制"
        aria-label="更多"
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open ? (
        <div className="composer-more-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            aria-pressed={planOn(props.input)}
            onClick={() => {
              props.onInputChange(nextPlanInput(props.input));
              setOpen(false);
              props.inputRef.current?.focus();
            }}
          >
            {planOn(props.input) ? "退出计划" : "计划模式"}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!props.canRetry}
            onClick={() => {
              props.onRetryLast();
              setOpen(false);
            }}
          >
            重试上一条
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              props.onCopyTranscript();
              setOpen(false);
            }}
          >
            复制 transcript
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function UsageSeat(props: ComposerProps) {
  return <ContextMeter {...props} />;
}

export function PlanSeat(props: ComposerProps) {
  const on = props.planActive ?? planOn(props.input);
  const status = props.planStatus || (on ? "planning" : "off");
  return (
    <button
      type="button"
      className={`composer-plan${on ? " is-on" : ""}`}
      aria-pressed={on}
      title={`计划 ${status}`}
      onClick={() => {
        if (props.onPlanToggle) {
          props.onPlanToggle();
          return;
        }
        props.onInputChange(nextPlanInput(props.input));
        props.inputRef.current?.focus();
      }}
    >
      {on ? `计划 · ${status}` : "计划"}
    </button>
  );
}

export function RetryTool(props: ComposerProps) {
  return (
    <button
      type="button"
      className="composer-tool-btn"
      disabled={!props.canRetry}
      onClick={() => props.onRetryLast()}
      title="重试上一条"
      aria-label="重试上一条"
    >
      <ChromeMark kind="retry" size={14} decorative />
    </button>
  );
}

export function CopyTool(props: ComposerProps) {
  return (
    <button
      type="button"
      className="composer-tool-btn"
      onClick={() => props.onCopyTranscript()}
      title="复制 transcript"
      aria-label="复制 transcript"
    >
      <ChromeMark kind="copy" size={14} decorative />
    </button>
  );
}

export function LeftToolsFallback(props: ComposerProps) {
  return (
    <>
      <ImageAttachTool {...props} />
      <PlanSeat {...props} />
      <MoreTools {...props} />
    </>
  );
}
