/**
 * 插件配置管理器
 *
 * 负责读取、保存、管理插件配置
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { PluginConfig } from './plugin-types.js';

// ─── 默认配置 ────────────────────────────────────────────────────────────────

const DEFAULT_PLUGIN_CONFIG: PluginConfig = {
  name: '',
  version: '1.0.0',
  description: '',
  enabled: true,
  autoStart: true,
  priority: 100,
  dependencies: [],
  mode: 'subprocess',
  command: '',
};

// ─── 插件配置管理器 ──────────────────────────────────────────────────────────

export class PluginConfigManager {
  private configPath: string;
  private pluginsDir: string;
  private config: Record<string, PluginConfig> = {};

  constructor(projectRoot: string) {
    this.configPath = join(projectRoot, '.maou', 'plugins.json');
    this.pluginsDir = join(projectRoot, 'plugins');
    this.load();
  }

  // ── 加载配置 ──────────────────────────────────────────────────────────────

  load(): void {
    try {
      if (existsSync(this.configPath)) {
        const text = readFileSync(this.configPath, 'utf-8');
        this.config = JSON.parse(text);
      } else {
        this.config = {};
      }
    } catch (err) {
      console.error('[PluginConfig] 加载配置失败:', err);
      this.config = {};
    }
  }

  // ── 保存配置 ──────────────────────────────────────────────────────────────

  save(): void {
    try {
      const dir = dirname(this.configPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (err) {
      console.error('[PluginConfig] 保存配置失败:', err);
    }
  }

  // ── 获取插件配置 ──────────────────────────────────────────────────────────

  getPlugin(name: string): PluginConfig | undefined {
    return this.config[name];
  }

  // ── 获取所有插件配置 ──────────────────────────────────────────────────────

  getAllPlugins(): Record<string, PluginConfig> {
    return { ...this.config };
  }

  // ── 设置插件配置 ──────────────────────────────────────────────────────────

  setPlugin(name: string, config: Partial<PluginConfig>): void {
    this.config[name] = {
      ...DEFAULT_PLUGIN_CONFIG,
      ...this.config[name],
      ...config,
      name,
    };
    this.save();
  }

  // ── 删除插件配置 ──────────────────────────────────────────────────────────

  deletePlugin(name: string): boolean {
    if (!this.config[name]) {
      return false;
    }
    delete this.config[name];
    this.save();
    return true;
  }

  // ── 启用/禁用插件 ─────────────────────────────────────────────────────────

  togglePlugin(name: string, enabled: boolean): boolean {
    if (!this.config[name]) {
      return false;
    }
    this.config[name].enabled = enabled;
    this.save();
    return true;
  }

  // ── 设置自动启动 ──────────────────────────────────────────────────────────

  setAutoStart(name: string, autoStart: boolean): boolean {
    if (!this.config[name]) {
      return false;
    }
    this.config[name].autoStart = autoStart;
    this.save();
    return true;
  }

  // ── 设置优先级 ────────────────────────────────────────────────────────────

  setPriority(name: string, priority: number): boolean {
    if (!this.config[name]) {
      return false;
    }
    this.config[name].priority = priority;
    this.save();
    return true;
  }

  // ── 添加依赖 ──────────────────────────────────────────────────────────────

  addDependency(name: string, dependency: string): boolean {
    if (!this.config[name]) {
      return false;
    }
    if (!this.config[name].dependencies) {
      this.config[name].dependencies = [];
    }
    if (!this.config[name].dependencies!.includes(dependency)) {
      this.config[name].dependencies!.push(dependency);
      this.save();
    }
    return true;
  }

  // ── 删除依赖 ──────────────────────────────────────────────────────────────

  removeDependency(name: string, dependency: string): boolean {
    if (!this.config[name]) {
      return false;
    }
    if (!this.config[name].dependencies) {
      return true;
    }
    const index = this.config[name].dependencies!.indexOf(dependency);
    if (index !== -1) {
      this.config[name].dependencies!.splice(index, 1);
      this.save();
    }
    return true;
  }

  // ── 获取启用的插件列表 ────────────────────────────────────────────────────

  getEnabledPlugins(): PluginConfig[] {
    return Object.values(this.config).filter(p => p.enabled);
  }

  // ── 获取自动启动的插件列表 ────────────────────────────────────────────────

  getAutoStartPlugins(): PluginConfig[] {
    return Object.values(this.config)
      .filter(p => p.enabled && p.autoStart)
      .sort((a, b) => a.priority - b.priority);
  }

  // ── 从插件目录自动发现插件 ────────────────────────────────────────────────

  discoverPlugins(): string[] {
    const discovered: string[] = [];
    // 这个方法会在 PluginManager 中实现
    return discovered;
  }

  // ── 验证配置 ──────────────────────────────────────────────────────────────

  validateConfig(name: string): { valid: boolean; errors: string[] } {
    const config = this.config[name];
    if (!config) {
      return { valid: false, errors: ['插件不存在'] };
    }

    const errors: string[] = [];

    if (!config.name) {
      errors.push('缺少插件名称');
    }
    if (!config.command) {
      errors.push('缺少启动命令');
    }
    if (config.priority < 0) {
      errors.push('优先级不能为负数');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
