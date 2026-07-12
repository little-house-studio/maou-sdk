/**
 * Skill 扫描 / 路径对齐 / 系统 NPM 开关
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SkillScanner,
  SkillContextManager,
  setDefaultSkillScanOptions,
  resolveSkillScanOptions,
  skillNameFromPath,
} from "./skill-context.js";

function writeSkill(dir: string, name: string, desc = `desc ${name}`) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}\nbody\n`,
  );
}

describe("skill-context", () => {
  let root: string;
  let projectRoot: string;
  let maouRoot: string;
  let homeAgents: string;
  const prevEnv = process.env.MAOU_INCLUDE_SYSTEM_SKILLS;
  const prevHome = process.env.HOME;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "maou-skill-"));
    projectRoot = join(root, "proj");
    maouRoot = join(root, ".maou");
    homeAgents = join(root, "home", ".agents", "skills");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(maouRoot, { recursive: true });
    // 把 HOME 指到假 home，避免扫真机 ~/.agents
    process.env.HOME = join(root, "home");
    mkdirSync(join(root, "home"), { recursive: true });
    delete process.env.MAOU_INCLUDE_SYSTEM_SKILLS;
    setDefaultSkillScanOptions({ includeSystemNpmSkills: true, extraDirs: [] });
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.MAOU_INCLUDE_SYSTEM_SKILLS;
    else process.env.MAOU_INCLUDE_SYSTEM_SKILLS = prevEnv;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(root, { recursive: true, force: true });
  });

  it("scans project skills and .maou/skills (plural install path)", () => {
    writeSkill(join(projectRoot, "skills", "from-root"), "from-root");
    writeSkill(join(projectRoot, ".maou", "skills", "from-install"), "from-install");
    writeSkill(join(projectRoot, ".maou", "skill", "legacy"), "legacy");

    const map = new SkillScanner("main", projectRoot, maouRoot, {
      includeSystemNpmSkills: false,
    }).scanAll("main");

    expect(map.has("from-root")).toBe(true);
    expect(map.has("from-install")).toBe(true);
    expect(map.has("legacy")).toBe(true);
    expect(map.get("from-install")?.source).toBe("project");
  });

  it("scans system npm path when includeSystemNpmSkills=true", () => {
    writeSkill(join(homeAgents, "sys-skill"), "sys-skill");
    writeSkill(join(maouRoot, "skills", "maou-global"), "maou-global");

    const on = new SkillScanner("main", projectRoot, maouRoot, {
      includeSystemNpmSkills: true,
    }).scanAll();
    expect(on.has("sys-skill")).toBe(true);
    expect(on.get("sys-skill")?.source).toBe("system");
    expect(on.has("maou-global")).toBe(true);

    const off = new SkillScanner("main", projectRoot, maouRoot, {
      includeSystemNpmSkills: false,
    }).scanAll();
    expect(off.has("sys-skill")).toBe(false);
    expect(off.has("maou-global")).toBe(true);
  });

  it("agent skill overrides project same name", () => {
    writeSkill(join(projectRoot, "skills", "dup"), "dup", "project desc");
    writeSkill(
      join(maouRoot, "agents", "coding", "skills", "dup"),
      "dup",
      "agent desc",
    );

    const map = new SkillScanner("coding", projectRoot, maouRoot, {
      includeSystemNpmSkills: false,
    }).scanAll("coding");
    expect(map.get("dup")?.description).toBe("agent desc");
    expect(map.get("dup")?.source).toBe("agent");
  });

  it("getSkillContent uses agentName (same as list)", () => {
    writeSkill(
      join(maouRoot, "agents", "coding", "skill", "only-agent"),
      "only-agent",
    );
    const mgr = new SkillContextManager("coding", projectRoot, maouRoot, {
      includeSystemNpmSkills: false,
    });
    expect(mgr.getSkillContent("only-agent")).toContain("# only-agent");
    expect(mgr.listAvailableSkills().some((s) => s.name === "only-agent")).toBe(
      true,
    );
  });

  it("env MAOU_INCLUDE_SYSTEM_SKILLS=0 disables system scan", () => {
    writeSkill(join(homeAgents, "sys2"), "sys2");
    process.env.MAOU_INCLUDE_SYSTEM_SKILLS = "0";
    const opts = resolveSkillScanOptions({ includeSystemNpmSkills: true });
    expect(opts.includeSystemNpmSkills).toBe(false);
  });

  it("skillNameFromPath and no-frontmatter parent dir name", () => {
    expect(skillNameFromPath("/x/skills/foo/SKILL.md")).toBe("foo");
    const dir = join(projectRoot, "skills", "no-meta");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "# bare\nno frontmatter\n");
    const map = new SkillScanner("main", projectRoot, maouRoot, {
      includeSystemNpmSkills: false,
    }).scanAll();
    expect(map.has("no-meta")).toBe(true);
  });

  it("bake lists skills with available_skills tag", () => {
    writeSkill(join(projectRoot, "skills", "a"), "a");
    const mgr = new SkillContextManager("main", projectRoot, maouRoot, {
      includeSystemNpmSkills: false,
    });
    const r = mgr.compile();
    expect(r.bakedContent).toContain("<available_skills>");
    expect(r.bakedContent).toContain("**a**");
  });
});
