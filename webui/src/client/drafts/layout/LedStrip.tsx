import React from "react";
import {
  LED_COLS,
  LED_ROWS,
  ledStateLabel,
  type LedStripState,
} from "./led-strip";

export type LedStripProps = {
  state: LedStripState;
};

/** ⬛ 3×18 物理灯条：空闲微亮、运行扫光、离线熄灭。 */
export function LedStrip({ state }: LedStripProps) {
  const cells: React.ReactNode[] = [];
  for (let r = 0; r < LED_ROWS; r++) {
    for (let c = 0; c < LED_COLS; c++) {
      cells.push(
        <span
          key={`${r}-${c}`}
          className="wire-led-cell"
          style={{ ["--r" as string]: r, ["--c" as string]: c }}
          data-r={r}
          data-c={c}
        />,
      );
    }
  }
  return (
    <div
      className="wire-led-strip"
      data-led-strip="3x18"
      data-state={state}
      role="status"
      aria-live="polite"
      aria-label={ledStateLabel(state)}
      title={ledStateLabel(state)}
    >
      {cells}
    </div>
  );
}
