import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AttachmentRejectError, ingestImageBatch } from "@little-house-studio/context";

const PNG_1X1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
).toString("base64");

describe("sanitizeChatImages / ingest", () => {
  const dir = mkdtempSync(join(tmpdir(), "maou-chat-img-"));
  it("ingests a valid png", () => {
    const out = ingestImageBatch([{ mimeType: "image/png", data: `data:image/png;base64,${PNG_1X1}` }], {
      root: dir,
    });
    assert.equal(out.length, 1);
    assert.ok(out[0]!.hash);
    assert.equal(out[0]!.data, undefined);
  });

  it("rejects a bad mime for the whole batch", () => {
    assert.throws(
      () => ingestImageBatch([{ mimeType: "text/plain", data: "QQ==" }], { root: dir }),
      AttachmentRejectError,
    );
    rmSync(dir, { recursive: true, force: true });
  });
});
