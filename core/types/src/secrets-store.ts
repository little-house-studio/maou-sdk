/**
 * 密钥匣：与模型预设分开。预设只存 keyRef。
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveUserMaouRoot } from "./maou-paths.js";

export const SECRETS_FILE = "secrets.json";

export type KeyRef =
  | { kind: "env"; name: string }
  | { kind: "file"; name: string }
  | { kind: "none" };

export function parseKeyRef(raw: unknown): KeyRef {
  if (typeof raw !== "string" || !raw.trim()) return { kind: "none" };
  const s = raw.trim();
  if (s.startsWith("env:")) {
    const name = s.slice(4).trim();
    return name ? { kind: "env", name } : { kind: "none" };
  }
  if (s.startsWith("file:")) {
    const name = s.slice(5).trim();
    return name ? { kind: "file", name } : { kind: "none" };
  }
  return { kind: "file", name: s };
}

export function formatKeyRef(ref: KeyRef): string {
  if (ref.kind === "env") return `env:${ref.name}`;
  if (ref.kind === "file") return `file:${ref.name}`;
  return "";
}

export function secretsPath(userRoot?: string): string {
  return join(userRoot ?? resolveUserMaouRoot(), SECRETS_FILE);
}

type SecretsFile = { keys?: Record<string, string> };

function readSecretsFile(path: string): SecretsFile {
  if (!existsSync(path)) return { keys: {} };
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as SecretsFile;
    return { keys: raw.keys && typeof raw.keys === "object" ? raw.keys : {} };
  } catch {
    return { keys: {} };
  }
}

function writeSecretsFile(path: string, data: SecretsFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ keys: data.keys ?? {} }, null, 2), "utf-8");
  try {
    chmodSync(path, 0o600);
  } catch {
    /* ignore */
  }
}

export function putSecret(name: string, value: string, userRoot?: string): string {
  const path = secretsPath(userRoot);
  const data = readSecretsFile(path);
  data.keys = { ...(data.keys ?? {}), [name]: value };
  writeSecretsFile(path, data);
  return `file:${name}`;
}

export function hasSecret(name: string, userRoot?: string): boolean {
  const data = readSecretsFile(secretsPath(userRoot));
  return Boolean(data.keys?.[name]);
}

export function resolveKeyRef(
  refRaw: unknown,
  env: NodeJS.ProcessEnv = process.env,
  userRoot?: string,
): string {
  const ref = parseKeyRef(refRaw);
  if (ref.kind === "env") return (env[ref.name] ?? "").trim();
  if (ref.kind === "file") {
    const data = readSecretsFile(secretsPath(userRoot));
    return (data.keys?.[ref.name] ?? "").trim();
  }
  return "";
}

/** 把明文 key 迁进匣，返回 keyRef。空 key 不写。 */
export function migratePlainKeyToVault(
  name: string,
  key: string | undefined,
  userRoot?: string,
): string | undefined {
  const trimmed = (key ?? "").trim();
  if (!trimmed) return undefined;
  return putSecret(name, trimmed, userRoot);
}

export function vaultNameFromPreset(preset: Record<string, unknown>): string {
  const raw = String(preset.name ?? preset.model ?? "default").trim() || "default";
  return raw.replace(/[^\w.-]+/g, "_").slice(0, 80) || "default";
}

/** 有明文 key 则迁匣并写 keyRef；返回是否改过。 */
export function migratePresetPlainKey(
  preset: Record<string, unknown>,
  userRoot?: string,
): boolean {
  const key = typeof preset.key === "string" ? preset.key.trim() : "";
  if (!key) return false;
  if (typeof preset.keyRef === "string" && preset.keyRef.trim()) {
    delete preset.key;
    return true;
  }
  preset.keyRef = migratePlainKeyToVault(vaultNameFromPreset(preset), key, userRoot);
  delete preset.key;
  return true;
}

export function stripPresetPlainKey<T extends Record<string, unknown>>(preset: T): T {
  const out = { ...preset };
  delete out.key;
  return out;
}
