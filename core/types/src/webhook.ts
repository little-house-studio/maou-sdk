/**
 * Inbound webhook 协议 —— Agent 的无 UI 控制面。
 *
 * 请求 = AgentSendMessage + 系统控制。说话字段复用发送结构体，不是另起一套。
 * CLI / WebUI 只是宿主；脚本、传感器、其它语言只认这个结构。
 */
import type { AgentSendMessage, AgentSendMode } from './agent-message.js'

export const WEBHOOK_PROTOCOL_VERSION = 1 as const

export const WEBHOOK_ACTIONS = [
  'help',
  'status',
  'send',
  'abort',
  'enqueue',
  'agents.list',
  'sessions.list',
  'sessions.new',
  'sessions.switch',
  'sessions.clear',
  'sessions.delete',
  'sessions.rename',
  'sessions.messages',
  'sessions.stats',
  'sessions.export',
  'model.get',
  'model.set',
  'models.list',
  'approval.list',
  'approval.answer',
  'approval.mode',
  'queue.list',
  'queue.clear',
  'queue.remove',
  'command',
] as const

export type WebhookAction = (typeof WEBHOOK_ACTIONS)[number]

export type WebhookSendMode = 'now' | AgentSendMode

/**
 * 入站说话：就是 AgentSendMessage。纯字符串仍收成一条发送消息。
 */
export type WebhookAgentMessage = string | AgentSendMessage
export type WebhookApprovalChoice = 'once' | 'always' | 'deny' | 'blacklist'
export type WebhookApprovalMode = 'normal' | 'auto' | 'yolo'

/** 每条请求都带的寻址字段 */
export interface WebhookRequestBase {
  /** 协议版本，缺省 1 */
  v?: typeof WEBHOOK_PROTOCOL_VERSION
  /** 调用方相关 id，原样回传 */
  id?: string
  /** agent 短名或 switch_id（system:ops / project:<path>:coding） */
  agent?: string
  /** 会话 id；缺省用该 agent 当前/最近会话 */
  session?: string
}

export type WebhookRequest =
  | (WebhookRequestBase & { action: 'help' })
  | (WebhookRequestBase & { action: 'status' })
  | (WebhookRequestBase & {
      action: 'send'
      /** Agent 发送结构体（AgentSendMessage） */
      message: WebhookAgentMessage
      mode?: WebhookSendMode
      /** 等本轮跑完再返回（无 UI 脚本用） */
      wait?: boolean
      timeoutMs?: number
    })
  | (WebhookRequestBase & { action: 'abort' })
  | (WebhookRequestBase & {
      action: 'enqueue'
      message: WebhookAgentMessage
      mode?: 'queue' | 'insert'
    })
  | (WebhookRequestBase & { action: 'agents.list' })
  | (WebhookRequestBase & { action: 'sessions.list' })
  | (WebhookRequestBase & { action: 'sessions.new'; title?: string })
  | (WebhookRequestBase & { action: 'sessions.switch'; session: string })
  | (WebhookRequestBase & { action: 'sessions.clear'; session?: string })
  | (WebhookRequestBase & { action: 'sessions.delete'; session: string })
  | (WebhookRequestBase & {
      action: 'sessions.rename'
      session: string
      title: string
    })
  | (WebhookRequestBase & { action: 'sessions.messages'; session?: string })
  | (WebhookRequestBase & { action: 'sessions.stats'; session?: string })
  | (WebhookRequestBase & { action: 'sessions.export'; session?: string })
  | (WebhookRequestBase & { action: 'model.get' })
  | (WebhookRequestBase & {
      action: 'model.set'
      provider: string
      model: string
    })
  | (WebhookRequestBase & { action: 'models.list'; provider?: string })
  | (WebhookRequestBase & { action: 'approval.list' })
  | (WebhookRequestBase & {
      action: 'approval.answer'
      approvalId: string
      choice: WebhookApprovalChoice
    })
  | (WebhookRequestBase & {
      action: 'approval.mode'
      mode?: WebhookApprovalMode
    })
  | (WebhookRequestBase & { action: 'queue.list' })
  | (WebhookRequestBase & { action: 'queue.clear' })
  | (WebhookRequestBase & { action: 'queue.remove'; queueId: number })
  | (WebhookRequestBase & {
      action: 'command'
      command: string
      args?: Record<string, unknown>
    })

export interface WebhookResponse {
  ok: boolean
  v: typeof WEBHOOK_PROTOCOL_VERSION
  action: WebhookAction
  id?: string
  error?: string
  /** 建议 HTTP 状态；宿主可忽略 */
  status?: number
  [key: string]: unknown
}

export const WEBHOOK_HELP: readonly { action: WebhookAction; hint: string }[] = [
  { action: 'help', hint: '列出全部 action' },
  { action: 'status', hint: '某 agent 是否在跑、当前会话/模型' },
  { action: 'send', hint: '发一条用户消息；空闲叫醒，忙则入队。wait=true 等跑完' },
  { action: 'abort', hint: '中断当前 run 并清空排队' },
  { action: 'enqueue', hint: '运行中再塞一条（queue / insert）' },
  { action: 'agents.list', hint: '可投递的 agent' },
  { action: 'sessions.list', hint: '会话列表' },
  { action: 'sessions.new', hint: '新开会话' },
  { action: 'sessions.switch', hint: '切到 session' },
  { action: 'sessions.clear', hint: '清空会话消息' },
  { action: 'sessions.delete', hint: '删除会话' },
  { action: 'sessions.rename', hint: '改标题' },
  { action: 'sessions.messages', hint: '拉历史' },
  { action: 'sessions.stats', hint: '用量/诊断' },
  { action: 'sessions.export', hint: '导出 transcript' },
  { action: 'model.get', hint: '当前 provider/model' },
  { action: 'model.set', hint: '切换模型' },
  { action: 'models.list', hint: '可用模型' },
  { action: 'approval.list', hint: '待审批终端命令' },
  { action: 'approval.answer', hint: 'once / always / deny / blacklist' },
  { action: 'approval.mode', hint: 'normal | auto | yolo' },
  { action: 'queue.list', hint: '看排队' },
  { action: 'queue.clear', hint: '清空排队' },
  { action: 'queue.remove', hint: '按 queueId 删一条' },
  { action: 'command', hint: 'slash 等价：new / stop / clear / model / approval / usage' },
]
