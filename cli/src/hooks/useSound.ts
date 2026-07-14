/**
 * 音效管理器 —— Ink CLI 版（无 Pi TUI 依赖）。
 *
 * 职责：
 *   - 平台检测：macOS→afplay，Linux→paplay/aplay，无播放器→BEL 回退
 *   - play(id)：播放 WAV 音效
 *   - 空闲检测：startIdleTimer/resetIdleTimer/clearIdleTimer
 *   - 配置：SoundConfig + ~/.maou/config.json ui.sounds + 环境变量覆盖
 *
 * 音频播放用 child_process.spawn + unref()（fire-and-forget，不阻塞事件循环）。
 * 不做桌面通知（Ink CLI 用备用屏，OSC 通知不适用）。
 *
 * 音效文件：src/sounds/*.wav（dev 经 tsx 直读）/ dist/sounds/*.wav（build 后拷贝）。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";
import { userConfigPath } from "../config/paths.js";

// ── 音效标识 ──────────────────────────────────────────────────
export type SoundId = "done" | "error" | "warning" | "approval";

export interface SoundConfig {
  enabled: boolean;
  volume: number;         // 0..1（仅 macOS afplay -v 生效）
  events: {               // 每种事件独立开关
    done: boolean;
    error: boolean;
    warning: boolean;
    approval: boolean;
  };
  idleTimeoutSec: number; // 0 = 禁用空闲检测
}

export const DEFAULT_SOUND_CONFIG: SoundConfig = {
  enabled: true,
  volume: 0.7,
  events: { done: true, error: true, warning: true, approval: true },
  idleTimeoutSec: 60,
};

/**
 * 从 ~/.maou/config.json 读取 ui.sounds 配置段。
 * 轻量读取，不依赖 ConfigStore（避免 zod/jsonc-parser 重依赖）。
 *
 * 支持字段：
 *   enabled, volume, idleTimeout / idleTimeoutSec,
 *   done / error / warning / approval（boolean 事件开关）
 */
export function loadSoundConfig(): Partial<SoundConfig> | undefined {
  const cfgPath = userConfigPath();
  if (!existsSync(cfgPath)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
    const ui = raw.ui as Record<string, unknown> | undefined;
    if (!ui) return undefined;
    const sounds = ui.sounds as Record<string, unknown> | undefined;
    if (!sounds) return undefined;

    const result: Partial<SoundConfig> = {};
    if (typeof sounds.enabled === "boolean") result.enabled = sounds.enabled;
    if (typeof sounds.volume === "number") result.volume = sounds.volume;
    if (typeof sounds.idleTimeout === "number" || typeof sounds.idleTimeoutSec === "number") {
      result.idleTimeoutSec =
        typeof sounds.idleTimeoutSec === "number"
          ? sounds.idleTimeoutSec
          : (sounds.idleTimeout as number);
    }

    const evtDone = typeof sounds.done === "boolean" ? sounds.done : undefined;
    const evtError = typeof sounds.error === "boolean" ? sounds.error : undefined;
    const evtWarning = typeof sounds.warning === "boolean" ? sounds.warning : undefined;
    const evtApproval = typeof sounds.approval === "boolean" ? sounds.approval : undefined;
    if (
      evtDone !== undefined ||
      evtError !== undefined ||
      evtWarning !== undefined ||
      evtApproval !== undefined
    ) {
      result.events = {
        done: evtDone ?? true,
        error: evtError ?? true,
        warning: evtWarning ?? true,
        approval: evtApproval ?? true,
      };
    }
    return result;
  } catch {
    return undefined;
  }
}

// ── 平台音频播放器检测 ────────────────────────────────────────
interface AudioPlayer {
  cmd: string;
  baseArgs: string[];
  volumeFlag?: string;
}

function detectAudioPlayer(): AudioPlayer | null {
  const platform = process.platform;
  if (platform === "darwin") {
    return { cmd: "afplay", baseArgs: [], volumeFlag: "-v" };
  }
  if (platform === "linux") {
    if (hasCmd("paplay")) return { cmd: "paplay", baseArgs: [] };
    if (hasCmd("aplay")) return { cmd: "aplay", baseArgs: ["-q"] };
    return null;
  }
  return null;
}

function hasCmd(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: "pipe", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

// ── 音效文件路径解析 ──────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const SOUNDS_DIR = resolve(__dirname, "..", "sounds");

function soundPath(id: SoundId): string {
  return join(SOUNDS_DIR, `${id}.wav`);
}

// ── SoundManager 类 ───────────────────────────────────────────

export class SoundManager {
  private config: SoundConfig;
  private player: AudioPlayer | null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(configOverrides?: Partial<SoundConfig>) {
    this.config = { ...DEFAULT_SOUND_CONFIG, ...configOverrides };
    if (configOverrides?.events) {
      this.config.events = { ...DEFAULT_SOUND_CONFIG.events, ...configOverrides.events };
    }

    this.player = detectAudioPlayer();

    const envEnabled = process.env.MAOU_SOUNDS;
    if (envEnabled === "0" || envEnabled === "off" || envEnabled === "false") {
      this.config.enabled = false;
    }
    const envVolume = process.env.MAOU_SOUNDS_VOLUME;
    if (envVolume) {
      const v = parseFloat(envVolume);
      if (!isNaN(v) && v >= 0 && v <= 1) this.config.volume = v;
    }
    const envIdle = process.env.MAOU_SOUNDS_IDLE_TIMEOUT;
    if (envIdle) {
      const t = parseInt(envIdle, 10);
      if (!isNaN(t) && t >= 0) this.config.idleTimeoutSec = t;
    }
  }

  /** 播放音效。 */
  play(id: SoundId): void {
    if (!this.config.enabled) return;
    if (!this.config.events[id]) return;

    if (this.player) {
      this.playAudioFile(id);
    } else {
      // 无播放器 → 回退到终端 BEL
      try {
        process.stdout.write("\x07");
      } catch { /* headless */ }
    }
  }

  private playAudioFile(id: SoundId): void {
    const filePath = soundPath(id);
    if (!existsSync(filePath)) return;

    const player = this.player!;
    const args = [...player.baseArgs];
    if (player.volumeFlag) {
      args.push(player.volumeFlag, String(this.config.volume));
    }
    args.push(filePath);

    try {
      const child = spawn(player.cmd, args, { stdio: "ignore", detached: false });
      child.unref();
    } catch {
      // 音频播放失败是静默的
    }
  }

  // ── 空闲/卡住检测 ─────────────────────────────────────────

  startIdleTimer(): void {
    this.clearIdleTimer();
    if (this.config.idleTimeoutSec <= 0) return;
    this.idleTimer = setTimeout(() => {
      this.play("approval");
    }, this.config.idleTimeoutSec * 1000);
  }

  resetIdleTimer(): void {
    if (this.idleTimer) {
      this.startIdleTimer();
    }
  }

  clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  updateConfig(partial: Partial<SoundConfig>): void {
    this.config = { ...this.config, ...partial };
    if (partial.events) {
      this.config.events = { ...this.config.events, ...partial.events };
    }
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }
}
