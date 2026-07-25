import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getProjectsList,
  registerProject,
  resolveProjectsRegistryPath,
} from "./project-manager.js";

const roots: string[] = [];
const oldHome = process.env.MAOU_HOME;

afterEach(() => {
  if (oldHome === undefined) delete process.env.MAOU_HOME;
  else process.env.MAOU_HOME = oldHome;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "maou-project-registry-"));
  roots.push(root);
  const home = join(root, "home");
  const project = join(root, "workspace", "app");
  mkdirSync(join(project, ".maou"), { recursive: true });
  writeFileSync(join(project, ".maou", "project.json"), "{}", "utf-8");
  process.env.MAOU_HOME = home;
  return { root, home, project };
}

describe("project manager", () => {
  it("stores the registry under MAOU_HOME and upserts by path", () => {
    const { home, project } = fixture();
    const first = registerProject(project, { name: "first" });
    const second = registerProject(project, { name: "renamed" });

    expect(resolveProjectsRegistryPath()).toBe(join(home, "projects.json"));
    expect(first.path).toBe(second.path);
    expect(getProjectsList()).toMatchObject([
      { name: "renamed", path: first.path, isActive: true },
    ]);
    const raw = JSON.parse(readFileSync(join(home, "projects.json"), "utf-8"));
    expect(raw.version).toBe(1);
    expect(raw.projects).toHaveLength(1);
  });

  it("allows duplicate display names at different paths", () => {
    const { root, project } = fixture();
    const other = join(root, "other", "app");
    mkdirSync(join(other, ".maou"), { recursive: true });
    writeFileSync(join(other, ".maou", "project.json"), "{}", "utf-8");

    registerProject(project, { name: "app" });
    registerProject(other, { name: "app" });
    expect(getProjectsList()).toHaveLength(2);
  });

  it("retains missing projects as inactive", () => {
    const { project } = fixture();
    registerProject(project);
    rmSync(project, { recursive: true, force: true });
    expect(getProjectsList()[0]?.isActive).toBe(false);
  });

  it("uses canonical path identity for symlinked project paths", () => {
    const { root, project } = fixture();
    const link = join(root, "project-link");
    symlinkSync(project, link, "dir");

    registerProject(project, { name: "direct" });
    registerProject(link, { name: "linked" });

    expect(getProjectsList()).toMatchObject([
      { name: "linked", path: realpathSync.native(project), isActive: true },
    ]);
  });
});
