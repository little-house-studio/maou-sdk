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
  /**
   * 完全卡住（API 失败后无人交互）时的长铃声：
   * 每隔 ringIntervalSec 响一次 error，最长 ringDurationSec，
   * 有任何用户交互（clearStuckAlarm）即停。
   */
  stuckRingDurationSec: number;
  stuckRingIntervalSec: number;
}

export const DEFAULT_SOUND_CONFIG: SoundConfig = {
  enabled: true,
  volume: 0.7,
  events: { done: true, error: true, warning: true, approval: true },
  idleTimeoutSec: 60,
  // 完全卡住：默认响 10 秒（间隔 1s），有交互即停；可用 ui.sounds 覆盖
  stuckRingDurationSec: 10,
  stuckRingIntervalSec: 1,
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
    if (typeof sounds.stuckRingDurationSec === "number") {
      result.stuckRingDurationSec = sounds.stuckRingDurationSec;
    }
    if (typeof sounds.stuckRingIntervalSec === "number") {
      result.stuckRingIntervalSec = sounds.stuckRingIntervalSec;
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
  /** 卡住长铃声：interval + 总时长截止 */
  private stuckInterval: ReturnType<typeof setInterval> | null = null;
  private stuckDeadline = 0;

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

  /** 只响一声（不启动卡住长铃） */
  playOnce(id: SoundId): void {
    this.play(id);
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

  /**
   * 完全卡住（API 失败/重试耗尽）→ 电话式长铃：
   * 每 stuckRingIntervalSec 响 error，最长 stuckRingDurationSec，
   * 直到 clearStuckAlarm（用户在场：键/鼠/点/滚/打字）。
   * 语义：提醒「人不在」；人已在操作界面则立刻停。
   */
  startStuckAlarm(): void {
    // 已在响：不要重启（否则每次 error 事件又叠一轮「连响几十次」）
    if (this.stuckInterval) return;
    if (!this.config.enabled) return;
    const durationMs = Math.max(0, this.config.stuckRingDurationSec) * 1000;
    const intervalMs = Math.max(500, this.config.stuckRingIntervalSec * 1000);
    if (durationMs <= 0) {
      // 仅响一声
      this.play("error");
      return;
    }
    this.stuckDeadline = Date.now() + durationMs;
    // 立刻响一次
    this.play("error");
    this.stuckInterval = setInterval(() => {
      if (Date.now() >= this.stuckDeadline) {
        this.clearStuckAlarm();
        return;
      }
      this.play("error");
    }, intervalMs);
  }

  clearStuckAlarm(): void {
    if (this.stuckInterval) {
      clearInterval(this.stuckInterval);
      this.stuckInterval = null;
    }
    this.stuckDeadline = 0;
  }

  /**
   * 用户在场：停卡住长铃。
   * 由 TUI 任意键鼠/业务消息触发（含 user_activity / input_update / click…）。
   */
  onUserInteraction(): void {
    this.clearStuckAlarm();
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
