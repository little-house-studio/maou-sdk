/**
 * 匿名反馈号：只为对账，不进对话正文。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { resolveUserMaouRoot } from "./maou-paths.js";

export const ANON_ID_FILE = "anon-id";

export function anonIdPath(userRoot?: string): string {
  return join(userRoot ?? resolveUserMaouRoot(), ANON_ID_FILE);
}

export function resolveAnonFeedbackId(userRoot?: string): string {
  const path = anonIdPath(userRoot);
  if (existsSync(path)) {
    try {
      const id = readFileSync(path, "utf-8").trim();
      if (id) return id;
    } catch {
      /* rewrite */
    }
  }
  const id = randomBytes(16).toString("hex");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${id}\n`, "utf-8");
  return id;
}
