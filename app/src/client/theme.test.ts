import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  applySheetTheme,
  paintSheetTheme,
  readSheetTheme,
  resolveSheetTheme,
  SHEET_THEME_KEY,
} from "./theme.ts";

const here = dirname(fileURLToPath(import.meta.url));
const draftCss = readFileSync(join(here, "wire/wire.css"), "utf8");

describe("sheet theme", () => {
  it("defaults to light; only dark is the other value", () => {
    assert.equal(resolveSheetTheme(null), "light");
    assert.equal(resolveSheetTheme("light"), "light");
    assert.equal(resolveSheetTheme("dark"), "dark");
    assert.equal(resolveSheetTheme("phosphor"), "light");
    assert.equal(readSheetTheme(null), "light");
    assert.equal(
      readSheetTheme({ getItem: () => "dark" }),
      "dark",
    );
  });

  it("paints html data-theme and persists the key", () => {
    const root = { dataset: {} as { theme?: string } };
    const store: Record<string, string> = {};
    applySheetTheme("dark", root, {
      setItem: (k, v) => {
        store[k] = v;
      },
    });
    assert.equal(root.dataset.theme, "dark");
    assert.equal(store[SHEET_THEME_KEY], "dark");
    paintSheetTheme(root, "light");
    assert.equal(root.dataset.theme, "light");
  });

  it("light sheet uses the five paper signals; no lime or cyan", () => {
    const light = draftCss.match(
      /\.wire-shell\.draft-shell\s*\{[\s\S]*?--n-file-folder:[^}]+\}/,
    )?.[0];
    assert.ok(light);
    assert.match(light, /--n-accent:\s*#0256FF/);
    assert.match(light, /--n-info:\s*#0291FF/);
    assert.match(light, /--n-ok:\s*#FFAE00/);
    assert.match(light, /--n-err:\s*#FF261F/);
    assert.match(light, /--n-warn:\s*#FF6600/);
    assert.match(light, /--dock-logs:\s*var\(--n-err\)/);
    assert.match(light, /--dock-tasks:\s*var\(--n-warn\)/);
    assert.match(light, /--dock-terminal:\s*var\(--n-ok\)/);
    assert.match(light, /--dock-agent:\s*var\(--n-accent\)/);
    assert.match(light, /--dock-proactive:\s*var\(--n-info\)/);
    assert.match(light, /--n-tool-ok:\s*#02C85A/);
    assert.match(light, /--n-tool-wait:\s*#FFAE00/);
    assert.doesNotMatch(
      light,
      /#c7ff20|#b8ff00|#3bffa7|#5ad4ff|#00ff41|#00e5ff|#b80c00|#1400ff|#00a344|#4900b8/,
    );
  });

  it("dark sheet uses one lime signal, not a neon rainbow", () => {
    assert.match(
      draftCss,
      /html\[data-theme="dark"\][\s\S]*--n-accent:\s*#b8ff00/,
    );
    assert.match(
      draftCss,
      /html\[data-theme="dark"\][\s\S]*--dock-terminal:\s*var\(--n-warn\)/,
    );
    assert.match(
      draftCss,
      /html\[data-theme="dark"\][\s\S]*--n-info:\s*#b8ff00/,
    );
    assert.doesNotMatch(
      draftCss,
      /html\[data-theme="dark"\][\s\S]*--dock-proactive:\s*#00e5ff/,
    );
    assert.doesNotMatch(
      draftCss,
      /html\[data-theme="dark"\][\s\S]*--dock-agent:\s*#ff00ff/,
    );
  });

  it("selected fill is quiet until the focused shell region", () => {
    assert.match(draftCss, /--n-on-quiet:\s*#4a4a4a/);
    assert.match(
      draftCss,
      /\.wire-shell\.draft-shell \[data-shell-region\]\s*\{[^}]*--n-on:\s*var\(--n-on-quiet\)/s,
    );
    assert.match(
      draftCss,
      /\.wire-shell\.draft-shell \[data-shell-region\]\[data-shell-focus\]\s*\{[^}]*--n-on:\s*var\(--n-label\)/s,
    );
  });

  it("resize handle is a 13px overlay on the rail seam", () => {
    assert.match(
      draftCss,
      /\.draft-resize-handle\.draft-resize-right\s*\{[^}]*--shell-left/s,
    );
    assert.match(
      draftCss,
      /\.wire-shell\.draft-shell \.draft-resize-handle\s*\{[^}]*width:\s*13px !important/s,
    );
    assert.match(draftCss, /data-resize-cursor="col"/);
  });

  it("scrollbar track is opaque paper, not transparent", () => {
    assert.match(
      draftCss,
      /\.wire-context-scroll\.chat-log\.codex-log\s*\{[^}]*scrollbar-color:\s*#9b9b9b\s+#ffffff/s,
    );
    assert.match(
      draftCss,
      /::-webkit-scrollbar-track:hover[\s\S]*?background:\s*#e4e4e4 !important/,
    );
    assert.doesNotMatch(
      draftCss,
      /\.wire-shell\.draft-shell ::-webkit-scrollbar-track\s*\{[^}]*background:\s*transparent/,
    );
  });

  it("thread ask rail is a square overlay; native bar stays hidden", () => {
    assert.match(draftCss, /\.wire-ask-rail\s*\{/);
    assert.match(
      draftCss,
      /\.wire-ask-thumb\s*\{[^}]*border-radius:\s*0/s,
    );
    assert.match(draftCss, /\.wire-ask-tick::after\s*\{[^}]*border-radius:\s*50%/s);
    assert.doesNotMatch(draftCss, /\.wire-ask-tick\.is-in-thumb::after/);
    assert.match(
      draftCss,
      /\.wire-context-scroll\.chat-log\.codex-log,\s*\.wire-shell\.draft-shell \.wire-context-scroll\.chat-log\.codex-log\s*\{[^}]*scrollbar-width:\s*none !important/s,
    );
  });

  it("hover previews share one right-edge grow panel", () => {
    assert.match(draftCss, /\.wire-hover-tip-panel\s*\{/);
    assert.match(
      draftCss,
      /\.wire-hover-tip-panel\s*\{[^}]*transform-origin:\s*right center/s,
    );
    assert.match(
      draftCss,
      /\.wire-hover-tip-panel\.is-open\s*\{[^}]*transform:\s*translateX\(0\) scaleX\(1\)/s,
    );
  });

  it("session trail sits on paper; jump-prev stays on paper", () => {
    assert.match(
      draftCss,
      /\.wire-session-tree\s*\{[^}]*background:\s*var\(--n-paper/s,
    );
    assert.match(
      draftCss,
      /\.wire-jump-prev\s*\{[^}]*background:\s*var\(--n-paper/s,
    );
    assert.match(draftCss, /\.wire-thread-stage\s*\{/);
  });

  it("topbar mode tabs stay window-centered, not rail-tied", () => {
    assert.match(
      draftCss,
      /\.wire-topbar \.wire-mode-tabs\s*\{[^}]*left:\s*50%[^}]*translateX\(-50%\)/s,
    );
    assert.doesNotMatch(
      draftCss,
      /\.wire-topbar \.wire-mode-tabs\s*\{[^}]*--shell-left/s,
    );
  });

  it("tool card LEDs are green / yellow / red", () => {
    assert.match(
      draftCss,
      /\.wire-tool-led\.is-ok\s*\{[^}]*--n-tool-ok/s,
    );
    assert.match(
      draftCss,
      /\.wire-tool-led\.is-wait\s*\{[^}]*--n-tool-wait/s,
    );
    assert.match(
      draftCss,
      /\.wire-tool-led\.is-err\s*\{[^}]*--n-err/s,
    );
  });

  it("tool stack shares the bubble-text left edge", () => {
    assert.match(
      draftCss,
      /\.wire-reply-internals\s*\{[^}]*padding:\s*0/s,
    );
    assert.doesNotMatch(
      draftCss,
      /\.wire-reply-internals\s*\{[^}]*padding:\s*0 0 0 10px/s,
    );
  });

  it("user block extends left; loop spine is a separate 3px bar under chips", () => {
    assert.match(draftCss, /--user-extend:\s*calc\(var\(--round-gutter\) \/ 2\)/);
    assert.match(
      draftCss,
      /\.wire-context \.bubble\.codex-bubble\.user \.msg-body\s*\{[^}]*margin-left:\s*calc\(-1 \* var\(--user-extend/s,
    );
    assert.doesNotMatch(
      draftCss,
      /\.wire-user-stick[\s\S]*?\.msg-body::after/,
    );
    assert.match(
      draftCss,
      /\.wire-loop-spine\s*\{[^}]*width:\s*var\(--spine/s,
    );
    assert.match(
      draftCss,
      /\.wire-loop-spine\s*\{[^}]*z-index:\s*0/s,
    );
    assert.match(
      draftCss,
      /\.wire-loop-spine::after\s*\{[^}]*height:\s*var\(--spine/s,
    );
    assert.match(draftCss, /\.wire-loop:hover \.wire-loop-spine/);
    assert.match(
      draftCss,
      /\.wire-loop\.is-live \.wire-loop-spine\s*\{[^}]*background:\s*var\(--n-accent/s,
    );
    assert.match(
      draftCss,
      /\.wire-loop\s*\{[^}]*position:\s*relative/s,
    );
    assert.match(
      draftCss,
      /\.wire-round-chip\s*\{[^}]*z-index:\s*2/s,
    );
    assert.match(
      draftCss,
      /\.wire-loop-rounds > \.wire-reply-turn \+ \.wire-reply-turn\s*\{[^}]*margin-top:\s*16px/s,
    );
    assert.match(
      draftCss,
      /\.wire-loop\s*\{[^}]*padding-bottom:\s*12px/s,
    );
  });

  it("round chips hang in the left thread gutter; left and right insets match", () => {
    assert.match(draftCss, /--center-max:\s*52rem/);
    assert.match(draftCss, /--center-gutter-max:\s*104px/);
    assert.match(
      draftCss,
      /--center-gutter:\s*clamp\(\s*0px,\s*\(100% - var\(--center-max\)\) \/ 2,\s*var\(--center-gutter-max\)\s*\)/,
    );
    assert.doesNotMatch(draftCss, /--center-pad-x/);
    assert.match(draftCss, /--thread-inset:\s*24px/);
    assert.match(
      draftCss,
      /\.wire-reply-turn\s*\{[^}]*margin-left:\s*calc\(-1 \* var\(--round-gutter/s,
    );
    assert.match(
      draftCss,
      /\.wire-reply-turn\s*\{[^}]*grid-template-columns:\s*var\(--round-gutter/s,
    );
    assert.match(
      draftCss,
      /\.wire-context-scroll\s*\{[^}]*width:\s*100%/s,
    );
    assert.match(
      draftCss,
      /\.wire-context-scroll\s*\{[^}]*padding-left:\s*calc\(var\(--center-gutter\) \+ var\(--thread-inset\)\)/s,
    );
    assert.doesNotMatch(
      draftCss,
      /\.wire-context-scroll\s*\{[^}]*width:\s*min\(\s*var\(--center-max\)/s,
    );
    assert.match(
      draftCss,
      /\.wire-shell\.draft-shell \.wire-composer-frame[\s\S]*?width:\s*calc\(100% - 2 \* var\(--center-gutter\)\)/s,
    );
    assert.match(
      draftCss,
      /\.wire-shell\.draft-shell \.wire-composer-frame[\s\S]*?padding:\s*0 var\(--thread-inset/s,
    );
    assert.match(
      draftCss,
      /\.wire-reply-turn > \.wire-info-hover,\s*\.wire-reply-turn > \.wire-round-chip\s*\{[^}]*position:\s*sticky/s,
    );
  });

  it("markdown inline code is a gray chip with black bold type", () => {
    const chip = draftCss.match(
      /\.wire-shell\.draft-shell \.draft-md \.dm-code\s*\{[^}]+\}/,
    )?.[0];
    assert.ok(chip);
    assert.match(chip, /background:\s*#d0d0d0/);
    assert.match(chip, /color:\s*#000/);
    assert.match(chip, /font-weight:\s*700/);
  });

  it("html and portal menus carry opaque paper fill", () => {
    assert.match(draftCss, /html\s*\{[^}]*--n-bg:\s*#ededed/s);
    assert.match(
      draftCss,
      /\.wire-cascade-panel,\s*\.wire-cascade-body,\s*\.wire-cascade-col,\s*\.composer-cmd-flyout\s*\{[^}]*background:\s*#ededed/s,
    );
    assert.match(
      draftCss,
      /html\[data-theme="dark"\] \.wire-cascade-panel[\s\S]*background:\s*#0b0b0b/,
    );
  });

  it("motion tokens drive presence, fold, and mid fade", () => {
    assert.match(draftCss, /--n-ease:\s*cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
    assert.match(draftCss, /--n-dur-fast:\s*120ms/);
    assert.match(draftCss, /--n-dur:\s*200ms/);
    assert.match(draftCss, /--n-dur-slow:\s*240ms/);
    assert.match(draftCss, /\[data-presence="leave"\]/);
    assert.match(draftCss, /\.n-fold\[data-open\]/);
    assert.match(draftCss, /@keyframes wire-mid-enter/);
    assert.match(
      draftCss,
      /\.wire-mid:not\(\.is-hidden-mode\)[\s\S]*?animation:\s*wire-mid-enter/s,
    );
    assert.match(
      draftCss,
      /prefers-reduced-motion: reduce[\s\S]*?\.wire-mid:not\(\.is-hidden-mode\)[\s\S]*?animation:\s*none/s,
    );
  });

  it("sent user turns ease up from the composer", () => {
    assert.match(draftCss, /@keyframes wire-msg-enter/);
    assert.match(
      draftCss,
      /\.wire-loop\.is-enter[\s\S]*?animation:\s*wire-msg-enter 280ms/s,
    );
    assert.match(
      draftCss,
      /prefers-reduced-motion: reduce[\s\S]*?\.wire-loop\.is-enter[\s\S]*?animation:\s*none/s,
    );
  });

  it("side rails are layered; only the chat column is paper", () => {
    const light = draftCss.match(
      /\.wire-shell\.draft-shell\s*\{[\s\S]*?--n-file-folder:[^}]+\}/,
    )?.[0];
    assert.ok(light);
    assert.match(light, /--n-paper:\s*#ffffff/);
    assert.match(light, /--n-rail-edge:\s*#e8e8e8/);
    assert.match(light, /--n-rail:\s*#f6f6f6/);
    assert.match(light, /--n-rail-alt:\s*#eeeeee/);
    assert.match(light, /--n-rail-lift:\s*#fcfcfc/);
    assert.match(
      draftCss,
      /\.wire-left\s*\{[^}]*background:\s*var\(--n-rail/s,
    );
    assert.match(
      draftCss,
      /\.wire-right\s*\{[^}]*background:\s*var\(--n-rail/s,
    );
    assert.match(
      draftCss,
      /\.wire-mid\.is-chat\s*\{[^}]*background:\s*var\(--n-paper/s,
    );
    assert.match(
      draftCss,
      /\.wire-center\s*\{[^}]*background:\s*var\(--n-paper/s,
    );
    assert.match(
      draftCss,
      /\.wire-shell\.draft-shell \.wire-aside\s*\{[^}]*background:\s*var\(--n-rail-edge/s,
    );
    assert.match(
      draftCss,
      /\.wire-shell\.draft-shell \.wire-activity\s*\{[^}]*background:\s*var\(--n-rail-edge/s,
    );
    assert.match(
      draftCss,
      /\.wire-shell\.draft-shell \.wire-left-sessions\s*\{[^}]*background:\s*var\(--n-rail-alt/s,
    );
    assert.match(
      draftCss,
      /\.wire-shell\.draft-shell \.wire-files-head\s*\{[^}]*background:\s*var\(--n-rail-lift/s,
    );
    assert.match(
      draftCss,
      /\.wire-shell\.draft-shell \.vsc-explorer-body\s*\{[^}]*background:\s*var\(--n-rail-alt/s,
    );
    assert.match(
      draftCss,
      /\.wire-shell\.draft-shell \.wire-center,\s*\.wire-shell\.draft-shell \.wire-context,\s*\.wire-shell\.draft-shell \.wire-context \.codex-thread-scroll\s*\{[^}]*background:\s*var\(--n-paper/s,
    );
  });
});
