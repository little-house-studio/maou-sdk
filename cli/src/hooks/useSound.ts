/**
 * 音效管理器 —— Ink CLI 版（无 Pi TUI 依赖）。
 *
 * 职责：
 *   - 平台检测：macOS→afplay，Linux→paplay/aplay，无播放器→BEL 回退
 *   - play(id)：播放 WAV 音效
 *   - 空闲检测：startIdleTimer/resetIdleTimer/clearIdleTimer
 *   - 配置：SoundConfig + 环境变量覆盖
 *
 * 音频播放用 child_process.spawn + unref()（fire-and-forget，不阻塞事件循环）。
 * 不做桌面通知（Ink CLI 用备用屏，OSC 通知不适用）。
 */

import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execSync } from "node:child_process";

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
