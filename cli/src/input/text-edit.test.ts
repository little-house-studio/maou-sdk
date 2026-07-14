import { describe, it, expect } from "vitest";
import {
  deleteBackwardTo,
  findPrevSentenceBoundary,
  findPrevWordBoundary,
  prevCodePointIndex,
} from "./text-edit.js";

describe("text-edit boundaries", () => {
  it("prevCodePointIndex handles BMP and surrogates", () => {
    expect(prevCodePointIndex("ab", 2)).toBe(1);
    expect(prevCodePointIndex("a😀b", 3)).toBe(1); // before emoji (surrogate pair at 1-2)
  });

  it("findPrevWordBoundary skips spaces then word", () => {
    expect(findPrevWordBoundary("hello world", 11)).toBe(6);
    expect(findPrevWordBoundary("hello world", 6)).toBe(0);
    expect(findPrevWordBoundary("  foo", 5)).toBe(2);
  });

  it("findPrevSentenceBoundary keeps previous sentence punct", () => {
    expect(findPrevSentenceBoundary("Hello. World", 12)).toBe(6); // after "."
    expect(findPrevSentenceBoundary("第一句。第二句", 7)).toBe(4); // after "。"
    expect(findPrevSentenceBoundary("only one", 8)).toBe(0);
  });

  it("deleteBackwardTo removes range", () => {
    expect(deleteBackwardTo("Hello. World", 12, 6)).toEqual({
      text: "Hello.",
      cursor: 6,
    });
    expect(deleteBackwardTo("ab cd", 5, 3)).toEqual({
      text: "ab ",
      cursor: 3,
    });
  });
});
