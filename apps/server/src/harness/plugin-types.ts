/**
 * 插件系统类型定义
 *
 * 定义插件的接口、配置、状态等类型
 */

// ─── 插件状态 ────────────────────────────────────────────────────────────────

export type PluginStatus = 'installed' | 'running' | 'stopped' | 'error' | 'disabled';

// ─── 插件启动模式 ──────────────────────────────────────────────────────────

export type PluginMode = 'module' | 'subprocess';

// ─── 作者信息 ──────────────────────────────────────────────────────────────

export interface PluginAuthor {
  name: string;
  email?: string;
  url?: string;
}

// ─── 仓库信息 ──────────────────────────────────────────────────────────────

export interface PluginRepository {
  type?: 'git' | 'svn' | 'hg';
  url: string;
  directory?: string;
}

// ─── 兼容性声明 ────────────────────────────────────────────────────────────

export interface PluginCompatibility {
  /** maou-agent 版本范围，如 ">=0.3.0" */
  maouAgent?: string;
  /** Node.js 版本要求，如 ">=20.0.0" */
  node?: string;
  /** 支持的平台列表 */
  platforms?: ('darwin' | 'linux' | 'win32')[];
}

// ─── 外部依赖配置项 ──────────────────────────────────────────────────────

export interface PluginExternalDependency {
  /** 显示名称 */
  display: string;
  /** 类型：string/password/number/boolean */
  type: 'string' | 'password' | 'number' | 'boolean';
  /** 是否必填 */
  required?: boolean;
  /** 默认值 */
  default?: string | number | boolean;
  /** 环境变量名（可选，自动映射） */
  env?: string;
  /** 描述说明 */
  description?: string;
}

// ─── 插件配置 Schema ────────────────────────────────────────────────────────

export interface PluginConfigProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  display?: string;
  description?: string;
  default?: any;
  enum?: string[];
  required?: boolean;
  properties?: Record<string, PluginConfigProperty>;
}

// ─── 权限声明 ──────────────────────────────────────────────────────────────

export interface PluginNetworkPermission {
  /** 出站网络白名单，支持通配符 */
  outbound?: string[];
}

export interface PluginFsPermission {
  /** 可读路径模式 */
  read?: string[];
  /** 可写路径模式 */
  write?: string[];
}

export interface PluginPermissions {
  /** 工具白名单（精确名称） */
  tools?: string[];
  /** 工具白名单（通配符模式，如 "terminal/*"） */
  tools_patterns?: string[];
  /** 网络权限 */
  network?: PluginNetworkPermission;
  /** 文件系统权限 */
  fs?: PluginFsPermission;
}

// ─── 生命周期钩子 ──────────────────────────────────────────────────────

export interface PluginHooks {
  /** 插件加载时调用 */
  onLoad?: string;
  /** 插件启用时调用 */
  onEnable?: string;
  /** 插件禁用时调用 */
  onDisable?: string;
  /** 插件卸载时调用 */
  onUnload?: string;
  /** 配置变更时调用 */
  onConfigChange?: string;
}

// ─── 事件声明 ──────────────────────────────────────────────────────────────

export interface PluginEvents {
  /** 订阅的系统事件列表 */
  subscribes?: string[];
  /** 可发出的事件列表 */
  emits?: string[];
}

// ─── 提供的能力 ──────────────────────────────────────────────────────────────

export interface PluginProvides {
  /** 提供的工具目录路径 */
  tools?: string | boolean;
  /** 提供的技能目录路径 */
  skills?: string | boolean;
  /** 提供的提示词目录路径 */
  prompts?: string | boolean;
  /** 提供的适配器目录路径 */
  adapters?: string;
  /** 提供的 API 路由 */
  apiRoutes?: {
    prefix?: string;
    routes?: string;
  };
}

// ─── UI 扩展 ──────────────────────────────────────────────────────────────

export interface PluginMenuItem {
  id: string;
  display: string;
  icon?: string;
  path: string;
  order?: number;
}

export interface PluginUI {
  /** Web 界面入口 */
  web?: string;
  /** 设置面板组件 */
  settings?: string;
  /** 菜单项 */
  menuItems?: PluginMenuItem[];
}

// ─── 国际化 ──────────────────────────────────────────────────────────────

export interface PluginI18n {
  defaultLocale: string;
  locales: string[];
  path: string;
}

// ─── 状态监控 ──────────────────────────────────────────────────────────────

export interface PluginStatusConfig {
  /** 健康检查函数路径 */
  healthCheck?: string;
  /** 暴露的监控指标名称 */
  metrics?: string[];
}

// ─── 插件完整配置 ──────────────────────────────────────────────────────────

export interface PluginConfig {
  // ─── 基础信息（必选）──────────────────────────────────────
  /** 插件唯一标识符 */
  name: string;
  /** 用户可见的显示名称 */
  displayName?: string;
  /** 语义化版本号 */
  version: string;
  /** 功能简介 */
  description: string;

  // ─── 作者信息（可选）──────────────────────────────────────
  /** 作者（简写字符串或对象） */
  author?: string | PluginAuthor;
  /** 项目仓库 */
  repository?: string | PluginRepository;
  /** 文档主页 */
  homepage?: string;
  /** 问题反馈地址 */
  bugs?: string;
  /** 开源协议 */
  license?: string;
  /** 搜索关键词 */
  keywords?: string[];
  /** 插件分类：integration/display/data/security/automation 等 */
  category?: string;

  // ─── 资源文件（可选）──────────────────────────────────────
  /** 插件图标 */
  icon?: string;
  /** README 文件路径 */
  readme?: string;
  /** 变更日志路径 */
  changelog?: string;
  /** TypeScript 类型定义入口 */
  types?: string;

  // ─── 运行配置（必选）──────────────────────────────────────
  /** 启动模式: module=进程内模块, subprocess=子进程 */
  mode: PluginMode;
  /** 是否启用 */
  enabled: boolean;
  /** 是否自动启动 */
  autoStart: boolean;
  /** 启动优先级（数字越小越先启动） */
  priority: number;
  /** 入口文件路径（模块模式，默认 src/index.ts） */
  entry?: string;
  /** 子进程模式下的启动命令 */
  command?: string;
  /** 工作目录（相对于插件目录） */
  cwd?: string;

  // ─── 兼容性（可选）──────────────────────────────────────
  compatibility?: PluginCompatibility;

  // ─── 依赖声明（可选）──────────────────────────────────────
  /** 插件间依赖列表 */
  dependencies?: string[];
  /** npm 包依赖列表 */
  npmDependencies?: string[];
  /** 外部配置依赖（如 API 密钥等） */
  externalDependencies?: Record<string, PluginExternalDependency>;
  /** 环境变量映射（简写形式） */
  env?: Record<string, string>;

  // ─── 配置 Schema（可选）──────────────────────────────────────
  /** 运行时配置项定义 */
  configSchema?: {
    type: 'object';
    properties: Record<string, PluginConfigProperty>;
  };

  // ─── 权限声明（可选）──────────────────────────────────────
  permissions?: PluginPermissions;

  // ─── 生命周期钩子（可选）──────────────────────────────────────
  hooks?: PluginHooks;

  // ─── 事件声明（可选）──────────────────────────────────────
  events?: PluginEvents;

  // ─── 提供的能力（可选）──────────────────────────────────────
  provides?: PluginProvides;

  // ─── UI 扩展（可选）──────────────────────────────────────
  ui?: PluginUI;

  // ─── 国际化（可选）──────────────────────────────────────
  i18n?: PluginI18n;

  // ─── 状态监控（可选）──────────────────────────────────────
  status?: PluginStatusConfig;

  // ─── 兼容旧字段 ───────────────────────────────
  healthCheck?: string | null;
}

// ─── 插件实例 ────────────────────────────────────────────────────────────────

export interface PluginInstance {
  name: string;
  config: PluginConfig;
  status: PluginStatus;
  pid?: number;
  process?: any; // child_process.ChildProcess
  startedAt?: string;
  error?: string;
  path: string;
  /** 模块模式下插件导出的 API（含 stop 等） */
  moduleApi?: any;
}

// ─── 插件接口 ────────────────────────────────────────────────────────────────

export interface Plugin {
  name: string;
  version: string;
  description: string;

  // 生命周期
  onInstall?(): Promise<void>;
  onStart?(): Promise<void>;
  onStop?(): Promise<void>;
  onUninstall?(): Promise<void>;

  // 状态
  getStatus(): PluginStatus;
}

// ─── 插件管理器配置 ──────────────────────────────────────────────────────────

export interface PluginManagerConfig {
  pluginsDir: string;
  configPath: string;
  autoDiscover: boolean;
  autoStart: boolean;
  maxRestarts: number;
  restartDelay: number;
}

// ─── 插件事件 ────────────────────────────────────────────────────────────────

export interface PluginEvent {
  type: 'started' | 'stopped' | 'error' | 'restarted';
  plugin: string;
  timestamp: string;
  data?: any;
}

// ─── 插件 API 响应 ──────────────────────────────────────────────────────────

export interface PluginListResponse {
  plugins: PluginInstance[];
  total: number;
  running: number;
  stopped: number;
}

export interface PluginActionResponse {
  ok: boolean;
  message: string;
  plugin?: PluginInstance;
}
