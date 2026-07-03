/**
 * 音效管理器 —— TUI 层的副作用通道。
 *
 * 职责：
 *   - 平台检测：macOS→afplay，Linux→paplay/aplay，无播放器→BEL 回退
 *   - play(id, notification?)：同时触发桌面通知 + 音频播放
 *   - 空闲检测：startIdleTimer/resetIdleTimer/clearIdleTimer
 *   - 配置：SoundConfig + 环境变量覆盖
 *
 * 音频播放用 child_process.spawn + unref()（fire-and-forget，不阻塞事件循环）。
 * 桌面通知走 Pi TUI 的 TERMINAL.sendNotification()（自动处理 OSC 9/99/BEL + tmux + D-Bus）。
 *
 * 不在 reducer 中触发——reducer 是纯函数，音效是副作用，由 AgentDriver.applyEvent() 调用。
 */

import { TERMINAL, isNotificationSuppressed } from "@oh-my-pi/pi-tui";
import type { TerminalNotification } from "@oh-my-pi/pi-tui";
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
  /** afplay 支持 -v 控制音量；paplay/aplay 不支持 */
  volumeFlag?: string;
}

function detectAudioPlayer(): AudioPlayer | null {
  const platform = process.platform;
  if (platform === "darwin") {
    // macOS 自带 afplay
    return { cmd: "afplay", baseArgs: [], volumeFlag: "-v" };
  }
  if (platform === "linux") {
    // 优先 PulseAudio（桌面 Linux），回退 ALSA
    if (hasCmd("paplay")) return { cmd: "paplay", baseArgs: [] };
    if (hasCmd("aplay")) return { cmd: "aplay", baseArgs: ["-q"] };
    return null;
  }
  // Windows：可用 PowerShell [Media.SoundPlayer]，暂低优先级
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
const SOUNDS_DIR = resolve(__dirname, "sounds");

function soundPath(id: SoundId): string {
  return join(SOUNDS_DIR, `${id}.wav`);
}

// ── SoundManager 类 ───────────────────────────────────────────

export class SoundManager {
  private config: SoundConfig;
  private player: AudioPlayer | null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(configOverrides?: Partial<SoundConfig>) {
    // 合并配置（浅合并 + events 深合并）
    this.config = { ...DEFAULT_SOUND_CONFIG, ...configOverrides };
    if (configOverrides?.events) {
      this.config.events = { ...DEFAULT_SOUND_CONFIG.events, ...configOverrides.events };
    }

    this.player = detectAudioPlayer();

    // 环境变量覆盖
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

  /** 播放音效 + 可选桌面通知。 */
  play(id: SoundId, notification?: TerminalNotification | string): void {
    if (!this.config.enabled) return;
    if (!this.config.events[id]) return;

    // 第一层：桌面通知（Pi TUI 自动处理 OSC 9/99/BEL + tmux 透传 + Linux D-Bus）
    if (notification && !isNotificationSuppressed()) {
      try {
        TERMINAL.sendNotification(notification);
      } catch {
        // sendNotification 可能抛（headless 环境），静默忽略
      }
    }

    // 第二层：音频文件播放
    if (this.player) {
      this.playAudioFile(id);
    } else if (!notification) {
      // 无播放器且未发通知 → 回退到终端 BEL
      // （若已发通知，Bell 协议的终端已由 sendNotification 发了 BEL）
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
      // Fire-and-forget：unref() 使子进程不阻塞事件循环和进程退出
      const child = spawn(player.cmd, args, {
        stdio: "ignore",
        detached: false,
      });
      child.unref();
    } catch {
      // 音频播放失败是静默的——不影响主流程
    }
  }

  // ── 空闲/卡住检测 ─────────────────────────────────────────

  /** 启动空闲计时器（streaming 开始时调用）。 */
  startIdleTimer(): void {
    this.clearIdleTimer();
    if (this.config.idleTimeoutSec <= 0) return;
    this.idleTimer = setTimeout(() => {
      this.play("approval", {
        title: "MAOU",
        body: "Agent 空闲 — 可能需要交互",
        urgency: "normal",
      } as TerminalNotification);
    }, this.config.idleTimeoutSec * 1000);
  }

  /** 重置空闲计时器（streaming 中收到事件时调用）。 */
  resetIdleTimer(): void {
    if (this.idleTimer) {
      this.startIdleTimer(); // 重启
    }
  }

  /** 清除空闲计时器（done/error/abort 时调用）。 */
  clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // ── 配置 ─────────────────────────────────────────────────

  /** 运行时更新配置（如 Ctrl+S 切换、加载 config.json 后）。 */
  updateConfig(partial: Partial<SoundConfig>): void {
    this.config = { ...this.config, ...partial };
    if (partial.events) {
      this.config.events = { ...this.config.events, ...partial.events };
    }
  }

  /** 当前是否启用。 */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}
