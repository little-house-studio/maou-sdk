/**
 * 技能目录的体积与作废声明（常驻稳定前缀，是纯开销）
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clipSkillDescription,
  EMPTY_SKILL_CATALOG_LINE,
  SKILL_DESCRIPTION_MAX_CHARS,
  SkillContextManager,
} from "./skill-context.js";

function writeSkill(dir: string, name: string, desc: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\nbody\n`);
}

describe("clipSkillDescription", () => {
  it("leaves a short description alone", () => {
    expect(clipSkillDescription("查电路库")).toBe("查电路库");
  });

  it("caps a long one and says where the rest is", () => {
    const out = clipSkillDescription("长".repeat(4000));
    expect(out.length).toBeLessThan(SKILL_DESCRIPTION_MAX_CHARS + 40);
    expect(out).toContain("use_skill");
  });

  it("flattens newlines so one skill cannot reshape the catalog", () => {
    expect(clipSkillDescription("a\n\n  b\tc")).toBe("a b c");
  });
});

describe("skill catalog", () => {
  let root: string;
  let projectRoot: string;
  let maouRoot: string;
  const prevHome = process.env.HOME;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "maou-skill-size-"));
    projectRoot = join(root, "proj");
    maouRoot = join(root, ".maou");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(maouRoot, { recursive: true });
    process.env.HOME = join(root, "home");
    mkdirSync(process.env.HOME, { recursive: true });
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(root, { recursive: true, force: true });
  });

  function manager(): SkillContextManager {
    return new SkillContextManager("main", projectRoot, maouRoot, {
      includeSystemNpmSkills: false,
      extraDirs: [],
    });
  }

  it("clips a bloated description in the baked catalog", () => {
    writeSkill(join(projectRoot, "skills", "fat"), "fat", "描述".repeat(2000));
    const baked = manager().compile().bakedContent;
    expect(baked).toContain("**fat**");
    expect(baked).toContain("描述已截断");
    expect(baked.length).toBeLessThan(1200);
  });

  it("clips it in the incremental update too", () => {
    const mgr = manager();
    writeSkill(join(projectRoot, "skills", "one"), "one", "短");
    mgr.compile();
    writeSkill(join(projectRoot, "skills", "two"), "two", "描述".repeat(2000));
    const inc = mgr.compile().incrementalContent;
    expect(inc).toContain("two");
    expect(inc).toContain("描述已截断");
    expect(inc.length).toBeLessThan(1200);
  });

  it("voids the old list explicitly when the directory goes empty", () => {
    const mgr = manager();
    const dir = join(projectRoot, "skills", "gone");
    writeSkill(dir, "gone", "会被删掉");
    expect(mgr.compile().bakedContent).toContain("**gone**");

    rmSync(dir, { recursive: true, force: true });
    const inc = mgr.compile().incrementalContent;
    expect(inc).toContain("gone");
    expect(inc).toContain(EMPTY_SKILL_CATALOG_LINE);
    // 名单空了就不能再说"整份替换"了事，得点明旧名字全部作废
    expect(inc).not.toContain("请勿继续使用已移除的技能名。");
  });

  it("still says 'this replaces the old list' while some skills remain", () => {
    const mgr = manager();
    writeSkill(join(projectRoot, "skills", "keep"), "keep", "留着");
    const dir = join(projectRoot, "skills", "drop");
    writeSkill(dir, "drop", "删掉");
    mgr.compile();
    rmSync(dir, { recursive: true, force: true });
    const inc = mgr.compile().incrementalContent;
    expect(inc).toContain("请勿继续使用已移除的技能名。");
    expect(inc).not.toContain(EMPTY_SKILL_CATALOG_LINE);
  });

  it("says nothing at all when there never were any skills", () => {
    expect(manager().compile().bakedContent).toBe("");
  });
});
