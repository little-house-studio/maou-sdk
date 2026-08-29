import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AttachmentRejectError,
  ingestImageBatch,
  readAttachment,
  readImageSize,
} from "./attachment-store.js";

/** 1×1 透明 PNG */
const PNG_1X1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  "hex",
);

describe("attachment-store", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function root(): string {
    const d = mkdtempSync(join(tmpdir(), "maou-att-"));
    dirs.push(d);
    return d;
  }

  it("reads png size", () => {
    expect(readImageSize(PNG_1X1)).toEqual({ width: 1, height: 1 });
  });

  it("stores by hash and reads back", () => {
    const dir = root();
    const [img] = ingestImageBatch(
      [{ mimeType: "image/png", data: PNG_1X1.toString("base64"), name: "a.png" }],
      { root: dir },
    );
    expect(img?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(img?.data).toBeUndefined();
    const back = readAttachment(img!.hash!, { root: dir });
    expect(back?.data).toBe(PNG_1X1.toString("base64"));
    expect(back?.width).toBe(1);
  });

  it("rejects the whole batch when one is over the count", () => {
    const dir = root();
    const one = { mimeType: "image/png", data: PNG_1X1.toString("base64") };
    expect(() => ingestImageBatch([one, one, one, one, one], { root: dir })).toThrow(
      AttachmentRejectError,
    );
    expect(() => ingestImageBatch([{ mimeType: "text/plain", data: "QQ==" }], { root: dir })).toThrow(
      /整批未入库/,
    );
  });
});
