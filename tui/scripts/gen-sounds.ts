#!/usr/bin/env node
/**
 * 音效 WAV 文件生成器 —— 一次性脚本，运行后将产物提交到 src/sounds/。
 *
 * 生成 4 个 mono 22050Hz 16-bit PCM WAV 文件：
 *   done.wav     — 短促上行音阶（C5→E5→G5，0.45s）
 *   error.wav    — 低沉下行蜂鸣（A3→F3，0.35s，方波）
 *   warning.wav  — 双响 B4（0.35s，两声短促）
 *   approval.wav — 清亮叮声 C6（0.25s，正弦衰减）
 *
 * 用法：node scripts/gen-sounds.ts
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "..", "src", "sounds");

// ── WAV 写入工具 ──────────────────────────────────────────────

const SAMPLE_RATE = 22050;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;
const BYTE_RATE = SAMPLE_RATE * NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
const BLOCK_ALIGN = NUM_CHANNELS * (BITS_PER_SAMPLE / 8);

function writeWav(filename: string, samples: Float64Array): void {
  const numSamples = samples.length;
  const dataSize = numSamples * (BITS_PER_SAMPLE / 8);
  const bufferSize = 44 + dataSize;
  const buf = Buffer.alloc(bufferSize);

  // RIFF header
  buf.write("RIFF", 0);
  buf.writeUInt32LE(bufferSize - 8, 4);
  buf.write("WAVE", 8);

  // fmt sub-chunk
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);             // SubChunk1Size
  buf.writeUInt16LE(1, 20);              // PCM
  buf.writeUInt16LE(NUM_CHANNELS, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(BYTE_RATE, 28);
  buf.writeUInt16LE(BLOCK_ALIGN, 32);
  buf.writeUInt16LE(BITS_PER_SAMPLE, 34);

  // data sub-chunk
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);

  // Write PCM samples (clamp to [-1, 1] then convert to int16)
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    const val = Math.round(s * 32767);
    buf.writeInt16LE(val, 44 + i * 2);
  }

  const outPath = resolve(OUT_DIR, filename);
  writeFileSync(outPath, buf);
  const kb = (bufferSize / 1024).toFixed(1);
  console.log(`  ${filename} — ${(numSamples / SAMPLE_RATE).toFixed(2)}s, ${kb}KB → ${outPath}`);
}

// ── 信号生成原语 ──────────────────────────────────────────────

function sine(freq: number, t: number): number {
  return Math.sin(2 * Math.PI * freq * t);
}

function square(freq: number, t: number): number {
  return Math.sin(2 * Math.PI * freq * t) >= 0 ? 0.6 : -0.6;
}

/** ADSR 包络：attack/decay/sustain-level/release 都是 0..1 比例 */
function adsr(
  sampleCount: number,
  attack: number,   // fraction of total
  decay: number,    // fraction of total
  sustainLevel: number, // 0..1
  release: number,  // fraction of total
): Float64Array {
  const env = new Float64Array(sampleCount);
  const aEnd = Math.floor(sampleCount * attack);
  const dEnd = Math.floor(sampleCount * (attack + decay));
  const rStart = Math.floor(sampleCount * (1 - release));
  for (let i = 0; i < sampleCount; i++) {
    if (i < aEnd) {
      env[i] = i / aEnd;
    } else if (i < dEnd) {
      const frac = (i - aEnd) / (dEnd - aEnd);
      env[i] = 1 - frac * (1 - sustainLevel);
    } else if (i < rStart) {
      env[i] = sustainLevel;
    } else {
      const frac = (i - rStart) / (sampleCount - rStart);
      env[i] = sustainLevel * (1 - frac);
    }
  }
  return env;
}

// ── 音色定义 ──────────────────────────────────────────────────

function genDone(): Float64Array {
  // 上行三连音 C5→E5→G5，每音 0.15s，正弦波 + 柔和包络
  const noteDur = 0.15;
  const totalDur = noteDur * 3;
  const totalSamples = Math.ceil(SAMPLE_RATE * totalDur);
  const samples = new Float64Array(totalSamples);
  const freqs = [523.25, 659.25, 783.99]; // C5, E5, G5

  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    const noteIdx = Math.min(Math.floor(t / noteDur), 2);
    const localT = t - noteIdx * noteDur;
    const freq = freqs[noteIdx]!;

    // 每个音符独立的包络
    const noteSamples = Math.ceil(SAMPLE_RATE * noteDur);
    const localIdx = i - noteIdx * noteSamples;
    const noteEnv = adsr(noteSamples, 0.02, 0.1, 0.7, 0.15);

    samples[i] = sine(freq, localT) * (noteEnv[localIdx] ?? 0) * 0.5;
  }
  return samples;
}

function genError(): Float64Array {
  // 下行 A3→F3，方波，0.35s
  const totalDur = 0.35;
  const totalSamples = Math.ceil(SAMPLE_RATE * totalDur);
  const samples = new Float64Array(totalSamples);
  const freqs = [220, 174.61]; // A3, F3

  const env = adsr(totalSamples, 0.01, 0.05, 0.8, 0.15);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    // 前 0.175s A3，后 0.175s F3
    const freq = t < totalDur / 2 ? freqs[0]! : freqs[1]!;
    samples[i] = square(freq, t) * (env[i] ?? 0) * 0.35;
  }
  return samples;
}

function genWarning(): Float64Array {
  // 双响 B4，每响 0.1s，间隔 0.08s，总 0.35s
  const beepDur = 0.1;
  const gap = 0.08;
  const totalDur = beepDur * 2 + gap;
  const totalSamples = Math.ceil(SAMPLE_RATE * totalDur);
  const samples = new Float64Array(totalSamples);
  const freq = 493.88; // B4

  const beepSamples = Math.ceil(SAMPLE_RATE * beepDur);
  const gapStart = beepSamples;
  const gapEnd = beepSamples + Math.ceil(SAMPLE_RATE * gap);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    if (i >= gapStart && i < gapEnd) {
      samples[i] = 0; // 静音间隔
    } else {
      const localIdx = i < gapStart ? i : i - gapEnd;
      const noteEnv = adsr(beepSamples, 0.01, 0.05, 0.7, 0.2);
      samples[i] = sine(freq, t) * (noteEnv[localIdx] ?? 0) * 0.45;
    }
  }
  return samples;
}

function genApproval(): Float64Array {
  // 清亮 C6 叮声，正弦波 + 快速衰减，0.25s
  const totalDur = 0.25;
  const totalSamples = Math.ceil(SAMPLE_RATE * totalDur);
  const samples = new Float64Array(totalSamples);
  const freq = 1046.5; // C6

  // 快速衰减包络（类似铃声）
  const env = adsr(totalSamples, 0.005, 0.05, 0.4, 0.35);

  for (let i = 0; i < totalSamples; i++) {
    const t = i / SAMPLE_RATE;
    // 加一点泛音让声音更亮
    const fundamental = sine(freq, t);
    const harmonic = sine(freq * 2, t) * 0.3;
    samples[i] = (fundamental + harmonic) * (env[i] ?? 0) * 0.45;
  }
  return samples;
}

// ── 主流程 ────────────────────────────────────────────────────

console.log("Generating MAOU TUI sound effects...\n");
mkdirSync(OUT_DIR, { recursive: true });

writeWav("done.wav", genDone());
writeWav("error.wav", genError());
writeWav("warning.wav", genWarning());
writeWav("approval.wav", genApproval());

console.log("\n✅ All sounds generated.");
