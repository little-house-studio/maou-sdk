/**
 * LanguageServer — 单个语言服务器进程的封装。
 * spawn → initialize → initialized → 保持温热，复用。
 * 内置诊断 sink（publishDiagnostics 推送）+ $/progress 令牌跟踪。
 */

import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import {
  createProtocolConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type ProtocolConnection,
} from "vscode-languageserver-protocol/node";
import {
  InitializeRequest,
  InitializedNotification,
  ShutdownRequest,
  ExitNotification,
  DidOpenTextDocumentNotification,
  DidChangeTextDocumentNotification,
  type InitializeParams,
  type Diagnostic,
  type PublishDiagnosticsParams,
} from "vscode-languageserver-protocol";
import type { ServerSpec } from "./registry.js";
import { findWorkspaceRoot } from "./registry.js";
import { pathToUri } from "./convert.js";
import { ServerNotInstalledError, ServerCrashError } from "./types.js";

interface OpenDoc {
  version: number;
  mtimeMs: number;
}

interface ProgressState {
  /** 活跃 work-done token → 标题 */
  active: Map<string | number, string>;
  /** 某个匹配 check 令牌最近一次 end 的时间戳 */
  lastCheckEndAt: number;
}

export class LanguageServer {
  readonly spec: ServerSpec;
  readonly root: string;
  private child: ChildProcess | null = null;
  private conn: ProtocolConnection | null = null;
  private openDocs = new Map<string, OpenDoc>();
  /** uri → 最近一批诊断 */
  readonly diagnostics = new Map<string, Diagnostic[]>();
  /** 最近一次 publishDiagnostics 的时间戳（全局，任意文件） */
  lastDiagAt = 0;
  /** uri → 该文件最近一次 publishDiagnostics 的时间戳（单文件收敛用） */
  readonly diagAt = new Map<string, number>();
  readonly progress: ProgressState = { active: new Map(), lastCheckEndAt: 0 };
  lastUsedAt = Date.now();
  private ready: Promise<void> | null = null;
  private dead = false;

  constructor(spec: ServerSpec, root: string) {
    this.spec = spec;
    this.root = root;
  }

  /** 确保已初始化（幂等） */
  async ensureReady(): Promise<void> {
    if (this.dead) throw new ServerCrashError(`语言服务器 ${this.spec.languageId} 已崩溃`);
    if (this.ready) return this.ready;
    this.ready = this.start();
    return this.ready;
  }

  private async start(): Promise<void> {
    let child: ChildProcess;
    try {
      child = spawn(this.spec.command, this.spec.args, { cwd: this.root, stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      throw new ServerNotInstalledError(this.spec.languageId, this.spec.command, this.spec.installHint ?? "");
    }
    this.child = child;

    // 吞掉子进程流的异步错误（EPIPE / ERR_STREAM_DESTROYED）——
    // 关闭进程时 jsonrpc 仍可能尝试写入已销毁的 stdin，否则会抛未捕获异常崩溃宿主
    child.stdin?.on("error", () => { /* ignore */ });
    child.stdout?.on("error", () => { /* ignore */ });
    child.stderr?.on("error", () => { /* ignore */ });

    // 先等 spawn 结果：成功才建连接发 initialize；ENOENT 在任何写入前就抛出，
    // 避免向已销毁的 stdin 写入导致 ERR_STREAM_DESTROYED 未捕获拒绝
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", (e: NodeJS.ErrnoException) => {
        this.dead = true;
        if (e.code === "ENOENT") {
          reject(new ServerNotInstalledError(this.spec.languageId, this.spec.command, this.spec.installHint ?? ""));
        } else {
          reject(new ServerCrashError(`${this.spec.command} 启动失败: ${e.message}`));
        }
      });
    });

    // 进程在 initialize 期间退出/出错的竞速信号——否则 sendRequest(Initialize) 会永久挂起
    // （响应永不到来，事件循环空转）。常见于 server 二进制损坏/版本不符立即退出（如 rust-analyzer
    // rustup shim 报 "Unknown binary" 后 code=1 退出）。
    let earlyExitReject: ((e: Error) => void) | null = null;
    const earlyExit = new Promise<never>((_, reject) => { earlyExitReject = reject; });
    earlyExit.catch(() => { /* 若 initialize 先成功则忽略 */ });
    const onEarlyExit = (info: string) => {
      this.dead = true;
      earlyExitReject?.(new ServerCrashError(`${this.spec.command} 在初始化期间退出（${info}）。请检查该语言服务器是否正确安装。`));
    };
    child.on("error", (e: NodeJS.ErrnoException) => onEarlyExit(e.message));
    child.on("exit", (code, sig) => onEarlyExit(`code=${code} signal=${sig}`));

    const conn = createProtocolConnection(
      new StreamMessageReader(child.stdout!),
      new StreamMessageWriter(child.stdin!),
    );
    this.conn = conn;

    // ── 处理器必须在 listen() 之前注册 ──
    // 用方法名字符串注册，避免 NotificationType 实例跨包不一致导致漏接收
    conn.onNotification("textDocument/publishDiagnostics", (p: PublishDiagnosticsParams) => {
      const now = Date.now();
      this.diagnostics.set(p.uri, p.diagnostics);
      this.diagAt.set(p.uri, now);
      this.lastDiagAt = now;
    });
    // 通用 $/progress：监听所有 token（门控诊断收敛）
    conn.onNotification("$/progress", (params: { token: string | number; value: { kind: string; title?: string } }) => {
      const { token, value } = params;
      if (value.kind === "begin") {
        this.progress.active.set(token, value.title ?? "");
      } else if (value.kind === "end") {
        const title = this.progress.active.get(token) ?? "";
        this.progress.active.delete(token);
        const checkRe = this.spec.progressTokens?.check;
        if (checkRe && checkRe.test(title)) {
          this.progress.lastCheckEndAt = Date.now();
        }
      }
    });
    // 服务器请求创建进度令牌——必须应答，否则连接抛 ResponseError 中断（诊断永不推送）
    conn.onRequest("window/workDoneProgress/create", () => null);
    // 其它服务端→客户端请求的兜底（configuration / registerCapability 等），统一应答空值
    conn.onRequest("workspace/configuration", (p: { items: unknown[] }) => (p?.items ?? []).map(() => ({})));
    conn.onRequest("client/registerCapability", () => null);
    conn.onRequest("client/unregisterCapability", () => null);
    conn.onRequest("workspace/applyEdit", () => ({ applied: false }));

    conn.onClose(() => { this.dead = true; });
    conn.onError(() => { /* 记录但不立即 kill；下次请求会触发重建 */ });

    conn.listen();

    const initParams: InitializeParams = {
      processId: process.pid,
      rootUri: pathToUri(this.root),
      capabilities: {
        textDocument: {
          synchronization: { dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: true },
          definition: { dynamicRegistration: false, linkSupport: true },
          typeDefinition: { dynamicRegistration: false, linkSupport: true },
          references: { dynamicRegistration: false },
          hover: { dynamicRegistration: false, contentFormat: ["markdown", "plaintext"] },
          rename: { dynamicRegistration: false, prepareSupport: true },
          completion: { dynamicRegistration: false, completionItem: { snippetSupport: false } },
          documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: true },
        },
        workspace: { workspaceFolders: true, symbol: { dynamicRegistration: false } },
        window: { workDoneProgress: true },
      },
      initializationOptions: this.spec.initializationOptions,
      workspaceFolders: [{ uri: pathToUri(this.root), name: this.root }],
    };

    // initialize 与"进程提前退出"竞速：坏掉的 server 会立即退出，避免永久挂起
    await Promise.race([
      conn.sendRequest(InitializeRequest.type, initParams),
      earlyExit,
    ]);
    await conn.sendNotification(InitializedNotification.type, {});
  }

  /** 打开/同步文档（按 mtime 漂移重新同步）。返回 uri。 */
  async syncDoc(file: string): Promise<string> {
    return (await this.syncDocEx(file)).uri;
  }

  /**
   * 打开/同步文档，并报告是否真的发出了 didOpen/didChange 通知。
   * changed=true 表示应等待该文件的新一批 publishDiagnostics；
   * changed=false 表示文档已打开且未变更，现有诊断即当前状态。
   */
  async syncDocEx(file: string): Promise<{ uri: string; changed: boolean }> {
    await this.ensureReady();
    const uri = pathToUri(file);
    const text = readFileSync(file, "utf-8");
    const mtimeMs = statSync(file).mtimeMs;
    const existing = this.openDocs.get(uri);
    let changed = false;

    if (!existing) {
      await this.conn!.sendNotification(DidOpenTextDocumentNotification.type, {
        textDocument: { uri, languageId: this.spec.languageId, version: 1, text },
      });
      this.openDocs.set(uri, { version: 1, mtimeMs });
      changed = true;
    } else if (existing.mtimeMs !== mtimeMs) {
      const version = existing.version + 1;
      await this.conn!.sendNotification(DidChangeTextDocumentNotification.type, {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
      this.openDocs.set(uri, { version, mtimeMs });
      changed = true;
    }
    this.lastUsedAt = Date.now();
    return { uri, changed };
  }

  /** 已打开文档的 uri 列表 */
  openedUris(): string[] {
    return [...this.openDocs.keys()];
  }

  connection(): ProtocolConnection {
    if (!this.conn) throw new ServerCrashError("连接未就绪");
    return this.conn;
  }

  isDead(): boolean {
    return this.dead;
  }

  async shutdown(): Promise<void> {
    // 仅在连接活着且 stdin 仍可写时走优雅关闭，否则直接 kill，避免向已销毁的流写入
    const writable = this.conn && !this.dead && this.child?.stdin?.writable;
    try {
      if (writable) {
        await Promise.race([
          this.conn!.sendRequest(ShutdownRequest.type),
          new Promise((r) => setTimeout(r, 2000)),
        ]);
        if (this.child?.stdin?.writable) {
          await this.conn!.sendNotification(ExitNotification.type);
        }
      }
    } catch { /* ignore */ }
    this.dead = true;
    try { this.conn?.dispose(); } catch { /* ignore */ }
    try { this.child?.kill(); } catch { /* ignore */ }
  }
}
