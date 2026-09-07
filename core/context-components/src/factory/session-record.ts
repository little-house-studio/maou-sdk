import { HarnessSessionStore, type HarnessSessionStoreOptions } from "../harness-session-store.js";
import { SessionStore } from "../session-store.js";
import { createAssembly, type Assembly } from "./assembly.js";
import { createFoldPipeline, type FoldPipeline } from "./fold-pipeline.js";
import { maouSessionLayout } from "./layout.js";
import type {
  AssemblyHook,
  AssemblySlot,
  FoldStep,
  SessionLayout,
  SessionRecordFeatures,
  SessionRecordOptions,
} from "./ports.js";
import { resolveSessionFeatures } from "./ports.js";

export type { SessionRecordOptions };

export function createSessionRecord(
  sessionDir: string,
  options?: SessionRecordOptions,
): SessionStore {
  return new SessionStore(sessionDir, options);
}

export function createWorkingSet(options?: HarnessSessionStoreOptions): HarnessSessionStore {
  return new HarnessSessionStore(options);
}

export interface ContextPartsOptions<TCtx = unknown> {
  sessionDir: string;
  layout?: SessionLayout;
  features?: SessionRecordFeatures;
  slots?: AssemblySlot<TCtx>[];
  after?: AssemblyHook<TCtx>[];
  folds?: FoldStep[];
  workingSet?: HarnessSessionStoreOptions;
}

export interface ContextParts<TCtx = unknown> {
  layout: SessionLayout;
  features: Required<SessionRecordFeatures>;
  session: SessionStore;
  workingSet: HarnessSessionStore;
  assembly: Assembly<TCtx>;
  fold: FoldPipeline;
}

/**
 * 用零件搭一套上下文。
 * 不传 slots / folds 就是空拼装、空压法——方案自己插。
 * 传统方案在 @little-house-studio/context 里把槽和压法配好。
 */
export function createContextParts<TCtx = unknown>(
  opts: ContextPartsOptions<TCtx>,
): ContextParts<TCtx> {
  const layout = opts.layout ?? maouSessionLayout(opts.sessionDir);
  const features = resolveSessionFeatures(opts.features);
  const session = new SessionStore(opts.sessionDir, { layout, features });
  const workingSet = new HarnessSessionStore({
    sessionsDir: layout.sessionDir,
    ...opts.workingSet,
  });
  return {
    layout,
    features,
    session,
    workingSet,
    assembly: createAssembly({ slots: opts.slots, after: opts.after }),
    fold: createFoldPipeline(opts.folds ?? []),
  };
}
