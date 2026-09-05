/**
 * Polling helpers for the live shell.
 *
 * Every poll used to run on a bare setInterval, so a backgrounded window kept
 * hitting the host every 1.5–2.5s for data nobody could see. `visiblePoll`
 * skips ticks while the document is hidden and fires one immediately when the
 * window comes back, so the UI is fresh on return without paying while away.
 */

export type PollHandle = () => void;

function docHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/**
 * Run `tick` every `ms` (and once now unless `immediate: false`), skipping
 * ticks while hidden. Returns a stop function. `tick` may return a promise;
 * overlapping runs are not awaited (same as the setInterval it replaces).
 */
export function visiblePoll(
  tick: () => unknown,
  ms: number,
  opts: { immediate?: boolean } = {},
): PollHandle {
  let stopped = false;
  const run = () => {
    if (stopped || docHidden()) return;
    void tick();
  };
  if (opts.immediate !== false) run();
  const id = setInterval(run, ms);
  const onVis = () => {
    if (!docHidden()) run();
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVis);
  }
  return () => {
    stopped = true;
    clearInterval(id);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVis);
    }
  };
}

/** Shallow string-array equality; used to keep poll results referentially stable. */
export function sameStrings(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
