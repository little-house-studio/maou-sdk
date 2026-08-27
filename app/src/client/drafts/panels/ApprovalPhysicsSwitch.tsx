/**
 * 审批模式 · 三盏信号灯
 * normal = 红灯（严格审批）
 * auto   = 黄灯（自动低风险）
 * yolo   = 绿灯（全部放行）
 */
import React, { useId } from "react";

export type ApprovalSwitchMode = "normal" | "auto" | "yolo";

export const APPROVAL_MODES: readonly ApprovalSwitchMode[] = [
  "normal",
  "auto",
  "yolo",
] as const;

export const APPROVAL_LABELS: Record<ApprovalSwitchMode, string> = {
  normal: "严格",
  auto: "自动",
  yolo: "放行",
};

export const APPROVAL_TITLES: Record<ApprovalSwitchMode, string> = {
  normal: "严格 · 危险操作需审批",
  auto: "自动 · 低风险自动通过",
  yolo: "放行 · 全部不询问",
};

const MODES = APPROVAL_MODES;
const LABELS = APPROVAL_LABELS;
const TITLES = APPROVAL_TITLES;

const LIGHT: Record<ApprovalSwitchMode, "red" | "yellow" | "green"> = {
  normal: "red",
  auto: "yellow",
  yolo: "green",
};

export type ApprovalPhysicsSwitchProps = {
  value: ApprovalSwitchMode;
  onChange: (mode: ApprovalSwitchMode) => void;
  disabled?: boolean;
  className?: string;
};

export function ApprovalPhysicsSwitch({
  value,
  onChange,
  disabled = false,
  className = "",
}: ApprovalPhysicsSwitchProps) {
  const id = useId();
  const active = MODES.includes(value) ? value : "yolo";

  return (
    <div
      className={`approval-lights is-${active}${disabled ? " is-disabled" : ""} ${className}`.trim()}
      data-approval-mode={value}
      data-approval-phys="true"
      data-approval-lights="true"
      role="radiogroup"
      aria-label="审批模式"
      aria-describedby={id}
    >
      <span className="visually-hidden" id={id}>
        {TITLES[active]}
      </span>
      {MODES.map((m) => {
        const on = active === m;
        const light = LIGHT[m];
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={TITLES[m]}
            title={TITLES[m]}
            disabled={disabled}
            className={`approval-light is-${light}${on ? " is-on" : ""}`}
            data-mode={m}
            onClick={() => {
              if (!disabled && m !== value) onChange(m);
            }}
          >
            <span className="approval-light-label">{LABELS[m]}</span>
            <span className="approval-light-lamp" aria-hidden>
              <span className="approval-light-glow" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
