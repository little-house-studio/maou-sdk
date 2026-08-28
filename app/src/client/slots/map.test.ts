import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  BODY_CHILDREN,
  BOTTOM_CHILDREN,
  CENTER_MODE_KEYS,
  COMPOSER_BAR_CHILDREN,
  COMPOSER_CHILDREN,
  CONVERSATION_CHILDREN,
  SHELL_CHILDREN,
  SIDEBAR_CHILDREN,
} from "./map";

const draftCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../drafts/draft.css"),
  "utf8",
);

describe("shell SlotMap", () => {
  it("sheet tokens are paper + mid-gray stroke", () => {
    assert.match(draftCss, /--n-bg:\s*#ededed/);
    assert.match(draftCss, /--n-line-solid:\s*#9b9b9b/);
    assert.match(draftCss, /--n-label:\s*#000000/);
    assert.match(draftCss, /--n-on:\s*#000000/);
    assert.match(draftCss, /--n-on-quiet:\s*#4a4a4a/);
    assert.match(draftCss, /--n-on-ink:\s*#ededed/);
    assert.match(draftCss, /--n-accent:\s*#0256FF/);
    assert.match(draftCss, /--n-info:\s*#0291FF/);
    assert.match(
      draftCss,
      /\.wire-activity\s*\{[^}]*width:\s*var\(--shell-activity,\s*36px\)/s,
    );
    assert.match(
      draftCss,
      /\.wire-aside-pane\.is-animating\s*\{[^}]*transition:\s*width 180ms/s,
    );
    assert.match(draftCss, /\.wire-v-split/);
  });

  it("chrome keeps cell stroke on focus and topbar meta", () => {
    assert.doesNotMatch(
      draftCss,
      /\.composer-row:focus-within[^{]*\{[^}]*border:\s*none\s*!important/s,
    );
    assert.doesNotMatch(
      draftCss,
      /\.wire-shell\.draft-shell \.wire-meta\s*\{[^}]*background:\s*#000000/s,
    );
    assert.match(
      draftCss,
      /\.wire-shell\.draft-shell \.composer-row:focus-within[^{]*\{[^}]*border:\s*1px solid var\(--n-label\)/s,
    );
  });

  it("declares the current product seats", () => {
    assert.deepEqual(Object.keys(SHELL_CHILDREN).sort(), [
      "shell.body",
      "shell.bottom",
      "shell.overlay",
      "shell.topbar",
    ]);
    assert.deepEqual(Object.keys(BODY_CHILDREN).sort(), [
      "aside.left.pane",
      "aside.left.tab",
      "aside.right.pane",
      "aside.right.tab",
      "shell.center",
    ]);
    assert.equal(BODY_CHILDREN["aside.left.tab"].kind, "list");
    assert.equal(BODY_CHILDREN["aside.left.pane"].kind, "keyed");
    assert.equal(BODY_CHILDREN["aside.right.tab"].kind, "list");
    assert.equal(BODY_CHILDREN["aside.right.pane"].kind, "keyed");
    assert.deepEqual(Object.keys(SIDEBAR_CHILDREN).sort(), [
      "sidebar.agents",
      "sidebar.sessions",
    ]);
    assert.equal(BOTTOM_CHILDREN["bottom.card"].kind, "keyed");
    assert.deepEqual([...CENTER_MODE_KEYS], [
      "chat",
      "project",
      "team",
      "settings",
    ]);
    assert.deepEqual(Object.keys(CONVERSATION_CHILDREN).sort(), [
      "conversation.composer",
      "conversation.messages",
      "conversation.overlay",
      "conversation.permit",
      "conversation.trail",
    ]);
    assert.equal(CONVERSATION_CHILDREN["conversation.composer"].kind, "chain");
    assert.deepEqual(Object.keys(COMPOSER_CHILDREN).sort(), [
      "composer.bar",
      "composer.footer",
      "composer.queue",
    ]);
    assert.deepEqual(Object.keys(COMPOSER_BAR_CHILDREN).sort(), [
      "composer.approval-mode",
      "composer.left",
      "composer.model",
      "composer.overlay",
      "composer.plan",
      "composer.right",
      "composer.usage",
    ]);
  });
});
