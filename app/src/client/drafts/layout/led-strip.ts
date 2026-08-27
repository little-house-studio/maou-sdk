/** 顶栏 3×18 LED 灯条：看 Agent 是否在跑。 */

export const LED_ROWS = 3;
export const LED_COLS = 18;

export type LedStripState = "idle" | "run" | "off";

export function resolveLedState(opts: {
  busy?: boolean;
  offline?: boolean;
}): LedStripState {
  if (opts.offline) return "off";
  if (opts.busy) return "run";
  return "idle";
}

export function ledStateLabel(state: LedStripState): string {
  switch (state) {
    case "run":
      return "Agent 运行中";
    case "off":
      return "离线";
    default:
      return "Agent 空闲";
  }
}
