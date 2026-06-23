/**
 * 设备注册表
 * 对齐 Python: core/server/hub/device/registry.py
 *
 * 管理设备信息，支持持久化到文件。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DeviceInfo, DeviceStatus } from './types.js'

// ─── DeviceRegistry ──────────────────────────────────────────────────────────

/** 设备注册表，管理多设备信息 */
export class DeviceRegistry {
  private _devices: Map<string, DeviceInfo> = new Map()
  private _storagePath: string | null

  constructor(storagePath?: string) {
    this._storagePath = storagePath ?? null
    this._load()
  }

  /** 注册或更新设备信息 */
  register(info: DeviceInfo): DeviceInfo {
    const existing = this._devices.get(info.device_id)
    if (existing) {
      // 保留已有的 status 和 last_seen（如果新值为空）
      if (!info.status) info.status = existing.status
      if (!info.last_seen) info.last_seen = existing.last_seen
    }
    this._devices.set(info.device_id, info)
    this._save()
    return info
  }

  /** 注销设备 */
  unregister(deviceId: string): boolean {
    if (!this._devices.has(deviceId)) return false
    this._devices.delete(deviceId)
    this._save()
    return true
  }

  /** 获取设备信息 */
  get(deviceId: string): DeviceInfo | undefined {
    return this._devices.get(deviceId)
  }

  /** 列出设备，可按状态过滤 */
  list(status?: DeviceStatus): DeviceInfo[] {
    let devices = Array.from(this._devices.values())
    if (status) {
      devices = devices.filter((d) => d.status === status)
    }
    return devices
  }

  /** 更新设备在线状态 */
  updateStatus(deviceId: string, status: DeviceStatus): boolean {
    const info = this._devices.get(deviceId)
    if (!info) return false
    info.status = status
    info.last_seen = new Date().toISOString()
    this._save()
    return true
  }

  /** 更新设备最后活跃时间 */
  updateLastSeen(deviceId: string): boolean {
    const info = this._devices.get(deviceId)
    if (!info) return false
    info.last_seen = new Date().toISOString()
    info.status = 'online'
    this._save()
    return true
  }

  /** 设备总数 */
  get count(): number {
    return this._devices.size
  }

  // ── 持久化 ──

  private _load(): void {
    if (!this._storagePath) return
    if (!existsSync(this._storagePath)) return

    try {
      const raw = readFileSync(this._storagePath, 'utf-8')
      const data = JSON.parse(raw)
      const rawList: unknown[] = Array.isArray(data) ? data : data.devices ?? []
      for (const item of rawList) {
        const info = item as DeviceInfo
        this._devices.set(info.device_id, info)
      }
    } catch {
      // 文件解析失败，重置为空
      this._devices.clear()
    }
  }

  private _save(): void {
    if (!this._storagePath) return
    try {
      const dir = dirname(this._storagePath)
      mkdirSync(dir, { recursive: true })
      const rawList = Array.from(this._devices.values())
      const content = JSON.stringify({ devices: rawList }, null, 2)
      const tmpPath = this._storagePath + '.tmp'
      writeFileSync(tmpPath, content, 'utf-8')
      // 原子替换
      renameSync(tmpPath, this._storagePath)
    } catch {
      // 持久化失败不影响运行
    }
  }
}
