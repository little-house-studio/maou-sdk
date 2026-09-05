/**
 * Pure unit tests for project host doc stubs / on-demand content helpers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  kindFromPath,
  needsContentLoad,
  pickInitialPath,
  stubsFromPaths,
  titleFromPath,
  withDocContent,
} from "./project-host-docs.js";
import { DEFAULT_PROJECT_DOC_PATH } from "../wire/project/project-docs.js";

describe("project-host-docs (live project on-demand)", () => {
  it("stubsFromPaths builds empty-content list for tree paint only", () => {
    const stubs = stubsFromPaths([
      ".maou/project/PROJECT.md",
      "docs/a.md",
    ]);
    assert.equal(stubs.length, 2);
    assert.equal(stubs[0]!.path, ".maou/project/PROJECT.md");
    assert.equal(stubs[0]!.content, "");
    assert.equal(stubs[0]!.kind, "project");
    assert.equal(stubs[1]!.title, "a");
    assert.equal(stubs[1]!.kind, "doc");
  });

  it("withDocContent fills one path without rewriting others", () => {
    const stubs = stubsFromPaths(["a.md", "b.md"]);
    const next = withDocContent(stubs, "b.md", "# B\n");
    assert.equal(next[0]!.content, "");
    assert.equal(next[1]!.content, "# B\n");
  });

  it("pickInitialPath prefers DEFAULT_PROJECT_DOC_PATH", () => {
    assert.equal(
      pickInitialPath(["docs/x.md", DEFAULT_PROJECT_DOC_PATH]),
      DEFAULT_PROJECT_DOC_PATH,
    );
    assert.equal(pickInitialPath(["docs/x.md"]), "docs/x.md");
    assert.equal(pickInitialPath([]), null);
  });

  it("needsContentLoad respects loaded set and empty stubs", () => {
    const stubs = stubsFromPaths(["a.md"]);
    const loaded = new Set<string>();
    assert.equal(needsContentLoad(stubs, "a.md", loaded), true);
    loaded.add("a.md");
    assert.equal(needsContentLoad(stubs, "a.md", loaded), false);
    const filled = withDocContent(stubs, "a.md", "hi");
    assert.equal(needsContentLoad(filled, "a.md", new Set()), false);
  });

  it("kindFromPath / titleFromPath match workbench labels", () => {
    assert.equal(kindFromPath(".maou/project/USER.md"), "user");
    assert.equal(kindFromPath("docs/RULE.md"), "rule");
    assert.equal(titleFromPath("docs/foo.md"), "foo");
  });
});
