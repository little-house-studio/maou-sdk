import assert from "node:assert/strict";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { Composer } from "./Composer";
import type { ComposerProps } from "./types";
import {
  filterPaletteHits,
  filterSlashHits,
  mentionQuery,
  applyMentionPick,
  mergeCommandCatalog,
  slashPrefixAtCursor,
  slashTokenStart,
} from "./commands";
import { composerTextMaxPx } from "./fit-height";
import { parseDataUrl } from "./images";

function bag(over: Partial<ComposerProps> = {}): ComposerProps {
  return {
    variant: "draft",
    input: "",
    busy: false,
    pendingApproval: false,
    sendMode: "queue",
    placeholder: "输入消息…",
    statusDisplay: "",
    statusError: false,
    slashHits: [],
    slashIdx: 0,
    slashOpen: false,
    outbox: [],
    provider: "openai",
    model: "gpt-5",
    providers: [],
    models: [],
    approval: "yolo",
    contextPct: 12,
    canRetry: false,
    canSteerQueue: false,
    inputRef: createRef<HTMLTextAreaElement>(),
    onInputChange: () => {},
    onInputKeyDown: () => {},
    onSend: () => {},
    onCommandLaunch: () => {},
    onApprovalChange: () => {},
    onRetryLast: () => {},
    onCopyTranscript: () => {},
    ...over,
  };
}

describe("Composer", () => {
  it("renders command launcher, meter, and send", () => {
    const html = renderToStaticMarkup(createElement(Composer, bag()));
    assert.match(html, /data-composer=/);
    assert.match(html, /composer-cmd/);
    assert.match(html, /composer-meter/);
    assert.match(html, /wire-composer-card/);
    assert.match(html, /wire-composer-send/);
    assert.doesNotMatch(html, /data-composer-footer/);
    assert.match(html, /aria-label="更多"/);
    assert.match(html, /wire-composer-send[^>]*disabled/);
    assert.doesNotMatch(html, /aria-label="挂文件"/);
    assert.match(html, /wire-composer-approval/);
    assert.match(html, /放行/);
    assert.doesNotMatch(html, /data-approval-lights/);
  });

  it("lists palette hits with command labels", () => {
    const html = renderToStaticMarkup(
      createElement(
        Composer,
        bag({
          paletteOpen: true,
          paletteHits: [
            {
              name: "new",
              label: "新对话",
              description: "新建会话",
              palette: true,
            },
          ],
          paletteIdx: 0,
        }),
      ),
    );
    assert.match(html, /data-composer-launch=""/);
    assert.match(html, /aria-expanded="true"/);
  });

  it("shows stop when busy and empty, send stays gray", () => {
    const html = renderToStaticMarkup(
      createElement(Composer, bag({ busy: true, input: "" })),
    );
    assert.match(html, /wire-composer-stop/);
    assert.match(html, /wire-composer-send[^>]*disabled/);
  });

  it("slash token starts at the slash glyph", () => {
    assert.equal(slashTokenStart("/plan", 5), 0);
    assert.equal(slashPrefixAtCursor("/plan", 5), "plan");
    assert.equal(slashTokenStart("  /he", 5), 2);
    assert.equal(slashPrefixAtCursor("  /he", 5), "he");
    assert.equal(slashTokenStart("hello", 5), null);
    assert.equal(slashTokenStart("/plan extra", 8), null);
    assert.equal(slashTokenStart("", 0), null);
    assert.equal(slashPrefixAtCursor("hello", 5), null);
    assert.equal(slashTokenStart("/h", 0), null);
    assert.equal(slashPrefixAtCursor("/", 0), null);
    assert.equal(slashPrefixAtCursor("/", 1), "");
    assert.equal(filterSlashHits("/", undefined, 8, 0).length, 0);
    assert.ok(filterSlashHits("/", undefined, 8, 1).length > 0);
    assert.equal(filterSlashHits("/plan extra").length, 0);
  });

  it("slash and palette catalogs include plan and fork", () => {
    assert.ok(filterSlashHits("/pl").includes("plan"));
    assert.ok(filterSlashHits("/u").includes("usage"));
    assert.ok(filterPaletteHits("派生").some((c) => c.name === "fork"));
    assert.equal(mentionQuery("see @src/a"), "src/a");
    assert.equal(applyMentionPick("see @src", "app/foo.ts"), "see @app/foo.ts ");
  });

  it("merges runtime/skill names without overriding local", () => {
    const catalog = mergeCommandCatalog([
      { name: "plan", label: "/plan", description: "runtime plan" },
      { name: "review", label: "/review", description: "skill · review" },
    ]);
    assert.ok(
      catalog.some((c) => c.name === "plan" && c.description === "先调查并写计划"),
    );
    assert.ok(catalog.some((c) => c.name === "review"));
    assert.ok(filterSlashHits("/rev", catalog).includes("review"));
  });

  it("renders image chips and more menu", () => {
    const html = renderToStaticMarkup(
      createElement(
        Composer,
        bag({
          images: [
            { mimeType: "image/png", data: "AAA", name: "shot.png" },
          ],
        }),
      ),
    );
    assert.match(html, /data-composer-images=/);
    assert.match(html, /shot\.png/);
    assert.match(html, /aria-label="更多"/);
    assert.match(html, /附图/);
  });

  it("composer text max is about one third of the viewport", () => {
    assert.equal(composerTextMaxPx(900), 300);
    assert.equal(composerTextMaxPx(120), 56);
  });

  it("parses image data URLs", () => {
    const img = parseDataUrl("data:image/png;base64,AAA", "x.png");
    assert.equal(img?.mimeType, "image/png");
    assert.equal(img?.data, "AAA");
    assert.equal(parseDataUrl("not-an-image"), null);
  });

  it("lists queued outbox rows", () => {
    const html = renderToStaticMarkup(
      createElement(
        Composer,
        bag({
          outbox: [
            {
              localId: "1",
              text: "hello",
              status: "queued",
              mode: "queue",
            },
          ],
        }),
      ),
    );
    assert.match(html, /data-composer-queue/);
    assert.match(html, /hello/);
  });
});
