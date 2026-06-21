/**
 * 插件管理器
 *
 * 负责插件的发现、启动、停止、重启等生命周期管理
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import type { PluginConfig, PluginInstance, PluginEvent, PluginStatus } from './plugin-types.js';
import { PluginConfigManager } from './plugin-config.js';

// ─── 常量 ────────────────────────────────────────────────────────────────────

const MAX_RESTARTS = 3;
const RESTART_DELAY = 5000; // 5秒

// ─── 插件管理器 ──────────────────────────────────────────────────────────────

export class PluginManager extends EventEmitter {
  private plugins: Map<string, PluginInstance> = new Map();
  private configManager: PluginConfigManager;
  private projectRoot: string;
  private maxRestarts: number;
  private restartDelay: number;

  constructor(projectRoot: string, options?: { maxRestarts?: number; restartDelay?: number }) {
    super();
    this.projectRoot = projectRoot;
    this.configManager = new PluginConfigManager(projectRoot);
    this.maxRestarts = options?.maxRestarts ?? MAX_RESTARTS;
    this.restartDelay = options?.restartDelay ?? RESTART_DELAY;
  }

  // ── 发现插件 ──────────────────────────────────────────────────────────────

  async discoverPlugins(): Promise<string[]> {
    const pluginsDir = join(this.projectRoot, 'plugins');
    const discovered: string[] = [];

    if (!existsSync(pluginsDir)) {
      return discovered;
    }

    const entries = readdirSync(pluginsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const pluginDir = join(pluginsDir, entry.name);
      const configPath = join(pluginDir, 'plugin.json');

      // 检查是否有 plugin.json
      if (existsSync(configPath)) {
        try {
          const configText = readFileSync(configPath, 'utf-8');
          const config = JSON.parse(configText) as PluginConfig;

          // 注册插件配置
          this.configManager.setPlugin(entry.name, {
            ...config,
            name: entry.name,
          });

          discovered.push(entry.name);
        } catch (err) {
          console.error(`[PluginManager] 加载插件配置失败: ${entry.name}`, err);
        }
      } else {
        // 尝试自动检测插件类型
        const detected = this.detectPluginType(entry.name, pluginDir);
        if (detected) {
          this.configManager.setPlugin(entry.name, detected);
          discovered.push(entry.name);
        }
      }
    }

    return discovered;
  }

  // ── 自动检测插件类型 ──────────────────────────────────────────────────────

  private detectPluginType(name: string, pluginDir: string): Partial<PluginConfig> | null {
    // 检查 TypeScript 插件
    if (existsSync(join(pluginDir, 'index.ts'))) {
      return {
        name,
        command: `npx tsx plugins/${name}/index.ts start`,
        autoStart: true,
        priority: 100,
      };
    }

    // 检查 Python 插件
    if (existsSync(join(pluginDir, 'desktop.py'))) {
      return {
        name,
        command: `python3 plugins/${name}/desktop.py`,
        autoStart: true,
        priority: 100,
      };
    }

    // 检查 package.json
    if (existsSync(join(pluginDir, 'package.json'))) {
      try {
        const pkgText = readFileSync(join(pluginDir, 'package.json'), 'utf-8');
        const pkg = JSON.parse(pkgText);
        if (pkg.scripts?.start) {
          return {
            name,
            command: `cd plugins/${name} && npm start`,
            autoStart: true,
            priority: 100,
          };
        }
      } catch {
        // 忽略
      }
    }

    return null;
  }

  // ── 启动插件 ──────────────────────────────────────────────────────────────

  async startPlugin(name: string): Promise<boolean> {
    const config = this.configManager.getPlugin(name);
    if (!config) {
      console.error(`[PluginManager] 插件不存在: ${name}`);
      return false;
    }

    if (!config.enabled) {
      console.log(`[PluginManager] 插件已禁用: ${name}`);
      return false;
    }

    // 检查是否已在运行
    const existing = this.plugins.get(name);
    if (existing && existing.status === 'running') {
      console.log(`[PluginManager] 插件已在运行: ${name}`);
      return true;
    }

    // 检查依赖
    for (const dep of config.dependencies || []) {
      const depPlugin = this.plugins.get(dep);
      if (!depPlugin || depPlugin.status !== 'running') {
        console.log(`[PluginManager] 启动依赖: ${dep}`);
        const depStarted = await this.startPlugin(dep);
        if (!depStarted) {
          console.error(`[PluginManager] 依赖启动失败: ${dep}`);
          return false;
        }
      }
    }

    // 根据模式选择启动方式
    if (config.mode === 'module') {
      return this.startModulePlugin(name, config);
    } else {
      return this.startSubprocessPlugin(name, config);
    }
  }

  // ── 模块模式启动 ──────────────────────────────────────────────────────────

  private async startModulePlugin(name: string, config: PluginConfig): Promise<boolean> {
    const pluginDir = join(this.projectRoot, 'plugins', name);
    const entryFile = config.entry || 'index.js';
    const entryPath = join(pluginDir, entryFile);

    if (!existsSync(entryPath)) {
      console.error(`[PluginManager] 模块入口文件不存在: ${entryPath}`);
      return false;
    }

    console.log(`[PluginManager] 启动模块插件: ${name} (${entryPath})`);

    try {
      // 动态导入模块
      const moduleUrl = pathToFileURL(entryPath).href;
      const pluginModule = await import(moduleUrl);

      // 检查模块是否暴露 start 函数
      if (typeof pluginModule.start !== 'function') {
        console.error(`[PluginManager] 插件 ${name} 未暴露 start() 函数`);
        return false;
      }

      // 调用 start 函数
      const pluginApi = await pluginModule.start({
        projectRoot: this.projectRoot,
        config,
      });

      const instance: PluginInstance = {
        name,
        config,
        status: 'running',
        startedAt: new Date().toISOString(),
        path: pluginDir,
        moduleApi: pluginApi,
      };

      this.plugins.set(name, instance);

      this.emit('started', { type: 'started', plugin: name, timestamp: new Date().toISOString() });
      return true;
    } catch (err) {
      console.error(`[PluginManager] 模块插件启动失败: ${name}`, err);
      const instance: PluginInstance = {
        name,
        config,
        status: 'error',
        startedAt: new Date().toISOString(),
        path: pluginDir,
        error: err instanceof Error ? err.message : String(err),
      };
      this.plugins.set(name, instance);
      this.emit('error', { type: 'error', plugin: name, timestamp: new Date().toISOString(), data: err });
      return false;
    }
  }

  // ── 子进程模式启动 ────────────────────────────────────────────────────────

  private async startSubprocessPlugin(name: string, config: PluginConfig): Promise<boolean> {
    if (!config.command) {
      console.error(`[PluginManager] 插件 ${name} 未配置启动命令`);
      return false;
    }

    console.log(`[PluginManager] 启动子进程插件: ${name} (${config.command})`);

    const pluginDir = join(this.projectRoot, 'plugins', name);
    const childProcess = spawn(config.command, {
      cwd: config.cwd || pluginDir,
      stdio: 'pipe',
      shell: true,
      env: {
        ...process.env,
        ...config.env,
        PLUGIN_NAME: name,
        PLUGIN_DIR: pluginDir,
      },
    });

    const instance: PluginInstance = {
      name,
      config,
      status: 'running',
      pid: childProcess.pid,
      process: childProcess,
      startedAt: new Date().toISOString(),
      path: pluginDir,
    };

    this.plugins.set(name, instance);

    // 监听进程事件
    childProcess.stdout?.on('data', (data: Buffer) => {
      console.log(`[${name}] ${data.toString().trim()}`);
    });

    childProcess.stderr?.on('data', (data: Buffer) => {
      console.error(`[${name}] ${data.toString().trim()}`);
    });

    childProcess.on('exit', (code: number | null, signal: string | null) => {
      console.log(`[PluginManager] 插件退出: ${name} (code: ${code}, signal: ${signal})`);
      instance.status = 'stopped';
      this.emit('stopped', { type: 'stopped', plugin: name, timestamp: new Date().toISOString() });

      // 自动重启
      if (config.autoStart && code !== 0 && signal !== 'SIGTERM') {
        this.handlePluginCrash(name);
      }
    });

    childProcess.on('error', (err: Error) => {
      console.error(`[PluginManager] 插件错误: ${name}`, err);
      instance.status = 'error';
      instance.error = err.message;
      this.emit('error', { type: 'error', plugin: name, timestamp: new Date().toISOString(), data: err.message });
    });

    this.emit('started', { type: 'started', plugin: name, timestamp: new Date().toISOString() });
    return true;
  }

  // ── 停止插件 ──────────────────────────────────────────────────────────────

  async stopPlugin(name: string): Promise<boolean> {
    const instance = this.plugins.get(name);
    if (!instance) {
      console.error(`[PluginManager] 插件不存在: ${name}`);
      return false;
    }

    if (instance.status !== 'running') {
      console.log(`[PluginManager] 插件未运行: ${name}`);
      return true;
    }

    console.log(`[PluginManager] 停止插件: ${name}`);

    // 发送 SIGTERM
    instance.process?.kill('SIGTERM');

    // 等待进程退出
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        // 强制杀死
        instance.process?.kill('SIGKILL');
        resolve();
      }, 5000);

      instance.process?.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    instance.status = 'stopped';
    instance.process = undefined;
    instance.pid = undefined;

    return true;
  }

  // ── 重启插件 ──────────────────────────────────────────────────────────────

  async restartPlugin(name: string): Promise<boolean> {
    console.log(`[PluginManager] 重启插件: ${name}`);
    await this.stopPlugin(name);
    return this.startPlugin(name);
  }

  // ── 启动所有插件 ──────────────────────────────────────────────────────────

  async startAll(): Promise<void> {
    const plugins = this.configManager.getAutoStartPlugins();
    console.log(`[PluginManager] 启动 ${plugins.length} 个插件`);

    for (const plugin of plugins) {
      await this.startPlugin(plugin.name);
    }
  }

  // ── 停止所有插件 ──────────────────────────────────────────────────────────

  async stopAll(): Promise<void> {
    console.log(`[PluginManager] 停止所有插件`);

    for (const [name, instance] of this.plugins) {
      if (instance.status === 'running') {
        await this.stopPlugin(name);
      }
    }
  }

  // ── 处理插件崩溃 ──────────────────────────────────────────────────────────

  private async handlePluginCrash(name: string): Promise<void> {
    const instance = this.plugins.get(name);
    if (!instance) return;

    // 检查重启次数
    const restartCount = (instance as any).restartCount || 0;
    if (restartCount >= this.maxRestarts) {
      console.error(`[PluginManager] 插件 ${name} 重启次数过多，停止重启`);
      instance.status = 'error';
      instance.error = '重启次数过多';
      return;
    }

    // 延迟重启
    console.log(`[PluginManager] 插件 ${name} 将在 ${this.restartDelay}ms 后重启`);
    (instance as any).restartCount = restartCount + 1;

    setTimeout(async () => {
      console.log(`[PluginManager] 重启插件: ${name}`);
      await this.startPlugin(name);
    }, this.restartDelay);
  }

  // ── 获取插件状态 ──────────────────────────────────────────────────────────

  getPluginStatus(name: string): PluginInstance | undefined {
    return this.plugins.get(name);
  }

  // ── 获取所有插件状态 ──────────────────────────────────────────────────────

  listPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  // ── 获取配置管理器 ────────────────────────────────────────────────────────

  getConfigManager(): PluginConfigManager {
    return this.configManager;
  }

  // ── 检查插件健康状态 ──────────────────────────────────────────────────────

  async checkHealth(name: string): Promise<boolean> {
    const instance = this.plugins.get(name);
    if (!instance || instance.status !== 'running') {
      return false;
    }

    const config = instance.config;
    if (!config.healthCheck) {
      return true; // 没有健康检查，认为是健康的
    }

    try {
      const response = await fetch(config.healthCheck);
      return response.ok;
    } catch {
      return false;
    }
  }

  // ── 获取插件统计 ──────────────────────────────────────────────────────────

  getStats(): { total: number; running: number; stopped: number; error: number } {
    const plugins = this.listPlugins();
    return {
      total: plugins.length,
      running: plugins.filter(p => p.status === 'running').length,
      stopped: plugins.filter(p => p.status === 'stopped').length,
      error: plugins.filter(p => p.status === 'error').length,
    };
  }
}
