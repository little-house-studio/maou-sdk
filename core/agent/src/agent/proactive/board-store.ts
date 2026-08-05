/**
 * PROACTIVE.md + proactive-settings.json 落盘
 * 路径：<project>/.maou/project/
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  emptyBoardMarkdown,
  normalizeSettings,
  parseProactiveMarkdown,
  serializeProactiveBoard,
} from "./board-format.js";
import type {
  ProactiveBoard,
  ProactiveItem,
  ProactiveSettings,
} from "./types.js";

export const BOARD_REL = ".maou/project/PROACTIVE.md";
export const SETTINGS_REL = ".maou/project/proactive-settings.json";

export function boardPath(projectRoot: string): string {
  return join(projectRoot, BOARD_REL);
}

export function settingsPath(projectRoot: string): string {
  return join(projectRoot, SETTINGS_REL);
}

function ensureParent(file: string): void {
  mkdirSync(dirname(file), { recursive: true });
}

export function readBoard(projectRoot: string): ProactiveBoard {
  const path = boardPath(projectRoot);
  let raw = "";
  try {
    if (existsSync(path)) raw = readFileSync(path, "utf8");
  } catch {
    raw = "";
  }
  if (!raw.trim()) {
    raw = emptyBoardMarkdown();
    try {
      ensureParent(path);
      writeFileSync(path, raw, "utf8");
    } catch {
      /* read-only workspace */
    }
  }
  return parseProactiveMarkdown(raw, BOARD_REL);
}

export function writeBoard(
  projectRoot: string,
  board: ProactiveBoard,
): ProactiveBoard {
  const raw = serializeProactiveBoard(board);
  const path = boardPath(projectRoot);
  ensureParent(path);
  writeFileSync(path, raw, "utf8");
  return parseProactiveMarkdown(raw, BOARD_REL);
}

export function writeBoardRaw(
  projectRoot: string,
  raw: string,
): ProactiveBoard {
  const path = boardPath(projectRoot);
  ensureParent(path);
  const text = raw?.trim() ? raw : emptyBoardMarkdown();
  writeFileSync(path, text, "utf8");
  return parseProactiveMarkdown(text, BOARD_REL);
}

export function readSettings(projectRoot: string): ProactiveSettings {
  const path = settingsPath(projectRoot);
  try {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<ProactiveSettings>;
      return normalizeSettings(raw);
    }
  } catch {
    /* ignore */
  }
  return normalizeSettings(null);
}

export function writeSettings(
  projectRoot: string,
  settings: ProactiveSettings,
): ProactiveSettings {
  const n = normalizeSettings(settings);
  const path = settingsPath(projectRoot);
  ensureParent(path);
  writeFileSync(path, JSON.stringify(n, null, 2) + "\n", "utf8");
  return n;
}

export function patchSettings(
  projectRoot: string,
  patch: Partial<ProactiveSettings>,
): ProactiveSettings {
  const cur = readSettings(projectRoot);
  return writeSettings(projectRoot, { ...cur, ...patch });
}

export function findItem(
  board: ProactiveBoard,
  id: string,
): ProactiveItem | undefined {
  return board.items.find((i) => i.id === id);
}
