import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Fold } from "./Fold";
import {
  MOTION_DUR_MS,
  emptyPresence,
  nextPresence,
  presenceHoldMs,
  presenceProps,
} from "./presence";

const here = dirname(fileURLToPath(import.meta.url));

describe("nextPresence", () => {
  it("opens immediately; close holds then drops; reduced-motion is instant", () => {
    const closed = emptyPresence();
    const enter = nextPresence(closed, true, false, "input");
    assert.deepEqual(enter, { shown: true, phase: "enter" });
    assert.deepEqual(nextPresence(enter, true, false, "enter"), {
      shown: true,
      phase: "open",
    });

    const opened = { shown: true, phase: "open" as const };
    const leaving = nextPresence(opened, false, false, "input");
    assert.deepEqual(leaving, { shown: true, phase: "leave" });
    assert.deepEqual(nextPresence(leaving, false, false, "leave"), {
      shown: false,
      phase: "leave",
    });

    assert.deepEqual(nextPresence(opened, false, true, "input"), {
      shown: false,
      phase: "leave",
    });
    assert.equal(presenceHoldMs(true, false), 0);
    assert.equal(presenceHoldMs(false, false), MOTION_DUR_MS);
    assert.equal(presenceHoldMs(false, true), 0);
    assert.deepEqual(presenceProps(enter), { "data-presence": "enter" });
    assert.deepEqual(presenceProps(closed), {});
  });
});

describe("Fold", () => {
  it("keeps children mounted and marks data-open only when expanded", () => {
    const shut = renderToStaticMarkup(
      createElement(Fold, { open: false }, "body"),
    );
    assert.match(shut, /n-fold/);
    assert.match(shut, /n-fold-inner/);
    assert.match(shut, /body/);
    assert.doesNotMatch(shut, /data-open/);
    const open = renderToStaticMarkup(
      createElement(Fold, { open: true }, "body"),
    );
    assert.match(open, /data-open=/);
  });
});

describe("motion CSS contract", () => {
  it("shell tokens and fold / presence rules live in wire.css", () => {
    const css = readFileSync(join(here, "../wire/wire.css"), "utf8");
    assert.match(css, /--n-ease:\s*cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
    assert.match(css, /--n-dur-fast:\s*120ms/);
    assert.match(css, /--n-dur:\s*200ms/);
    assert.match(css, /--n-dur-slow:\s*240ms/);
    assert.match(css, /\[data-presence="leave"\]/);
    assert.match(css, /\.n-fold\[data-open\]/);
    assert.match(css, /@keyframes wire-mid-enter/);
    assert.match(
      css,
      /prefers-reduced-motion: reduce[\s\S]*?\[data-presence\][\s\S]*?transition:\s*none/s,
    );
  });
});

describe("fold hosts keep children mounted", () => {
  it("FilesRail and SessionList drive Fold, not open && unmount", () => {
    const files = readFileSync(
      join(here, "../wire/sidebar/FilesRail.tsx"),
      "utf8",
    );
    const sessions = readFileSync(
      join(here, "../wire/sidebar/SessionList.tsx"),
      "utf8",
    );
    assert.match(files, /<Fold open=\{isOpen\}/);
    assert.doesNotMatch(files, /isOpen &&/);
    assert.match(sessions, /<Fold open=\{open\}/);
    assert.match(sessions, /SessionKidFold/);
  });
});
