import React, { useEffect, useRef, useState } from "react";
import {
  APPROVAL_LABELS,
  APPROVAL_MODES,
  APPROVAL_TITLES,
  type ApprovalSwitchMode,
} from "../drafts/panels/ApprovalPhysicsSwitch";
import { CascadeMenu } from "../drafts/panels/CascadeMenu";
import { ModelCascadeMenu } from "../drafts/panels/ModelCascadeMenu";
import { ChromeMark } from "../drafts/icons/Marks";
import { ContextMeter } from "./ContextMeter";
import {
  filesToComposerImages,
  mergeComposerImages,
} from "./images";
import type { ComposerProps } from "./types";

function isApprovalMode(v: string): v is ApprovalSwitchMode {
  return v === "normal" || v === "auto" || v === "yolo";
}

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

export function ApprovalSeat(props: ComposerProps) {
  const value = isApprovalMode(props.approval) ? props.approval : "yolo";
  return (
    <CascadeMenu
      className="wire-composer-approval"
      triggerClassName="wire-composer-approval-trigger"
      triggerLabel={APPROVAL_LABELS[value]}
      triggerTitle={APPROVAL_TITLES[value]}
      triggerLead={<span className={`wire-cascade-led is-${value}`} aria-hidden />}
      ariaLabel="审批模式"
      columns={[
        {
          key: "approval",
          items: APPROVAL_MODES.map((m) => ({
            id: m,
            label: APPROVAL_LABELS[m],
            selected: m === value,
            lead: <span className={`wire-cascade-led is-${m}`} aria-hidden />,
            onSelect: () => props.onApprovalChange(m),
          })),
        },
      ]}
    />
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
          void filesToComposerImages(files, props.images?.length ?? 0).then(
            (extra) => {
              if (!extra.length) return;
              props.onImagesChange?.(
                mergeComposerImages(props.images ?? [], extra),
              );
            },
          );
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className="composer-tool-btn"
        title="附图 · 粘贴或选文件"
        aria-label="附图"
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
  const on = planOn(props.input);
  return (
    <button
      type="button"
      className={`composer-plan${on ? " is-on" : ""}`}
      aria-pressed={on}
      title="计划模式 /plan"
      onClick={() => {
        props.onInputChange(nextPlanInput(props.input));
        props.inputRef.current?.focus();
      }}
    >
      计划
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
      <MoreTools {...props} />
    </>
  );
}
