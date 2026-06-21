/**
 * HubServer — 多设备通信 Hub HTTP 服务
 * 对齐 Python: core/server/hub/server.py
 *
 * 运行在独立端口 (默认 8098)，提供：
 *   POST /api/hub/send       — 发送消息到设备
 *   GET  /api/hub/events      — SSE 事件流
 *   GET  /api/hub/devices     — 列出设备
 *   POST /api/hub/register    — 注册设备
 */

import http from 'node:http'
import { hostname as osHostname, platform as osPlatform, networkInterfaces } from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { HubConfig, DeviceInfo, HubMessage, DeviceStatus, HubEvent } from './types.js'
import { DEFAULT_HUB_CONFIG, EventType } from './types.js'
import { EventBus } from './event-bus.js'
import { DeviceRegistry } from './device-registry.js'

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString()
}

function randomId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

function jsonResponse(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(body)
}

// ─── SSE 客户端管理 ──────────────────────────────────────────────────────────

interface SSEClient {
  id: string
  res: ServerResponse
  lastEventId: string
}

// ─── HubServer ───────────────────────────────────────────────────────────────

/** Hub 服务主类 */
export class HubServer {
  readonly config: HubConfig
  readonly eventBus: EventBus
  readonly registry: DeviceRegistry

  private _server: http.Server | null = null
  private _sseClients: Map<string, SSEClient> = new Map()
  private _sseClientId = 0

  constructor(config?: Partial<HubConfig>) {
    this.config = { ...DEFAULT_HUB_CONFIG, ...config }
    this.eventBus = new EventBus()
    this.registry = new DeviceRegistry()

    // 注册内部事件处理
    this._setupEventHandlers()
  }

  /** 启动 Hub 服务 */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this._server) {
        resolve()
        return
      }

      this._server = http.createServer((req, res) => {
        this._handleRequest(req, res).catch((err) => {
          console.error('[HubServer] 请求处理异常:', err)
          if (!res.headersSent) {
            jsonResponse(res, 500, { error: '内部错误' })
          }
        })
      })

      const port = this.config.http_port
      this._server.listen(port, '0.0.0.0', () => {
        console.log(`[HubServer] 启动完成，监听 http://0.0.0.0:${port}`)
        // 注册本机
        this._registerLocalDevice()
        resolve()
      })

      this._server.on('error', (err) => {
        console.error('[HubServer] 服务启动失败:', err)
        reject(err)
      })
    })
  }

  /** 停止 Hub 服务 */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this._server) {
        resolve()
        return
      }

      // 关闭所有 SSE 连接
      for (const client of this._sseClients.values()) {
        client.res.end()
      }
      this._sseClients.clear()

      this._server.close(() => {
        this._server = null
        this.eventBus.clear()
        console.log('[HubServer] 已停止')
        resolve()
      })
    })
  }

  /** 服务是否运行中 */
  get isRunning(): boolean {
    return this._server !== null
  }

  /** 服务状态摘要 */
  get summary(): Record<string, unknown> {
    return {
      device_id: this.config.device_id,
      device_role: this.config.device_role,
      http_port: this.config.http_port,
      device_count: this.registry.count,
      online_devices: this.registry.list('online' as DeviceStatus).length,
      sse_clients: this._sseClients.size,
      running: this.isRunning,
    }
  }

  // ── 事件处理 ──

  private _setupEventHandlers(): void {
    // 监听消息事件，通过 SSE 推送给客户端
    this.eventBus.subscribe('*', (event: HubEvent) => {
      this._broadcastSSE(event)
    })
  }

  /** 广播 SSE 事件给所有连接的客户端 */
  private _broadcastSSE(event: HubEvent): void {
    const eventId = this.eventBus.eventHistory.lastId
    const data = JSON.stringify({
      id: eventId,
      type: event.type,
      data: event.data,
      source: event.source,
    })

    for (const client of this._sseClients.values()) {
      try {
        client.res.write(`id: ${eventId}\n`)
        client.res.write(`event: ${event.type}\n`)
        client.res.write(`data: ${data}\n\n`)
      } catch {
        // 客户端断开，稍后清理
      }
    }
  }

  // ── HTTP 请求路由 ──

  private async _handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const method = req.method?.toUpperCase() ?? 'GET'

    // CORS 预检
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      res.end()
      return
    }

    const path = url.pathname

    // POST /api/hub/register — 注册设备
    if (method === 'POST' && path === '/api/hub/register') {
      return this._handleRegister(req, res)
    }

    // POST /api/hub/send — 发送消息到设备
    if (method === 'POST' && path === '/api/hub/send') {
      return this._handleSend(req, res)
    }

    // GET /api/hub/events — SSE 事件流
    if (method === 'GET' && path === '/api/hub/events') {
      return this._handleSSE(req, res)
    }

    // GET /api/hub/devices — 列出设备
    if (method === 'GET' && path === '/api/hub/devices') {
      return this._handleListDevices(req, res)
    }

    // GET /api/hub/status — 服务状态
    if (method === 'GET' && path === '/api/hub/status') {
      jsonResponse(res, 200, this.summary)
      return
    }

    jsonResponse(res, 404, { error: '未找到路由' })
  }

  /** POST /api/hub/register — 注册设备 */
  private async _handleRegister(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req)
    let data: Record<string, unknown>
    try {
      data = JSON.parse(body)
    } catch {
      jsonResponse(res, 400, { error: '无效的 JSON' })
      return
    }

    const deviceId = String(data.device_id ?? '')
    if (!deviceId) {
      jsonResponse(res, 400, { error: '缺少 device_id' })
      return
    }

    const info: DeviceInfo = {
      device_id: deviceId,
      name: String(data.name ?? ''),
      hostname: String(data.hostname ?? ''),
      platform: String(data.platform ?? ''),
      ip: String(data.ip ?? ''),
      port: Number(data.port ?? 0),
      ws_port: Number(data.ws_port ?? 0),
      status: 'online',
      last_seen: nowIso(),
      roles: Array.isArray(data.roles) ? (data.roles as string[]) : [],
      metadata: (data.metadata as Record<string, unknown>) ?? {},
    }

    this.registry.register(info)

    // 发布设备上线事件
    this.eventBus.publish({
      type: EventType.DEVICE_ONLINE,
      data: { device: info },
      source: 'hub',
    })

    jsonResponse(res, 200, { ok: true, device: info })
  }

  /** POST /api/hub/send — 发送消息到设备 */
  private async _handleSend(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req)
    let data: Record<string, unknown>
    try {
      data = JSON.parse(body)
    } catch {
      jsonResponse(res, 400, { error: '无效的 JSON' })
      return
    }

    const targetDevice = String(data.target_device ?? '')
    const targetAgent = String(data.target_agent ?? '')

    const message: HubMessage = {
      id: String(data.id ?? randomId()),
      source_device: String(data.source_device ?? this.config.device_id),
      target_device: targetDevice,
      target_agent: targetAgent,
      msg_type: (data.msg_type ?? 'event') as HubMessage['msg_type'],
      payload: (data.payload as Record<string, unknown>) ?? {},
      created_at: nowIso(),
      source: String(data.source ?? 'api'),
    }

    // 发布到事件总线
    this.eventBus.publish({
      type: EventType.MESSAGE_INCOMING,
      data: { message },
      source: 'hub',
    })

    // 如果指定了目标 Agent，发布更具体的事件
    if (targetAgent) {
      this.eventBus.publish({
        type: `${EventType.MESSAGE_TO_AGENT}.${targetAgent}`,
        data: { message },
        source: 'hub',
      })
    }

    jsonResponse(res, 200, { ok: true, message_id: message.id })
  }

  /** GET /api/hub/events — SSE 事件流 */
  private _handleSSE(_req: IncomingMessage, res: ServerResponse): void {
    const clientId = `sse-${++this._sseClientId}`

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    // 发送初始连接事件
    res.write(`event: connected\ndata: ${JSON.stringify({ client_id: clientId })}\n\n`)

    const client: SSEClient = { id: clientId, res, lastEventId: '' }
    this._sseClients.set(clientId, client)

    // 心跳保活
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n')
      } catch {
        clearInterval(heartbeat)
        this._sseClients.delete(clientId)
      }
    }, 15000)

    _req.on('close', () => {
      clearInterval(heartbeat)
      this._sseClients.delete(clientId)
    })
  }

  /** GET /api/hub/devices — 列出设备 */
  private _handleListDevices(_req: IncomingMessage, res: ServerResponse): void {
    const devices = this.registry.list()
    jsonResponse(res, 200, {
      devices: devices.map((d) => ({
        ...d,
      })),
      total: this.registry.count,
    })
  }

  // ── 本机注册 ──

  private _registerLocalDevice(): void {
    const hostname = osHostname()
    const platform = osPlatform()

    const info: DeviceInfo = {
      device_id: this.config.device_id || hostname,
      name: this.config.device_name || `${hostname} (${platform})`,
      hostname: hostname,
      platform: platform,
      ip: this._getLocalIp(),
      port: this.config.http_port,
      ws_port: this.config.ws_port,
      status: 'online',
      last_seen: nowIso(),
      roles: [this.config.device_role],
      metadata: {
        managed_agents: this.config.managed_agents,
      },
    }
    this.registry.register(info)
    console.log(`[HubServer] 本机已注册: ${info.device_id} (${info.name})`)
  }

  private _getLocalIp(): string {
    const interfaces = networkInterfaces()
    for (const nets of Object.values(interfaces) as unknown as Array<Array<{ address: string; family: string; internal: boolean; [k: string]: unknown }>>) {
      if (!nets) continue
      for (const net of nets) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address
        }
      }
    }
    return '127.0.0.1'
  }
}
