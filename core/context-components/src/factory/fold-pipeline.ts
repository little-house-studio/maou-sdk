import { estimateTokens } from "../token-estimate.js";
import { pruneToolResultText } from "../prune-text.js";
import { applyWindowPressure } from "../window-pressure.js";
import { snapRetainStartForToolPairs } from "../tool-pairing.js";
import { holdAsPromptCache, renderMicroCompactText, segmentMicroPolicy } from "../micro-compact.js";
import type { MaouMessage } from "../types/message.js";
import type { FoldStep, FoldStepInput, FoldStepOutput } from "./ports.js";
import { foldStageStep } from "./fold-stage.js";
import type { FoldStageConfig } from "./ports.js";

export interface FoldPipeline {
  steps: FoldStep[];
  insert(step: FoldStep, before?: string): FoldPipeline;
  replace(name: string, step: FoldStep): FoldPipeline;
  remove(name: string): FoldPipeline;
  run(input: FoldStepInput): Promise<FoldStepOutput>;
}

export function createFoldPipeline(steps: FoldStep[] = []): FoldPipeline {
  const state = { steps: [...steps] };

  const api: FoldPipeline = {
    get steps() {
      return state.steps;
    },
    set steps(next) {
      state.steps = [...next];
    },
    insert(step, before) {
      const rest = state.steps.filter((s) => s.name !== step.name);
      if (!before) {
        state.steps = [...rest, step];
        return api;
      }
      const idx = rest.findIndex((s) => s.name === before);
      if (idx < 0) {
        state.steps = [...rest, step];
      } else {
        rest.splice(idx, 0, step);
        state.steps = rest;
      }
      return api;
    },
    replace(name, step) {
      const idx = state.steps.findIndex((s) => s.name === name);
      if (idx < 0) return api.insert(step);
      state.steps = state.steps.map((s, i) => (i === idx ? { ...step, name } : s));
      return api;
    },
    remove(name) {
      state.steps = state.steps.filter((s) => s.name !== name);
      return api;
    },
    async run(input) {
      let history = input.history;
      let changed = false;
      const extras: Record<string, unknown> = {};
      for (const step of state.steps) {
        const out = await step.apply({ ...input, history });
        if (!out) continue;
        if (out.history !== history) changed = true;
        history = out.history;
        if (out.changed) changed = true;
        if (out.extras) Object.assign(extras, out.extras);
      }
      return { history, changed, extras };
    },
  };

  return api;
}

/** 超大 tool_result 头尾剪。不看窗压。 */
export function pruneToolResultsStep(): FoldStep {
  return {
    name: "prune_tool_results",
    apply({ history, currentTurn, catalog }) {
      let changed = false;
      const hold = { currentTurn, catalog };
      const next = history.map((m) => {
        if (holdAsPromptCache(m, hold)) return m;
        if (m.category !== "tool_result") return m;
        const text = m.contents.map((c) => c.text).join("\n");
        const policy = m.contents[0] ? segmentMicroPolicy(m.contents[0]) : undefined;
        const pruned =
          policy?.strategy === "terminal_spill"
            ? renderMicroCompactText(text, policy)
            : pruneToolResultText(text);
        if (!pruned || pruned === text) return m;
        changed = true;
        const contents = [...m.contents];
        if (contents[0]) {
          contents[0] = { ...contents[0], microCompact: { enabled: true, summary: pruned } };
        }
        return { ...m, contents };
      });
      return { history: next, changed };
    },
  };
}

/** 过线先 omit 超大 tool_result。 */
export function windowPressureStep(): FoldStep {
  return {
    name: "window_pressure",
    apply({ history, maxTokens, knownTokens, currentTurn, catalog, sessionRoot }) {
      const window = maxTokens ?? 0;
      const occupancy = knownTokens ?? estimateTokens(history);
      const out = applyWindowPressure(
        history,
        occupancy,
        window,
        (m) => holdAsPromptCache(m, { currentTurn, catalog }),
        sessionRoot,
      );
      return {
        history: out.history,
        changed: out.action !== "none",
        extras: { action: out.action, notices: out.notices },
      };
    },
  };
}

/**
 * 把 retainStart 咬到 tool_call/result 边界。
 * extras.retainStart 给方案层切窗口用。
 */
export function pairToolsRetainStep(retainStart: (history: MaouMessage[]) => number): FoldStep {
  return {
    name: "pair_tools_retain",
    apply({ history }) {
      const start = snapRetainStartForToolPairs(history, retainStart(history));
      return { history, extras: { retainStart: start } };
    },
  };
}

export const builtinFoldSteps = {
  pruneToolResults: pruneToolResultsStep,
  windowPressure: windowPressureStep,
  pairToolsRetain: pairToolsRetainStep,
  foldStage: foldStageStep,
};

/** 传统方案默认压法：窗压 + 可关的折叠阶段。 */
export function traditionalFoldSteps(config?: Partial<FoldStageConfig>): FoldStep[] {
  return [windowPressureStep(), foldStageStep(config)];
}
