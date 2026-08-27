import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCommandCatalog,
  scanSkillCommandNames,
} from "./command-catalog.js";

describe("command catalog", () => {
  it("runtime wins over same-named skill", () => {
    const list = buildCommandCatalog(
      [{ name: "plan", description: "先写计划", usage: "[prompt]" }],
      ["plan", "review"],
    );
    assert.deepEqual(
      list.map((c) => c.name),
      ["plan", "review"],
    );
    assert.equal(list[0]!.source, "runtime");
    assert.equal(list[0]!.usage, "[prompt]");
    assert.equal(list[1]!.source, "skill");
  });

  it("scans SKILL.md dirs and skips missing roots", () => {
    const root = join(tmpdir(), `maou-skills-${process.pid}`);
    const skillDir = join(root, "proj", ".agents", "skills", "review");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), "# review\n");
    try {
      const names = scanSkillCommandNames({
        projectRoot: join(root, "proj"),
        maouRoot: join(root, "maou"),
        home: join(root, "home"),
      });
      assert.deepEqual(names, ["review"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
