/**
 * Maou Agent HTTP Server — Express 实现
 * 对应 Python: core/server/core/server.py
 *
 * 31 个 API 端点，涵盖：
 *   - 核心运行（/api/run, sessions, health）
 *   - 配置管理（/api/config, /api/refresh）
 *   - Agent 管理（/api/agents, /api/agent-factory）
 *   - 插件管理（/api/plugins）
 *   - 文件代理（/api/files）
 *   - 桌面宠物 SSE（/api/pet/events）
 *   - 项目管理（/api/projects）
 *   - Git Watcher（/api/git-watcher）
 *   - 安全审批（/api/command/approve）
 *   - 前端日志（/api/log/frontend）
 */

import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs'
import { appendFileSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConfigStore } from '@little-house-studio/core'
import { ToolRegistry } from '@little-house-studio/tools'
import { registerBuiltins } from '@little-house-studio/tools'
import { TERMINAL_REGISTRY } from '@little-house-studio/tools'
import { SessionStore } from '@little-house-studio/context'
import { MemoryStore } from '@little-house-studio/context'
import { CheckpointStore } from '@little-house-studio/context'
import { Runtime } from './runtime.js'
import { LLMClient } from '@little-house-studio/llm'
import { decodeRawBody } from '@little-house-studio/llm'
import {
  isWithinPath,
  coerceBool,
  nowIso,
  isConnectionError,
  DEFAULT_PORT,
  MAX_BODY_SIZE,
  MAX_FILE_PROXY_SIZE,
  URL_PROXY_TIMEOUT_MS,
  DEFAULT_HOST,
  MAOU_VERSION,
} from '@little-house-studio/core'
import { detectExpression } from '@little-house-studio/core'
import { PLUGIN_METADATA } from '@little-house-studio/agent'
// import { PetEventBroadcaster, SSEClientManager } from '../plugins/pet/broadcaster.js'
// import { registerPetRoutes } from '../plugins/pet/routes.js'
import { getProjectsList, addProject, removeProject } from '@little-house-studio/core'
import { PluginManager } from './plugin-manager.js'

// ─── 临时占位类型（pet 插件重构中）──────────────────────────────────────

class PetEventBroadcaster {
  broadcast(_event: unknown) {}
  publish(_type: string, _data: unknown) {}
}
class SSEClientManager {
  addClient(_res: unknown) {}
  removeClient(_res: unknown) {}
}
function registerPetRoutes(_app: express.Application) {}

// ─── 常量 ────────────────────────────────────────────────────────────────────

const SERVER_START_TIME = Date.now()

// ─── MaouServer ──────────────────────────────────────────────────────────────

/**
 * Maou Agent 主服务器
 * 类比 Python: MaouApp + make_handler + serve
 */
export class MaouServer {
  private app: express.Application
  private configStore: ConfigStore
  private sessionStore: SessionStore
  private toolRegistry: ToolRegistry
  private runtime: Runtime
  private llmClient: LLMClient
  private broadcaster: PetEventBroadcaster
  private sseManager: SSEClientManager
  private pluginManager: PluginManager
  private pendingInterrupts: Set<string> = new Set()
  private activeRequests: Map<string, AbortController> = new Map() // sessionId → AbortController
  private serverStartTime: number = SERVER_START_TIME

  // 项目根目录和关键路径
  private projectRoot: string
  private maouRoot: string
  private sessionDir: string
  private userConfigPath: string

  constructor(options?: {
    projectRoot?: string
    userRoot?: string
  }) {
    const projectRoot = options?.projectRoot ?? process.cwd()
    this.projectRoot = projectRoot
    this.maouRoot = join(projectRoot, '.maou')
    this.sessionDir = join(projectRoot, '.maou', 'sessions')
    this.userConfigPath = options?.userRoot
      ? join(options.userRoot, 'config.json')
      : join(projectRoot, '.maou', 'config.json')

    // 初始化核心组件
    this.configStore = new ConfigStore(projectRoot, options?.userRoot)
    this.toolRegistry = new ToolRegistry()
    registerBuiltins(this.toolRegistry)

    // 初始化终端持久化
    TERMINAL_REGISTRY.setPersistPath(join(projectRoot, '.maou', 'terminals.json'))

    // 加载工具 schema
    // 从 core/tools 递归加载 schema.json
    const toolsDir = join(projectRoot, 'core', 'tools')
    if (existsSync(toolsDir)) {
      this.toolRegistry.setSchemasDir(toolsDir)
    }
    this.sessionStore = new SessionStore(this.sessionDir)
    this.purgeAllLegacyRawLogs()
    this.llmClient = new LLMClient()
    this.runtime = new Runtime({
      configStore: this.configStore,
      sessionStore: this.sessionStore,
      toolRegistry: this.toolRegistry,
      llmClient: this.llmClient,
      maouRoot: join(process.env.HOME ?? '', '.maou'),
      projectRoot: this.projectRoot,
    })
    this.broadcaster = new PetEventBroadcaster()
    this.sseManager = new SSEClientManager()
    this.pluginManager = new PluginManager(projectRoot)

    // Express 应用
    this.app = express()
    this.app.use(express.json({ limit: MAX_BODY_SIZE }))
    this.setupMiddleware()
    this.setupRoutes()
  }

  // ── 中间件 ────────────────────────────────────────────────────────────────

  private setupMiddleware(): void {
    // CORS
    this.app.use((_req: Request, res: Response, next: NextFunction) => {
      res.header('Access-Control-Allow-Origin', '*')
      res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      res.header('Access-Control-Allow-Headers', 'Content-Type')
      if (_req.method === 'OPTIONS') {
        res.sendStatus(204)
        return
      }
      next()
    })

    // 静态文件
    const webDir = join(this.projectRoot, 'maou-ui')
    if (existsSync(webDir)) {
      this.app.use(express.static(webDir))
    }
  }

  // ── 路由注册 ──────────────────────────────────────────────────────────────

  private setupRoutes(): void {
    this.setupHealthRoutes()
    this.setupSessionRoutes()
    this.setupRunRoutes()
    this.setupConfigRoutes()
    this.setupAgentRoutes()
    this.setupPluginRoutes()
    this.setupFileRoutes()
    registerPetRoutes(this.app)
    this.setupProjectRoutes()
    this.setupGitWatcherRoutes()
    this.setupCommandRoutes()
    this.setupLogRoutes()
  }

  /**
   * 透明解码 raw 条目中的压缩字段，返回可读的条目给前端。
   *
   * 处理已知压缩字段位置：
   * - llm.post 记录：request.body_full（CompressedBody）、response.payload_compressed
   * - llm_request 记录：data.body_compressed
   * - llm_response 记录：data.payload_compressed（解码后展开为 content + sse_events）
   *
   * 每条独立解码，无状态——即便同一会话调试时上下文被反复修改，
   * 每条 POST 记录仍能准确还原当时的请求/响应原貌。
   */
  private decodeRawEntry(entry: Record<string, unknown>): Record<string, unknown> {
    // llm.post 记录
    if (entry.event === 'llm.post') {
      const req = entry.request as Record<string, unknown> | undefined
      if (req?.body_full && typeof req.body_full === 'object') {
        const decoded = decodeRawBody(req.body_full as never)
        if (decoded !== null) req.body_full = decoded
      }
      const resp = entry.response as Record<string, unknown> | undefined
      if (resp?.payload_compressed && typeof resp.payload_compressed === 'object') {
        const decoded = decodeRawBody(resp.payload_compressed as never)
        if (decoded !== null) {
          try {
            const parsed = JSON.parse(decoded) as { raw_text?: string; events?: string[] }
            if (parsed.raw_text !== undefined) resp.raw_text = parsed.raw_text
            if (parsed.events !== undefined) resp.events = parsed.events
            delete resp.payload_compressed
          } catch { /* 解析失败保留压缩载体 */ }
        }
      }
      return entry
    }

    // type-based 记录
    const type = entry.type as string | undefined
    if (!type) return entry
    const data = entry.data as Record<string, unknown> | undefined
    if (!data) return entry

    if (type === 'llm_request') {
      if (data.body_compressed && typeof data.body_compressed === 'object') {
        const decoded = decodeRawBody(data.body_compressed as never)
        if (decoded !== null) {
          data.body = decoded
          delete data.body_compressed
        }
      }
    } else if (type === 'llm_response') {
      if (data.payload_compressed && typeof data.payload_compressed === 'object') {
        const decoded = decodeRawBody(data.payload_compressed as never)
        if (decoded !== null) {
          try {
            const parsed = JSON.parse(decoded) as { content?: string; sse_events?: string[] }
            if (parsed.content !== undefined) data.content = parsed.content
            if (parsed.sse_events !== undefined) data.sse_events = parsed.sse_events
            delete data.payload_compressed
          } catch { /* 解析失败保留压缩载体 */ }
        }
      }
    }
    return entry
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Health & Root
  // ═══════════════════════════════════════════════════════════════════════════

  private setupHealthRoutes(): void {
    // GET / — 首页
    this.app.get('/', (_req: Request, res: Response) => {
      const indexFile = join(this.projectRoot, 'maou-ui', 'index.html')
      if (existsSync(indexFile)) {
        res.type('html').send(readFileSync(indexFile, 'utf-8'))
      } else {
        res.json({ name: 'Maou Agent', version: MAOU_VERSION, status: 'running' })
      }
    })

    // GET /pet — 宠物页面
    this.app.get('/pet', (_req: Request, res: Response) => {
      const petFile = join(this.projectRoot, 'maou-ui', 'pet.html')
      if (existsSync(petFile)) {
        res.type('html').send(readFileSync(petFile, 'utf-8'))
      } else {
        res.status(404).send('Not Found')
      }
    })

    // GET /api/health — 健康检查
    this.app.get('/api/health', (_req: Request, res: Response) => {
      try {
        const sessionsList = this.sessionStore.list()
        res.json({
          ok: true,
          uptime: Math.floor((Date.now() - this.serverStartTime) / 1000),
          sessions_count: sessionsList.length,
          disk_usage_pct: 0, // Node.js 无原生磁盘使用 API，保留占位
          version: MAOU_VERSION,
          runtime: 'node',
        })
      } catch (err: unknown) {
        res.status(500).json({ ok: false, error: String(err) })
      }
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Session API
  // ═══════════════════════════════════════════════════════════════════════════

  private setupSessionRoutes(): void {
    // GET /api/sessions — 列出所有会话
    this.app.get('/api/sessions', (_req: Request, res: Response) => {
      res.json({ sessions: this.sessionStore.list() })
    })

    // POST /api/sessions — 创建新会话
    this.app.post('/api/sessions', (req: Request, res: Response) => {
      const data = req.body ?? {}
      const agentName = String(data.agent_name ?? '').trim() || undefined
      const sessionId = String(data.session_id ?? '').trim() || undefined
      const session = this.sessionStore.create({
        title: data.title,
        agentName,
        sessionId,
      })
      res.json({ session })
    })

    // GET /api/sessions/:id — 获取单个会话
    this.app.get('/api/sessions/:id', (req: Request, res: Response) => {
      const session = this.sessionStore.load(String(String(req.params.id)))
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      res.json({ session })
    })

    // DELETE /api/sessions/:id — 删除会话
    this.app.delete('/api/sessions/:id', (req: Request, res: Response) => {
      const deleted = this.sessionStore.delete(String(String(req.params.id)))
      if (deleted) {
        res.json({ success: true })
      } else {
        res.status(404).json({ error: 'Session not found' })
      }
    })

    // GET /api/sessions/:id/rawdata — 获取会话原始数据
    // 透明解码：前端拿到的永远是可读文本，零感知压缩存在
    this.app.get('/api/sessions/:id/rawdata', (req: Request, res: Response) => {
      const session = this.sessionStore.load(String(String(req.params.id)))
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      const entries = this.sessionStore.getRawData(String(String(req.params.id)))
        .map((e: Record<string, unknown>) => this.decodeRawEntry(e))
      res.json({ entries })
    })

    // GET /api/sessions/:id/rawdata/:round — 获取指定轮次原始数据
    this.app.get('/api/sessions/:id/rawdata/:round', (req: Request, res: Response) => {
      const session = this.sessionStore.load(String(String(req.params.id)))
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      const roundIdx = parseInt(String(req.params.round), 10)
      if (isNaN(roundIdx)) {
        res.status(400).json({ error: 'Invalid round number' })
        return
      }
      const rawData = this.sessionStore.getRawData(String(String(req.params.id)))
      const roundEntries = rawData
        .filter((r: Record<string, unknown>) => r.round === roundIdx)
        .map((e: Record<string, unknown>) => this.decodeRawEntry(e))
      if (roundEntries.length > 0) {
        res.json({ round: roundIdx, entries: roundEntries })
      } else {
        res.status(404).json({ error: 'Round not found' })
      }
    })

    // GET /api/sessions/:id/usage — 获取会话 token 用量
    this.app.get('/api/sessions/:id/usage', (req: Request, res: Response) => {
      const session = this.sessionStore.load(String(String(req.params.id)))
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      const trace = this.sessionStore.getTrace(String(String(req.params.id)))
      let lastUsage: Record<string, unknown> = {}
      let lastModelName = ''

      for (let i = trace.length - 1; i >= 0; i--) {
        const item = trace[i] as Record<string, unknown>
        const tt = String(item.type ?? '')
        if (tt === 'model.usage' && Object.keys(lastUsage).length === 0) {
          const u = item.usage as Record<string, unknown> | undefined
          if (u && typeof u === 'object') {
            for (const [k, v] of Object.entries(u)) {
              if (typeof v === 'number') lastUsage[k] = v
            }
          }
        }
        if (tt === 'model.request' && !lastModelName) {
          const body = (item.request_body ?? item.payload ?? {}) as Record<string, unknown>
          lastModelName = String(body.model ?? '')
        }
      }

      const msgs = (session as unknown as Record<string, unknown>).messages as unknown[] ?? []
      if (Object.keys(lastUsage).length === 0) {
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i] as Record<string, unknown>
          const u = m.usage as Record<string, unknown> | undefined
          if (u && typeof u === 'object') {
            for (const [k, v] of Object.entries(u)) {
              if (typeof v === 'number') lastUsage[k] = v
            }
            break
          }
        }
      }

      res.json({
        usage: lastUsage,
        model: lastModelName,
        message_count: msgs.length,
      })
    })

    // GET /api/sessions/:id/post-logs — 获取标准化 POST 日志
    this.app.get('/api/sessions/:id/post-logs', (req: Request, res: Response) => {
      const sessionId = String(req.params.id)
      const session = this.sessionStore.load(sessionId)
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }

      const roundRaw = String(req.query.round ?? '').trim()
      const since = String(req.query.since ?? '').trim() || undefined
      const until = String(req.query.until ?? '').trim() || undefined
      const round = roundRaw ? Number(roundRaw) : undefined
      const format = String(req.query.format ?? 'json').trim().toLowerCase()

      const entries = this.sessionStore.loadPostLogs(sessionId, {
        round: Number.isFinite(round) ? round : undefined,
        since,
        until,
      })

      if (format === 'jsonl') {
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename="${sessionId}.post-logs.jsonl"`)
        for (const entry of entries) {
          res.write(JSON.stringify(entry) + '\n')
        }
        res.end()
        return
      }

      res.json({
        session_id: sessionId,
        total: entries.length,
        filters: { round: round ?? null, since: since ?? null, until: until ?? null },
        entries,
      })
    })

    // GET /api/sessions/:id/post-logs/latest — 获取最新一条 POST 日志
    this.app.get('/api/sessions/:id/post-logs/latest', (req: Request, res: Response) => {
      const sessionId = String(req.params.id)
      const session = this.sessionStore.load(sessionId)
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }

      const entry = this.sessionStore.getLatestPostLog(sessionId)
      if (!entry) {
        res.status(404).json({ error: 'No post log found' })
        return
      }

      res.json({ session_id: sessionId, entry })
    })

    // POST /api/sessions/:id/interrupt — 中断会话
    this.app.post('/api/sessions/:id/interrupt', (req: Request, res: Response) => {
      const sid = String(req.params.id)

      // 中断正在运行的请求（支持实时中断）
      const controller = this.activeRequests.get(sid)
      if (controller) {
        controller.abort()
        this.activeRequests.delete(sid)
      }

      this.pendingInterrupts.add(sid)
      res.json({ ok: true, session_id: sid, interrupted: true })
    })

    // POST /api/sessions/:id/compress — 压缩会话历史
    this.app.post('/api/sessions/:id/compress', (req: Request, res: Response) => {
      const session = this.sessionStore.load(String(String(req.params.id)))
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      const s = session as unknown as Record<string, unknown>
      const messages = (s.messages ?? []) as Record<string, unknown>[]
      // 简单压缩：保留最近 8 条，之前的合并为一条摘要
      if (messages.length > 8) {
        const keep = messages.slice(-8)
        const summary = {
          role: 'user',
          content: `系统已压缩之前的 ${messages.length - 8} 条消息。`,
          created_at: nowIso(),
        }
        s.messages = [summary, ...keep]
        this.sessionStore.save(s as unknown as import('@little-house-studio/context').SessionData)
        res.json({ ok: true, compressed: messages.length - 8 })
      } else {
        res.json({ ok: true, compressed: 0 })
      }
    })

    // ═══════════════════════════════════════════════════════════════════════════
    //  Session Management API (多会话切换)
    // ═══════════════════════════════════════════════════════════════════════════

    // POST /api/sessions/fork — Fork 会话
    this.app.post('/api/sessions/fork', (req: Request, res: Response) => {
      const { source_session_id, new_title } = req.body ?? {}
      if (!source_session_id) {
        res.status(400).json({ error: 'source_session_id required' })
        return
      }
      try {
        const newSession = this.sessionStore.forkSession(String(source_session_id), new_title)
        res.json({ session: newSession })
      } catch (e) {
        res.status(404).json({ error: String(e) })
      }
    })

    // POST /api/sessions/:id/messages/:idx/pin — Pin 消息
    this.app.post('/api/sessions/:id/messages/:idx/pin', (req: Request, res: Response) => {
      const sessionId = String(req.params.id)
      const idx = parseInt(String(req.params.idx), 10)
      if (isNaN(idx)) {
        res.status(400).json({ error: 'Invalid message index' })
        return
      }
      const ok = this.sessionStore.pinMessage(sessionId, idx)
      res.json({ ok })
    })

    // POST /api/sessions/:id/messages/:idx/unpin — Unpin 消息
    this.app.post('/api/sessions/:id/messages/:idx/unpin', (req: Request, res: Response) => {
      const sessionId = String(req.params.id)
      const idx = parseInt(String(req.params.idx), 10)
      if (isNaN(idx)) {
        res.status(400).json({ error: 'Invalid message index' })
        return
      }
      const ok = this.sessionStore.unpinMessage(sessionId, idx)
      res.json({ ok })
    })

    // PUT /api/sessions/:id/messages/:idx/priority — 设置消息优先级
    this.app.put('/api/sessions/:id/messages/:idx/priority', (req: Request, res: Response) => {
      const sessionId = String(req.params.id)
      const idx = parseInt(String(req.params.idx), 10)
      const { priority } = req.body ?? {}
      if (isNaN(idx)) {
        res.status(400).json({ error: 'Invalid message index' })
        return
      }
      if (!['critical', 'important', 'normal'].includes(priority)) {
        res.status(400).json({ error: 'Invalid priority. Must be critical, important, or normal' })
        return
      }
      const ok = this.sessionStore.setPriority(sessionId, idx, priority)
      res.json({ ok })
    })

    // ═══════════════════════════════════════════════════════════════════════════
    //  Checkpoint API (会话快照)
    // ═══════════════════════════════════════════════════════════════════════════

    // GET /api/sessions/:id/checkpoints — 列出快照
    this.app.get('/api/sessions/:id/checkpoints', (req: Request, res: Response) => {
      const sessionId = String(req.params.id)
      // CheckpointStore imported at top
      const cpStore = new CheckpointStore(this.sessionStore)
      const checkpoints = cpStore.listCheckpoints(sessionId)
      res.json({ checkpoints })
    })

    // POST /api/sessions/:id/checkpoints — 创建快照
    this.app.post('/api/sessions/:id/checkpoints', (req: Request, res: Response) => {
      const sessionId = String(req.params.id)
      const { label } = req.body ?? {}
      // CheckpointStore imported at top
      const cpStore = new CheckpointStore(this.sessionStore)
      try {
        const cp = cpStore.createCheckpoint(sessionId, label, false)
        res.json({ checkpoint: cp })
      } catch (e) {
        res.status(404).json({ error: String(e) })
      }
    })

    // POST /api/sessions/:id/checkpoints/:cpId/rollback — 回滚到快照
    this.app.post('/api/sessions/:id/checkpoints/:cpId/rollback', (req: Request, res: Response) => {
      const sessionId = String(req.params.id)
      const cpId = String(req.params.cpId)
      // CheckpointStore imported at top
      const cpStore = new CheckpointStore(this.sessionStore)
      try {
        const session = cpStore.rollbackToCheckpoint(sessionId, cpId)
        res.json({ session })
      } catch (e) {
        res.status(404).json({ error: String(e) })
      }
    })

    // GET /api/sessions/:id/checkpoints/:cpId/diff-current — 快照与当前差异
    this.app.get('/api/sessions/:id/checkpoints/:cpId/diff-current', (req: Request, res: Response) => {
      const sessionId = String(req.params.id)
      const cpId = String(req.params.cpId)
      // CheckpointStore imported at top
      const cpStore = new CheckpointStore(this.sessionStore)
      try {
        const diff = cpStore.diffFromCheckpoint(sessionId, cpId)
        res.json({ diff })
      } catch (e) {
        res.status(404).json({ error: String(e) })
      }
    })

    // DELETE /api/sessions/:id/checkpoints/:cpId — 删除快照
    this.app.delete('/api/sessions/:id/checkpoints/:cpId', (req: Request, res: Response) => {
      const sessionId = String(req.params.id)
      const cpId = String(req.params.cpId)
      // CheckpointStore imported at top
      const cpStore = new CheckpointStore(this.sessionStore)
      const ok = cpStore.deleteCheckpoint(sessionId, cpId)
      res.json({ ok })
    })

    // ═══════════════════════════════════════════════════════════════════════════
    //  Memory API (结构化记忆)
    // ═══════════════════════════════════════════════════════════════════════════

    // GET /api/memories/:agent — 列出记忆
    this.app.get('/api/memories/:agent', (req: Request, res: Response) => {
      const agentName = String(req.params.agent)
      // MemoryStore imported at top
      const memStore = new MemoryStore(this.maouRoot, agentName)
      const memories = memStore.list()
      res.json({ memories })
    })

    // GET /api/memories/:agent/recall — 召回记忆
    this.app.get('/api/memories/:agent/recall', (req: Request, res: Response) => {
      const agentName = String(req.params.agent)
      const query = String(req.query.q ?? '')
      const limit = parseInt(String(req.query.limit ?? '10'), 10)
      // MemoryStore imported at top
      const memStore = new MemoryStore(this.maouRoot, agentName)
      const result = memStore.recall(query, limit)
      res.json(result)
    })

    // POST /api/memories/:agent — 创建记忆
    this.app.post('/api/memories/:agent', (req: Request, res: Response) => {
      const agentName = String(req.params.agent)
      const { key, value, category, tags, source_session_id } = req.body ?? {}
      if (!key || !value) {
        res.status(400).json({ error: 'key and value required' })
        return
      }
      // MemoryStore imported at top
      const memStore = new MemoryStore(this.maouRoot, agentName)
      const entry = memStore.store({
        key,
        value,
        category: category ?? 'note',
        tags: tags ?? [],
        sourceSessionId: source_session_id ?? '',
      })
      res.json({ memory: entry })
    })

    // DELETE /api/memories/:agent/:id — 删除记忆
    this.app.delete('/api/memories/:agent/:id', (req: Request, res: Response) => {
      const agentName = String(req.params.agent)
      const id = String(req.params.id)
      // MemoryStore imported at top
      const memStore = new MemoryStore(this.maouRoot, agentName)
      const ok = memStore.delete(id)
      res.json({ ok })
    })

    // POST /api/memories/:agent/compact — 压缩记忆
    this.app.post('/api/memories/:agent/compact', (req: Request, res: Response) => {
      const agentName = String(req.params.agent)
      // MemoryStore imported at top
      const memStore = new MemoryStore(this.maouRoot, agentName)
      const result = memStore.compact()
      res.json(result)
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Run API (核心)
  // ═══════════════════════════════════════════════════════════════════════════

  private setupRunRoutes(): void {
    // POST /api/run — 主运行端点（NDJSON 流式输出）
    this.app.post('/api/run', async (req: Request, res: Response) => {
      const data = req.body ?? {}

      const message = String(data.message ?? '').trim()
      if (!message) {
        console.log(`[API] /api/run 400: No message provided`)
        res.status(400).json({ error: 'No message provided' })
        return
      }

      // 解析图片数据 (base64 数组)
      const imagesRaw = data.images ?? []
      const images: { data: string; mime_type: string }[] = []
      if (Array.isArray(imagesRaw)) {
        for (const img of imagesRaw) {
          if (img && typeof img === 'object' && img.data) {
            images.push({
              data: String(img.data),
              mime_type: String(img.mime_type ?? 'image/png'),
            })
          }
        }
      }

      const config = this.configStore.get()
      const presets = config.api.presets ?? []
      // 支持 role 参数：default / vision / fast 等。
      // role 通过 config.api.rolePresets 映射到 presets 数组下标；
      // 未配置的 role 回退到 api.defaultPreset，再兜底 presets[0]。
      const role = String(data.role ?? 'default').trim()
      const roleIdx = typeof config.api.rolePresets?.[role] === 'number'
        ? config.api.rolePresets[role]
        : config.api.defaultPreset
      const preset = presets[roleIdx] ?? presets[0] ?? {}
      if (!preset || !preset.name) {
        console.log(`[API] /api/run 400: No presets configured (role=${role}, presets.length=${presets.length})`)
        res.status(400).json({ error: 'No presets configured' })
        return
      }

      const autoFormat = coerceBool(data.auto_format, true)
      const agentMode = coerceBool(data.agent_mode, true)
      const stream = coerceBool(
        data.stream,
        coerceBool((preset as unknown as Record<string, unknown>).stream, true),
      )
      const sandboxMode = String(data.sandbox_mode ?? '').trim() || 'normal'
      const initAgentName = String(data.init_agent_name ?? '').trim() || undefined

      // 处理中断注入
      const sessionId = String(data.session_id ?? '').trim()
      if (sessionId) {
        const injected = this.injectInterruptResults(sessionId)
        if (!injected) {
          this.pendingInterrupts.delete(sessionId)
        } else if (this.pendingInterrupts.has(sessionId)) {
          this.pendingInterrupts.delete(sessionId)
        }
      }

      // 设置 NDJSON 响应头
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.flushHeaders()

      const connId = Math.random().toString(36).slice(2, 10)
      let eventCount = 0

      // 创建中断控制器
      const abortCtrl = new AbortController()
      if (sessionId) {
        // ── per-session 互斥：同 session 同时只允许一个 run ──
        // 新请求到达时中止旧的 run（"最新意图优先"），避免并发跑同一会话导致：
        //   1. 上下文污染（多个 user 消息混进同一个 session）
        //   2. 资源争用（多个 LLM 调用抢网络/CPU，整体变慢）
        //   3. 飞书链路时间被"排队等待"虚高
        const prev = this.activeRequests.get(sessionId)
        if (prev && !prev.signal.aborted) {
          console.log(`[API] /api/run session=${sessionId} 抢占旧 run（最新意图优先）`)
          try { prev.abort(new Error('superseded by newer request')) } catch { /* ignore */ }
        }
        // 防御：若客户端已断连，则不启动
        if (res.writableEnded || res.closed) {
          return
        }
        this.activeRequests.set(sessionId, abortCtrl)
      }

      // 客户端断开连接时中止整个运行链路，避免后台空跑浪费 token
      // 注意：Node.js >= 18 中 req 在请求体读取完后就 close，不能监听 req.close
      // 只监听 res.close（响应流中断 = 客户端真正断连）
      const onClose = () => {
        if (!abortCtrl.signal.aborted) {
          abortCtrl.abort()
        }
      }
      res.on('close', onClose)

      try {
        for await (const event of this.runtime.run({
          sessionId: data.session_id,
          userMessage: message,
          preset: preset as unknown as Record<string, unknown>,
          autoFormat,
          agentMode,
          sandboxMode,
          stream,
          initAgentName,
          images: images.length > 0 ? images : undefined,
          userPostData: data,
          userName: String(data.user_name ?? data.name ?? "user").trim() || "user",
          abortSignal: abortCtrl.signal,
          platformContext: typeof data.platform_context === 'string' ? data.platform_context : undefined,
          source: typeof data.source === 'string' && data.source.trim() ? data.source.trim() : 'api',
          traceId: typeof data.trace_id === 'string' && data.trace_id.trim() ? data.trace_id.trim() : randomUUID(),
        })) {
          const etype = String(event.type ?? '?')

          // 桌面宠物事件广播
          try {
            if (etype === 'assistant') {
              const content = String(event.content ?? '')
              if (content) {
                this.broadcaster.publish('expression', detectExpression(content))
                this.broadcaster.publish('response', { text: content.slice(0, 500) })
              }
            } else if (etype === 'tool_call') {
              const rawTool = event.tool ?? event.tool_name ?? ''
              const toolName = typeof rawTool === 'object' && rawTool !== null
                ? String((rawTool as Record<string, unknown>).name ?? '')
                : String(rawTool)
              this.broadcaster.publish('tool_call', { tool: toolName })
            } else if (etype === 'tool_result') {
              const rawTool = event.tool ?? event.tool_name ?? ''
              const toolName = typeof rawTool === 'object' && rawTool !== null
                ? String((rawTool as Record<string, unknown>).name ?? '')
                : String(rawTool)
              this.broadcaster.publish('tool_result', { tool: toolName, ok: event.ok ?? true })
            }
          } catch {
            // 不让宠物广播中断主流
          }

          const line = JSON.stringify(event) + '\n'
          res.write(line)
          eventCount++
        }
      } catch (err: unknown) {
        // 判断是否 abort（客户端断连 或 被新请求抢占）
        const isAbort =
          abortCtrl.signal.aborted ||
          (err instanceof Error && err.name === 'AbortError') ||
          (err instanceof DOMException && err.name === 'AbortError')

        if (isConnectionError(err) || isAbort) {
          const reason = isAbort ? 'aborted' : 'disconnected'
          console.warn(`[CONN:${connId}] ${reason}`)
        } else {
          console.error(`[CONN:${connId}] UNCAUGHT:`, err)
          try {
            const errLine = JSON.stringify({ type: 'error', message: String(err) }) + '\n'
            res.write(errLine)
          } catch { /* 忽略写入错误 */ }
          // 兜底 done 事件（字段名与正常流程统一：sessionId）
          try {
            const doneLine = JSON.stringify({ type: 'done', sessionId: sessionId ?? null, rounds: 0 }) + '\n'
            res.write(doneLine)
          } catch { /* 忽略写入错误 */ }
        }
      } finally {
        // 清理断连监听 + 活跃请求记录
        res.off('close', onClose)
        if (sessionId) {
          // 防御：仅当 map 中仍是自己的 abortCtrl 时才清理，
          // 避免新请求抢占后，旧请求的 finally 把新请求的 abortCtrl 也清掉
          if (this.activeRequests.get(sessionId) === abortCtrl) {
            this.activeRequests.delete(sessionId)
          }
        }
        res.end()
      }
    })

    // POST /api/run/insert — 插入消息到会话
    this.app.post('/api/run/insert', (req: Request, res: Response) => {
      const data = req.body ?? {}
      const sessionId = String(data.session_id ?? '').trim()
      const message = String(data.message ?? '').trim()
      if (!sessionId || !message) {
        res.status(400).json({ error: 'Missing session_id or message' })
        return
      }
      const session = this.sessionStore.load(sessionId)
      if (!session) {
        res.status(404).json({ error: 'Session not found' })
        return
      }
      this.sessionStore.appendMessage(sessionId, 'user', message)
      this.sessionStore.setLastRawResponse(sessionId, '')
      res.json({ ok: true, session_id: sessionId })
    })

    // POST /api/hook — Hook 注入
    this.app.post('/api/hook', (req: Request, res: Response) => {
      const data = req.body ?? {}
      const sessionId = String(data.session_id ?? '').trim()
      if (!sessionId) {
        res.status(400).json({ ok: false, error: 'session_id 是必填字段' })
        return
      }
      this.sessionStore.injectHook({
        sessionId,
        message: data.message,
        source: String(data.source ?? 'hook').trim(),
        metadata: typeof data.metadata === 'object' ? data.metadata : undefined,
      })
      const result = { ok: true }
      if (result.ok) {
        res.json(result)
      } else {
        res.status(404).json(result)
      }
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Config API
  // ═══════════════════════════════════════════════════════════════════════════

  private setupConfigRoutes(): void {
    // GET /api/config — 获取全部配置
    this.app.get('/api/config', (_req: Request, res: Response) => {
      res.json({
        user: this.configStore.getUserRaw(),
        project: this.configStore.getProjectRaw(),
      })
    })

    // GET /api/config/user — 获取用户配置
    this.app.get('/api/config/user', (_req: Request, res: Response) => {
      res.json(this.configStore.getUserRaw())
    })

    // GET /api/config/project — 获取项目配置
    this.app.get('/api/config/project', (_req: Request, res: Response) => {
      res.json(this.configStore.getProjectRaw())
    })

    // POST /api/config/user — 保存用户配置
    this.app.post('/api/config/user', (req: Request, res: Response) => {
      try {
        this.configStore.saveUserConfig(req.body)
        res.json({ ok: true })
      } catch (err: unknown) {
        res.status(400).json({ ok: false, error: String(err) })
      }
    })

    // POST /api/config/project — 保存项目配置
    this.app.post('/api/config/project', (req: Request, res: Response) => {
      try {
        this.configStore.saveProjectConfig(req.body)
        res.json({ ok: true })
      } catch (err: unknown) {
        res.status(400).json({ ok: false, error: String(err) })
      }
    })

    // POST /api/refresh — 刷新编译和缓存
    this.app.post('/api/refresh', (_req: Request, res: Response) => {
      const result: Record<string, unknown> = this.runtime.refresh()
      res.json(result)
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Agent API
  // ═══════════════════════════════════════════════════════════════════════════

  private setupAgentRoutes(): void {
    // GET /api/agents/list — 列出所有 agent
    this.app.get('/api/agents/list', async (_req: Request, res: Response) => {
      const agents = await this.runtime.listAgents()
      res.json({ agents })
    })

    // POST /api/agents/init — 初始化新 agent
    this.app.post('/api/agents/init', async (req: Request, res: Response) => {
      const data = req.body ?? {}
      const name = String(data.name ?? '').trim()
      if (!name) {
        res.status(400).json({ error: 'name required' })
        return
      }
      const result = await this.runtime.initAgent(name)
      res.json(result)
    })

    // GET /api/agent-factory/presets — Agent 工厂预设列表
    this.app.get('/api/agent-factory/presets', async (_req: Request, res: Response) => {
      const result = await this.runtime.getAgentFactoryPresets()
      res.json(result)
    })

    // POST /api/agent-factory/preview — 预览 agent 配置
    this.app.post('/api/agent-factory/preview', (req: Request, res: Response) => {
      const data = req.body ?? {}
      const preview = this.runtime.previewAgent(data)
      res.json({ preview })
    })

    // POST /api/agent-factory/create — 创建 agent
    this.app.post('/api/agent-factory/create', (req: Request, res: Response) => {
      const data = req.body ?? {}
      const name = String(data.name ?? '').trim()
      const role = String(data.role ?? '').trim()
      if (!name || !role) {
        res.status(400).json({ error: 'name and role required' })
        return
      }
      const result = this.runtime.createAgent(data)
      res.json(result)
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Plugin API
  // ═══════════════════════════════════════════════════════════════════════════

  private setupPluginRoutes(): void {
    // GET /api/plugins — 获取插件列表（包括插件管理器管理的插件）
    this.app.get('/api/plugins', (_req: Request, res: Response) => {
      const userConfig = this.configStore.get() as unknown as Record<string, unknown>
      const pluginSettings = (userConfig.plugin_settings ?? {}) as Record<string, unknown>
      const defaults = this.configStore.getDefaultPluginSettings()
      const features = { ...defaults.plugins } as Record<string, Record<string, unknown>>

      // 应用用户覆盖
      const userPlugins = (pluginSettings.plugins ?? {}) as Record<string, Record<string, unknown>>
      for (const [pid, pdata] of Object.entries(userPlugins)) {
        if (pid in features && typeof pdata === 'object' && pdata !== null) {
          features[pid] = { ...features[pid], ...pdata }
        }
      }

      // 内置功能列表
      const builtinResult = PLUGIN_METADATA.map(meta => {
        const state = features[meta.id] ?? { enabled: true }
        return { ...meta, enabled: Boolean(state.enabled ?? true) }
      })

      // 外部插件列表
      const externalResult = this.scanPluginsDirectory()

      // 插件管理器管理的插件
      const managedPlugins = this.pluginManager.listPlugins().map(p => ({
        name: p.name,
        status: p.status,
        pid: p.pid,
        startedAt: p.startedAt,
        error: p.error,
        config: p.config,
      }))

      res.json({
        plugins: builtinResult,
        external_plugins: externalResult,
        managed_plugins: managedPlugins,
        settings: typeof pluginSettings === 'object' ? pluginSettings : {},
      })
    })

    // POST /api/plugins/toggle — 切换插件状态
    this.app.post('/api/plugins/toggle', (req: Request, res: Response) => {
      const data = req.body ?? {}
      const pluginId = String(data.id ?? '').trim()
      const enabled = Boolean(data.enabled ?? true)
      if (!pluginId) {
        res.status(400).json({ ok: false, error: 'Missing plugin id' })
        return
      }

      this.configStore.togglePlugin(pluginId, enabled)

      // 桌面宠物即时生效
      if (pluginId === 'desktop_pet') {
        this.runtime.togglePet(enabled)
      }

      res.json({ ok: true, plugin_id: pluginId, enabled })
    })

    // POST /api/plugins/settings — 保存插件设置
    this.app.post('/api/plugins/settings', (req: Request, res: Response) => {
      const data = req.body
      if (!data || typeof data !== 'object') {
        res.status(400).json({ ok: false, error: 'Invalid body' })
        return
      }
      this.configStore.savePluginSettings(data)
      res.json({ ok: true })
    })

    // ── 插件管理器 API ──────────────────────────────────────────────────────

    // GET /api/plugins/managed — 获取插件管理器管理的插件列表
    this.app.get('/api/plugins/managed', (_req: Request, res: Response) => {
      const plugins = this.pluginManager.listPlugins();
      const stats = this.pluginManager.getStats();
      res.json({ plugins, stats });
    })

    // POST /api/plugins/managed/:name/start — 启动插件
    this.app.post('/api/plugins/managed/:name/start', async (req: Request, res: Response) => {
      const name = String(req.params.name);
      try {
        const success = await this.pluginManager.startPlugin(name);
        res.json({ ok: success, message: success ? '插件已启动' : '插件启动失败' });
      } catch (err: any) {
        res.status(500).json({ ok: false, error: err.message });
      }
    })

    // POST /api/plugins/managed/:name/stop — 停止插件
    this.app.post('/api/plugins/managed/:name/stop', async (req: Request, res: Response) => {
      const name = String(req.params.name);
      try {
        const success = await this.pluginManager.stopPlugin(name);
        res.json({ ok: success, message: success ? '插件已停止' : '插件停止失败' });
      } catch (err: any) {
        res.status(500).json({ ok: false, error: err.message });
      }
    })

    // POST /api/plugins/managed/:name/restart — 重启插件
    this.app.post('/api/plugins/managed/:name/restart', async (req: Request, res: Response) => {
      const name = String(req.params.name);
      try {
        const success = await this.pluginManager.restartPlugin(name);
        res.json({ ok: success, message: success ? '插件已重启' : '插件重启失败' });
      } catch (err: any) {
        res.status(500).json({ ok: false, error: err.message });
      }
    })

    // GET /api/plugins/managed/:name/status — 获取插件状态
    this.app.get('/api/plugins/managed/:name/status', async (req: Request, res: Response) => {
      const name = String(req.params.name);
      const plugin = this.pluginManager.getPluginStatus(name);
      if (!plugin) {
        res.status(404).json({ ok: false, error: '插件不存在' });
        return;
      }
      const healthy = await this.pluginManager.checkHealth(name);
      res.json({ ok: true, plugin, healthy });
    })

    // POST /api/plugins/managed/discover — 重新发现插件
    this.app.post('/api/plugins/managed/discover', async (_req: Request, res: Response) => {
      try {
        const discovered = await this.pluginManager.discoverPlugins();
        res.json({ ok: true, discovered, count: discovered.length });
      } catch (err: any) {
        res.status(500).json({ ok: false, error: err.message });
      }
    })

    // POST /api/plugins/managed/start-all — 启动所有插件
    this.app.post('/api/plugins/managed/start-all', async (_req: Request, res: Response) => {
      try {
        await this.pluginManager.startAll();
        const stats = this.pluginManager.getStats();
        res.json({ ok: true, message: '所有插件已启动', stats });
      } catch (err: any) {
        res.status(500).json({ ok: false, error: err.message });
      }
    })

    // POST /api/plugins/managed/stop-all — 停止所有插件
    this.app.post('/api/plugins/managed/stop-all', async (_req: Request, res: Response) => {
      try {
        await this.pluginManager.stopAll();
        const stats = this.pluginManager.getStats();
        res.json({ ok: true, message: '所有插件已停止', stats });
      } catch (err: any) {
        res.status(500).json({ ok: false, error: err.message });
      }
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  File API
  // ═══════════════════════════════════════════════════════════════════════════

  private setupFileRoutes(): void {
    // GET /api/files — 文件代理（读取本地文件）
    this.app.get('/api/files', (req: Request, res: Response) => {
      const filePath = String(String(req.query.path ?? '') ?? '').trim()
      if (!filePath) {
        res.status(400).json({ error: "Missing 'path' parameter" })
        return
      }

      const resolved = pathResolve(filePath)
      const home = process.env.HOME ?? ''
      const projectRoot = pathResolve(this.projectRoot)

      // 安全限制
      if (!isWithinPath(home, resolved) && !isWithinPath(projectRoot, resolved)) {
        res.status(403).json({ error: 'Access denied' })
        return
      }

      // 禁止敏感文件
      const sensitive = new Set(['.env', '.env.local', 'credentials.json', 'secrets.json'])
      const basename = resolved.split('/').pop() ?? ''
      if (sensitive.has(basename)) {
        res.status(403).json({ error: 'Access denied: sensitive file' })
        return
      }

      if (!existsSync(resolved) || !statSync(resolved).isFile()) {
        res.status(404).json({ error: 'File not found' })
        return
      }

      const stat = statSync(resolved)
      if (stat.size > MAX_FILE_PROXY_SIZE) {
        res.status(413).json({ error: 'File too large (>100MB)' })
        return
      }

      const ext = resolved.split('.').pop()?.toLowerCase() ?? ''
      const mimeMap: Record<string, string> = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
        bmp: 'image/bmp', ico: 'image/x-icon',
        mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg',
        wav: 'audio/wav', ogg: 'audio/ogg',
        pdf: 'application/pdf',
        txt: 'text/plain', md: 'text/markdown', json: 'application/json',
        py: 'text/x-python', js: 'application/javascript', ts: 'application/typescript',
        html: 'text/html', css: 'text/css', csv: 'text/csv',
      }
      res.type(mimeMap[ext] ?? 'application/octet-stream').sendFile(resolved)
    })

    // GET /api/files/proxy — URL 代理
    this.app.get('/api/files/proxy', async (req: Request, res: Response) => {
      const url = String(String(req.query.url ?? '') ?? '').trim()
      if (!url) {
        res.status(400).json({ error: "Missing 'url' parameter" })
        return
      }
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        res.status(400).json({ error: 'Invalid URL' })
        return
      }

      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), URL_PROXY_TIMEOUT_MS)
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'MaouAgent/1.0' },
          signal: controller.signal,
        })
        clearTimeout(timeout)

        const ct = resp.headers.get('content-type') ?? 'application/octet-stream'
        const buffer = Buffer.from(await resp.arrayBuffer())
        if (buffer.length > MAX_FILE_PROXY_SIZE) {
          res.status(413).json({ error: 'Proxy response too large' })
          return
        }
        res.type(ct.split(';')[0].trim()).send(buffer)
      } catch (err: unknown) {
        res.status(502).json({ error: `Proxy fetch failed: ${err}` })
      }
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Project API
  // ═══════════════════════════════════════════════════════════════════════════

  private setupProjectRoutes(): void {
    // GET /api/projects — 项目列表
    this.app.get('/api/projects', (_req: Request, res: Response) => {
      const projects = getProjectsList()
      res.json({ projects })
    })

    // POST /api/projects — 添加项目
    this.app.post('/api/projects', (req: Request, res: Response) => {
      const data = req.body ?? {}
      const name = String(data.name ?? '').trim()
      if (!name) {
        res.status(400).json({ error: 'name required' })
        return
      }
      const result = addProject(name, data.path)
      if (result) {
        res.json(result)
      } else {
        res.status(409).json({ error: 'project already exists' })
      }
    })

    // DELETE /api/projects/:name — 删除项目
    this.app.delete('/api/projects/:name', (req: Request, res: Response) => {
      const removed = removeProject(String(req.params.name))
      if (removed) {
        res.json({ ok: true })
      } else {
        res.status(404).json({ error: 'not found' })
      }
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Git Watcher API
  // ═══════════════════════════════════════════════════════════════════════════

  private setupGitWatcherRoutes(): void {
    // GET /api/git-watcher/list — 差异列表
    this.app.get('/api/git-watcher/list', (req: Request, res: Response) => {
      const agent = String(String(req.query.agent ?? 'main') ?? 'main')
      const diffs = this.runtime.gitWatcher.listDiffs(agent)
      res.json({ diffs })
    })

    // GET /api/git-watcher/stashes — stash 列表
    this.app.get('/api/git-watcher/stashes', (req: Request, res: Response) => {
      const agent = String(String(req.query.agent ?? 'main') ?? 'main')
      const stashes = this.runtime.gitWatcher.listStashes(agent)
      res.json({ stashes })
    })

    // GET /api/git-watcher/diff/:seq — 获取指定序列号的 diff
    this.app.get('/api/git-watcher/diff/:seq', (req: Request, res: Response) => {
      const agent = String(String(req.query.agent ?? 'main') ?? 'main')
      const seq = parseInt(String(req.params.seq), 10)
      if (isNaN(seq)) {
        res.status(400).json({ error: 'Invalid seq' })
        return
      }
      const content = this.runtime.gitWatcher.getDiff(agent, seq)
      if (content !== null) {
        res.json({ seq, diff: content })
      } else {
        res.status(404).json({ error: 'not found' })
      }
    })

    // GET /api/git-watcher/status — Git 状态
    this.app.get('/api/git-watcher/status', (_req: Request, res: Response) => {
      const status = this.runtime.gitWatcher.getStatus()
      res.json(status)
    })

    // POST /api/git-watcher/rollback — 回滚
    this.app.post('/api/git-watcher/rollback', (req: Request, res: Response) => {
      const data = req.body ?? {}
      const agent = String(data.agent ?? 'main')
      const seq = data.seq
      if (!seq) {
        res.status(400).json({ error: 'seq required' })
        return
      }
      const result = this.runtime.gitWatcher.rollback(agent, Number(seq))
      res.json(result)
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Command API
  // ═══════════════════════════════════════════════════════════════════════════

  private setupCommandRoutes(): void {
    // POST /api/command/approve — 安全审批
    this.app.post('/api/command/approve', (req: Request, res: Response) => {
      const data = req.body ?? {}
      const requestId = String(data.request_id ?? '').trim()
      const approved = Boolean(data.approved ?? true)
      if (!requestId) {
        res.status(400).json({ error: 'Missing request_id' })
        return
      }
      const result = { ok: false, message: '暂无待审批命令' }
      res.json(result)
    })
  }

  private purgeAllLegacyRawLogs(): void {
    try {
      const files = readdirSync(this.sessionDir).filter((f) => f.endsWith('.meta.json'))
      for (const file of files) {
        try {
          const sessionId = file.replace('.meta.json', '')
          const result = this.sessionStore.purgeLegacyRawLogs(sessionId)
          if (result.purged > 0) {
            console.log(`[LLM] 已清理旧 POST 日志条目: session=${sessionId} purged=${result.purged}`)
          }
        } catch {
          // 单文件清理失败不影响整体启动
        }
      }
    } catch {
      // 扫描失败不阻塞服务启动
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  Log API
  // ═══════════════════════════════════════════════════════════════════════════

  private setupLogRoutes(): void {
    // POST /api/log/frontend — 前端日志
    this.app.post('/api/log/frontend', (req: Request, res: Response) => {
      try {
        const data = req.body ?? {}
        const level = String(data.level ?? 'info')
        const message = String(data.message ?? '')
        const detail = data.detail ? ` | ${data.detail}` : ''
        const text = `[FRONTEND][${level}] ${message}${detail}`
        console.log(text)
      } catch {
        console.warn('[FRONTEND] failed to parse log')
      }
      res.json({ ok: true })
    })
  }

  private injectInterruptResults(sessionId: string): boolean {
    const session = this.sessionStore.load(sessionId) as Record<string, unknown> | null
    if (!session) return false
    const msgs = (session.messages ?? []) as Record<string, unknown>[]
    if (msgs.length === 0) return false

    const last = msgs[msgs.length - 1]
    if (last.role !== 'assistant') return false

    const nativeToolCalls = (last.native_tool_calls ?? []) as Record<string, unknown>[]
    if (nativeToolCalls.length === 0) return false

    const pendingIds = new Set(nativeToolCalls.map(tc => String(tc.id ?? '')))
    for (let i = msgs.length - 2; i >= 0; i--) {
      const m = msgs[i]
      if (m.role === 'tool') {
        const tid = String((m.metadata as Record<string, unknown>)?.tool_call_id ?? '')
        pendingIds.delete(tid)
      }
    }
    if (pendingIds.size === 0) return false

    for (const tc of nativeToolCalls) {
      const callId = String(tc.id ?? '')
      if (!pendingIds.has(callId)) continue
      const toolName = String(tc.name ?? '?')
      this.sessionStore.appendMessage(sessionId, 'tool', `工具 ${toolName} 已被用户打断`, {
        tool_call_id: callId,
        tool_name: toolName,
        tool_call: { name: toolName, parameters: tc.parameters ?? {}, id: callId },
        interrupted: true,
      })
    }
    return true
  }

  /**
   * 扫描 plugins/ 目录，发现外部插件
   */
  private scanPluginsDirectory(): Record<string, unknown>[] {
    const pluginsDir = join(this.projectRoot, 'plugins')
    if (!existsSync(pluginsDir)) return []

    try {
      const items = readdirSync(pluginsDir, { withFileTypes: true })
      return items
        .filter((item: { isDirectory: () => boolean }) => item.isDirectory())
        .map((item: { name: string }) => ({
          id: item.name,
          name: item.name,
          description: `位于 plugins/${item.name}/ 的插件`,
          category: 'external',
          version: '—',
        }))
    } catch {
      return []
    }
  }

  // ── 服务器生命周期 ────────────────────────────────────────────────────────

  /**
   * 启动 HTTP 服务器
   */
  start(port: number = DEFAULT_PORT, host: string = DEFAULT_HOST): void {
    this.app.listen(port, host, () => {
      console.log(`Maou Agent running at http://${host}:${port}`)
      console.log(`Runtime: Node.js / Express`)
    })

    // 自动发现并启动插件
    this.pluginManager.discoverPlugins().then(() => {
      const stats = this.pluginManager.getStats()
      console.log(`[PluginManager] 发现 ${stats.total} 个插件`)
      return this.pluginManager.startAll()
    }).then(() => {
      const stats = this.pluginManager.getStats()
      console.log(`[PluginManager] 已启动 ${stats.running} 个插件`)
    }).catch((err) => {
      console.error('[PluginManager] 插件启动失败:', err)
    })

    const shutdown = () => {
      this.pluginManager.stopAll()
      TERMINAL_REGISTRY.shutdown()
      process.exit(0)
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    process.on('exit', () => { TERMINAL_REGISTRY.shutdown() })
  }
}

// ─── 默认导出 ────────────────────────────────────────────────────────────────

export default MaouServer

// ─── 启动入口 ────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new MaouServer()
  server.start()
}