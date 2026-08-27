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
      /\.wire-session-tree-crumbs\s*\{/s,
    );
  });

  it("jump bar is solid in-flow strip (no thread bleed)", () => {
    assert.match(
      css,
      /\.wire-jump-prev\s*\{[^}]*flex-shrink:\s*0/s,
    );
    assert.match(
      css,
      /\.wire-jump-prev\s*\{[^}]*background:\s*var\(--n-user-bg\)/s,
    );
  });

  it("default thread scroll pad is not reserved for removed top tasks banner", () => {
    // Slim top pad for thread body
    assert.match(
      css,
      /\.wire-context-scroll\s*\{[^}]*padding:\s*28px/s,
    );
  });
});
