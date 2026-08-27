/**
 * Structural check: context top chrome is session-tree crumbs + jump-only.
 * Busy stream banner + TASKS moved to bottom dock (not top float/in-flow tasks).
 * Reads shipped draft.css (no re-implementation of layout math).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "draft.css"), "utf8");
const contextSrc = readFileSync(join(here, "panels/ContextPanel.tsx"), "utf8");

describe("context chrome CSS coexistence", () => {
  it("ContextPanel no longer mounts stream-banner or top TASKS chrome", () => {
    assert.doesNotMatch(contextSrc, /stream-banner/);
    assert.doesNotMatch(contextSrc, /BackgroundTasks/);
    assert.doesNotMatch(contextSrc, /wire-context-tasks-chrome/);
    assert.doesNotMatch(contextSrc, /has-tasks/);
    assert.doesNotMatch(contextSrc, /工作中/);
    // bgTasks not a context prop — tasks live in bottom dock
    assert.doesNotMatch(contextSrc, /bgTasks/);
  });

  it("session tree crumbs sit as a shrink-0 header strip", () => {
    assert.match(contextSrc, /SessionTreeCrumbs/);
    assert.match(
      css,
      /\.wire-session-tree\s*\{[^}]*flex-shrink:\s*0/s,
    );
    assert.match(
      css,
      /\.wire-session-tree\s*\{[^}]*background:\s*#d8d8d8/s,
    );
    assert.match(
      css,
      /\.wire-session-tree-crumbs\s*\{/s,
    );
  });

  it("loop spine is a non-sticky bar under the round chips", () => {
    assert.match(css, /--user-extend:\s*calc\(var\(--round-gutter\) \/ 2\)/);
    assert.match(css, /\.wire-loop-spine\s*\{[^}]*width:\s*var\(--spine/s);
    assert.doesNotMatch(css, /\.wire-user-stick[\s\S]*?\.msg-body::after/);
  });

  it("user question rows stick to the thread top", () => {
    assert.match(css, /\.wire-thread-stage\s*\{/s);
    assert.match(
      css,
      /\.wire-user-stick\s*\{[^}]*position:\s*sticky/s,
    );
    assert.match(css, /\.wire-user-stick\s*\{[^}]*top:\s*0/s);
    assert.match(css, /\.wire-user-stick\s*\{[^}]*background:\s*var\(--n-bg\)/s);
    assert.match(css, /\.wire-thread-lead\s*\{/s);
  });

  it("round chip sticks with the user bar inside its turn", () => {
    assert.match(
      css,
      /\.wire-reply-turn > \.wire-info-hover,\s*\.wire-reply-turn > \.wire-round-chip\s*\{[^}]*position:\s*sticky/s,
    );
    assert.match(
      css,
      /\.wire-reply-turn > \.wire-info-hover,\s*\.wire-reply-turn > \.wire-round-chip\s*\{[^}]*top:\s*var\(--user-stick-h/s,
    );
    assert.match(css, /\.wire-loop-spine::after\s*\{[^}]*height:\s*var\(--spine/s);
    assert.doesNotMatch(css, /\.wire-reply-turn::before\s*\{/);
    assert.match(
      css,
      /\.wire-reply-turn > \.wire-info-hover,\s*\.wire-reply-turn > \.wire-round-chip\s*\{[^}]*z-index:\s*32/s,
    );
  });

  it("thread scroll has no top padding so sticky sits flush under crumbs", () => {
    assert.match(
      css,
      /\.wire-context-scroll\s*\{[^}]*padding-top:\s*0/s,
    );
  });

  it("ask rail sits on the thread host with a capped line, round ticks, square thumb", () => {
    assert.match(css, /\.wire-thread-rail-host\s*\{/);
    assert.match(css, /\.wire-ask-rail\s*\{/);
    assert.match(css, /\.wire-ask-rail-track\s*\{[^}]*width:\s*1px/s);
    assert.match(css, /\.wire-ask-rail-track::before,\s*\.wire-ask-rail-track::after\s*\{/s);
    assert.match(css, /\.wire-ask-thumb\s*\{[^}]*border-radius:\s*0/s);
    assert.match(css, /\.wire-ask-tick::after\s*\{[^}]*border-radius:\s*50%/s);
    assert.match(
      css,
      /\.wire-shell\.draft-shell \.wire-ask-tick::after\s*\{[^}]*border-radius:\s*50%\s*!important/s,
    );
  });

  it("ask rail track and thumb are always on; ticks stay ink", () => {
    assert.match(
      css,
      /\.wire-ask-rail-track\s*\{[^}]*background:\s*var\(--n-label/s,
    );
    assert.match(
      css,
      /\.wire-ask-thumb\s*\{[^}]*background:\s*var\(--n-label/s,
    );
    assert.doesNotMatch(css, /\.wire-ask-thumb\s*\{[^}]*opacity:\s*0/s);
    assert.doesNotMatch(css, /\.wire-ask-tick\.is-in-thumb::after/);
    assert.doesNotMatch(css, /\.wire-ask-rail\.is-scrolling \.wire-ask-tick/);
  });

  it("ask rail sits above the jump strips", () => {
    assert.match(css, /\.wire-ask-rail\s*\{[^}]*z-index:\s*60/s);
    assert.match(css, /\.wire-thread-stage\s*\{[^}]*position:\s*relative/s);
  });

  it("back-to-bottom floats over the thread instead of shrinking it", () => {
    assert.match(
      css,
      /\.wire-jump-bottom-dock\s*\{[^}]*position:\s*absolute/s,
    );
    assert.match(
      css,
      /\.wire-jump-bottom-dock\s*\{[^}]*bottom:\s*0/s,
    );
  });
});
