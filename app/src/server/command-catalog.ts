/**
 * App slash 目录：runtime commandRegistry + 磁盘 skills。
 * 谁写：AgentHub.listCommandCatalog；谁读：GET /api/commands。
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

export type CommandCatalogItem = {
  name: string;
  description: string;
  usage?: string;
  source: "runtime" | "skill";
};

export function scanSkillCommandNames(opts: {
  projectRoot: string;
  maouRoot: string;
  home?: string;
}): string[] {
  const home = opts.home ?? homedir();
  const dirs = [
    join(home, ".agents", "skills"),
    join(opts.projectRoot, ".agents", "skills"),
    join(opts.projectRoot, "skills"),
    join(opts.projectRoot, ".maou", "skills"),
    join(opts.maouRoot, "skills"),
  ];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        let name = "";
        if (ent.isDirectory()) {
          if (
            existsSync(join(dir, ent.name, "SKILL.md")) ||
            existsSync(join(dir, ent.name, "skill.md"))
          ) {
            name = ent.name;
          }
        } else if (ent.name.endsWith(".md")) {
          name = basename(ent.name, ".md");
        }
        if (!name || seen.has(name)) continue;
        seen.add(name);
        names.push(name);
      }
    } catch {
      /* ignore */
    }
  }
  return names;
}

export function buildCommandCatalog(
  runtime: Array<{ name?: string; description?: string; usage?: string }>,
  skillNames: readonly string[],
): CommandCatalogItem[] {
  const out: CommandCatalogItem[] = [];
  const seen = new Set<string>();
  for (const c of runtime) {
    const name = String(c.name ?? "")
      .replace(/^\//, "")
      .trim()
      .toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const usage = String(c.usage ?? "").trim();
    out.push({
      name,
      description: String(c.description ?? "").trim() || `/${name}`,
      ...(usage ? { usage } : {}),
      source: "runtime",
    });
  }
  for (const raw of skillNames) {
    const name = raw.replace(/^\//, "").trim().toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      description: `skill · ${name}`,
      source: "skill",
    });
  }
  return out;
}
