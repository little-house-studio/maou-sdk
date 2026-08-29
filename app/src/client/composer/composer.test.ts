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
  composeCommandInput,
  mergeCommandCatalog,
  overlayIdxAfterPrefix,
  overlayKeyAction,
  slashPrefixAtCursor,
  slashTokenStart,
} from "./commands";
import { flyoutItemName } from "./CommandFlyout";
import { fallbackContextBreakdown } from "./ContextBreakdownPanel";
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
    assert.match(html, /data-hover-tip=/);
    assert.doesNotMatch(html, /点击查看/);
    assert.match(html, /wire-composer-card/);
    assert.match(html, /wire-composer-send/);
    assert.doesNotMatch(html, /data-composer-footer/);
    assert.match(html, /aria-label="更多"/);
    assert.match(html, /wire-composer-send[^>]*disabled/);
    assert.doesNotMatch(html, /aria-label="挂文件"/);
    assert.match(html, /wire-composer-approval/);
    assert.match(html, /wire-composer-approval-trigger/);
    assert.match(html, /composer-approval-name[^>]*>yolo</);
    assert.doesNotMatch(html, /composer-approval-name[^>]*>\/yolo/);
    assert.doesNotMatch(html, /composer-cmd-flyout-label/);
    assert.doesNotMatch(html, /工作区/);
    assert.doesNotMatch(html, /data-approval-lights/);
  });

  it("approval seat trigger shows English name only", () => {
    const html = renderToStaticMarkup(
      createElement(Composer, bag({ approval: "auto" })),
    );
    assert.match(html, /composer-approval-name[^>]*>auto</);
    assert.doesNotMatch(html, /composer-approval-name[^>]*>\/auto/);
    assert.doesNotMatch(html, /composer-cmd-flyout-label/);
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

  it("context meter hover can stand up from a bare percent", () => {
    const b = fallbackContextBreakdown({ pct: 12, max: 200_000 });
    assert.ok(b);
    assert.equal(b!.occupancyPct, 12);
    assert.equal(b!.window, 200_000);
    assert.equal(fallbackContextBreakdown({}), null);
  });

  it("flyout names take an optional prefix so seats are not slash commands", () => {
    assert.equal(flyoutItemName("goal"), "/goal");
    assert.equal(flyoutItemName("ask", ""), "ask");
    assert.equal(flyoutItemName("auto", ""), "auto");
  });

  it("Enter applies the highlighted completion when the flyout is open", () => {
    const open = { key: "Enter" };
    assert.equal(overlayKeyAction(open, true, 6), "pick");
    assert.equal(overlayKeyAction({ key: "Tab" }, true, 6), "pick");
    assert.equal(overlayKeyAction({ key: "ArrowDown" }, true, 6), "nav-down");
    assert.equal(overlayKeyAction({ key: "Escape" }, true, 6), "close");
    // 面板关了，或按了修饰键，Enter 才交给发送
    assert.equal(overlayKeyAction(open, false, 6), null);
    assert.equal(overlayKeyAction(open, true, 0), null);
    assert.equal(overlayKeyAction({ key: "Enter", shiftKey: true }, true, 6), null);
    assert.equal(overlayKeyAction({ key: "Enter", ctrlKey: true }, true, 6), null);
    assert.equal(overlayKeyAction({ key: "Enter", altKey: true }, true, 6), null);
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

  it("app slash list hides CLI chrome commands", () => {
    const hits = filterSlashHits("/", undefined, 24, 1);
    assert.ok(hits.includes("plan"));
    assert.ok(hits.includes("goal"));
    assert.ok(!hits.includes("new"));
    assert.ok(!hits.includes("fork"));
    assert.ok(!hits.includes("sessions"));
    assert.ok(!hits.includes("model"));
    assert.ok(!hits.includes("approval"));
    assert.ok(!hits.includes("stop"));
    assert.ok(!hits.includes("help"));
    assert.equal(overlayIdxAfterPrefix("", "", 3), 3);
    assert.equal(overlayIdxAfterPrefix("", "g", 3), 0);
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

  it("slash command is a paper chip with a clear control", () => {
    const html = renderToStaticMarkup(
      createElement(Composer, bag({ commandBlock: "plan" })),
    );
    assert.match(html, /data-composer-cmd-chip=/);
    assert.match(html, /composer-cmd-chip-name[^>]*>\/plan</);
    assert.match(html, /aria-label="去掉指令 \/plan"/);
    assert.match(html, /参数或消息/);
    assert.doesNotMatch(html, /composer-cmd-block/);
  });

  it("selected command chip stays a chip", () => {
    const html = renderToStaticMarkup(
      createElement(
        Composer,
        bag({ commandBlock: "plan", commandBlockSelected: true }),
      ),
    );
    assert.match(html, /composer-cmd-chip is-selected/);
    assert.match(html, /composer-cmd-chip-clear/);
    assert.doesNotMatch(html, /composer-cmd-block/);
  });

  it("composeCommandInput prefixes the block and keeps the rest", () => {
    assert.equal(composeCommandInput("plan", "查登录"), "/plan 查登录");
    assert.equal(composeCommandInput("plan", ""), "/plan");
    assert.equal(composeCommandInput(null, "  hi"), "hi");
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
    // 图片 chip 是「点了就删」，可访问名要说清楚
    assert.match(html, /aria-label="移除附图 shot\.png"/);
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
