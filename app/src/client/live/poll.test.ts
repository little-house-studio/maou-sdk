import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sameStrings, visiblePoll } from "./poll";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("live poll helpers", () => {
  it("sameStrings compares by content", () => {
    assert.equal(sameStrings([], []), true);
    assert.equal(sameStrings(["a", "b"], ["a", "b"]), true);
    assert.equal(sameStrings(["a"], ["a", "b"]), false);
    assert.equal(sameStrings(["a", "b"], ["a", "c"]), false);
    const same = ["x"];
    assert.equal(sameStrings(same, same), true);
  });

  it("visiblePoll ticks immediately, repeats, and stops", async () => {
    let n = 0;
    const stop = visiblePoll(() => {
      n += 1;
    }, 5);
    assert.equal(n, 1, "first tick is synchronous");
    await sleep(60);
    stop();
    const atStop = n;
    assert.ok(atStop >= 2, `expected repeated ticks, got ${atStop}`);
    await sleep(30);
    assert.equal(n, atStop, "no ticks after stop");
  });

  it("visiblePoll immediate:false waits for the first interval", () => {
    let n = 0;
    const stop = visiblePoll(
      () => {
        n += 1;
      },
      1000,
      { immediate: false },
    );
    assert.equal(n, 0);
    stop();
  });
});
