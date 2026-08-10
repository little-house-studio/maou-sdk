/**
 * formatModelErrorForUi — must not infinite-recurse on uncased categories.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatModelErrorForUi } from "./model-error-ui.ts";

describe("formatModelErrorForUi", () => {
  it("handles quota_exhausted with category", () => {
    const t = formatModelErrorForUi("x", "quota_exhausted", false);
    assert.match(t, /免费额度|配额/);
  });

  it("does not recurse on bad_request with [llm_error] prefix", () => {
    const raw =
      "[llm_error] category=bad_request retryable=0 code=http_400 | bad";
    const t = formatModelErrorForUi(raw, "bad_request", false);
    assert.equal(t, "模型请求无效：" + raw.slice(0, 280));
  });

  it("does not recurse on unknown with [llm_error] prefix", () => {
    const raw =
      "[llm_error] category=unknown retryable=0 code=- | something weird";
    // category already set — must return without stack overflow
    const t = formatModelErrorForUi(raw, "unknown", false);
    assert.equal(t, raw);
  });

  it("parses prefix only when category missing", () => {
    const raw =
      "[llm_error] category=auth retryable=0 code=http_401 | no key";
    const t = formatModelErrorForUi(raw);
    assert.match(t, /鉴权/);
  });

  it("content_policy does not recurse", () => {
    const raw =
      "[llm_error] category=content_policy retryable=0 code=451 | blocked";
    const t = formatModelErrorForUi(raw, "content_policy", false);
    assert.match(t, /安全策略/);
  });
});
