/**
 * 审批模式 · 三档拨杆开关
 * normal · auto · yolo
 *
 * 高饱和平面极简 · 低间距 · 可拖 + 弹簧吸附
 */
import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export type ApprovalSwitchMode = "normal" | "auto" | "yolo";

const MODES: readonly ApprovalSwitchMode[] = ["normal", "auto", "yolo"] as const;

const LABELS: Record<ApprovalSwitchMode, string> = {
  normal: "N",
  auto: "A",
  yolo: "Y",
};

const TITLES: Record<ApprovalSwitchMode, string> = {
  normal: "NORMAL · 危险操作需审批",
  auto: "AUTO · 自动审批低风险",
  yolo: "YOLO · 全部放行",
};

/** track geometry — keep in sync with CSS */
const PAD = 2;
const LEVER_W = 28;

function modeIndex(mode: ApprovalSwitchMode): number {
  const i = MODES.indexOf(mode);
  return i >= 0 ? i : 2;
}

function nearestMode(t: number): ApprovalSwitchMode {
  const x = Math.max(0, Math.min(1, t));
  if (x < 1 / 3) return "normal";
  if (x < 2 / 3) return "auto";
  return "yolo";
}

function springStep(
  pos: number,
  vel: number,
  target: number,
  dt: number,
): { pos: number; vel: number; settled: boolean } {
  const stiffness = 280;
  const damping = 26;
  const acc = (target - pos) * stiffness - vel * damping;
  let v = vel + acc * dt;
  let p = pos + v * dt;
  if (p < -0.04) {
    p = -0.04;
    v *= -0.3;
  }
  if (p > 1.04) {
    p = 1.04;
    v *= -0.3;
  }
  const settled = Math.abs(target - p) < 0.002 && Math.abs(v) < 0.025;
  return { pos: settled ? target : p, vel: settled ? 0 : v, settled };
}

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
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [thumbT, setThumbT] = useState(() => modeIndex(value) / 2);
  const [dragging, setDragging] = useState(false);
  const thumbTRef = useRef(thumbT);
  const velRef = useRef(0);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    moved: boolean;
  } | null>(null);
  const rafRef = useRef(0);
  const targetRef = useRef(modeIndex(value) / 2);

  const setT = useCallback((t: number) => {
    const v = Math.max(-0.04, Math.min(1.04, t));
    thumbTRef.current = v;
    setThumbT(v);
  }, []);

  useEffect(() => {
    const target = modeIndex(value) / 2;
    targetRef.current = target;
    if (dragRef.current) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.04, (now - last) / 1000);
      last = now;
      const step = springStep(
        thumbTRef.current,
        velRef.current,
        targetRef.current,
        dt,
      );
      velRef.current = step.vel;
      setT(step.pos);
      if (!step.settled) rafRef.current = requestAnimationFrame(tick);
      else rafRef.current = 0;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, setT]);

  const commitNearest = useCallback(
    (t: number, velocity = 0) => {
      let bias = t;
      if (Math.abs(velocity) > 0.8) bias += velocity > 0 ? 0.18 : -0.18;
      const mode = nearestMode(bias);
      const target = modeIndex(mode) / 2;
      targetRef.current = target;
      if (mode !== value) onChange(mode);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      let last = performance.now();
      velRef.current = velocity * 0.4;
      const tick = (now: number) => {
        const dt = Math.min(0.04, (now - last) / 1000);
        last = now;
        const step = springStep(
          thumbTRef.current,
          velRef.current,
          targetRef.current,
          dt,
        );
        velRef.current = step.vel;
        setT(step.pos);
        if (!step.settled) rafRef.current = requestAnimationFrame(tick);
        else rafRef.current = 0;
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [onChange, setT, value],
  );

  const clientXToT = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el) return thumbTRef.current;
    const r = el.getBoundingClientRect();
    const travel = Math.max(1, r.width - PAD * 2 - LEVER_W);
    const x = clientX - r.left - PAD - LEVER_W / 2;
    return x / travel;
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    velRef.current = 0;
    setT(clientXToT(e.clientX));
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      moved: false,
    };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const t = clientXToT(e.clientX);
    if (Math.abs(e.clientX - d.startX) > 2) d.moved = true;
    velRef.current = ((t - thumbTRef.current) / 0.016) * 0.02;
    setT(t);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!d.moved) commitNearest(clientXToT(e.clientX), 0);
    else commitNearest(thumbTRef.current, velRef.current);
  };

  const tClamped = Math.max(0, Math.min(1, thumbT));
  // pad 2 + t * (100% - lever - 2*pad) = 2 + t * (100% - 22)
  const leverStyle: React.CSSProperties = {
    left: `calc(${PAD}px + ${tClamped} * (100% - ${LEVER_W + PAD * 2}px))`,
  };
  const active = nearestMode(tClamped);

  return (
    <div
      className={`approval-phys-switch is-${active}${disabled ? " is-disabled" : ""}${dragging ? " is-dragging" : ""} ${className}`.trim()}
      data-approval-mode={value}
      data-approval-phys="true"
      title={TITLES[value]}
      role="group"
      aria-label="审批模式"
      aria-describedby={id}
    >
      <div
        ref={trackRef}
        className="approval-phys-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="approval-phys-rail" aria-hidden>
          {MODES.map((m) => (
            <span
              key={m}
              className={`approval-phys-seg${value === m ? " is-on" : ""}`}
              data-mode={m}
            >
              {LABELS[m]}
            </span>
          ))}
        </div>
        {/* flat lever / 拨杆 */}
        <div className="approval-phys-lever" style={leverStyle} aria-hidden>
          <span className="approval-phys-lever-face">{LABELS[value]}</span>
        </div>
      </div>
      <span className="approval-phys-caption" id={id}>
        {value}
      </span>
    </div>
  );
}
