/**
 * Browser 工具 — 浏览器自动化（基于 OpenCLI）（薄壳）
 *
 * 重型逻辑（argv 映射/envelope 解析/exec/batch/multi/watch）已剥离到
 * @little-house-studio/opencli-engine。本文件只保留 schema + 派发 + ToolResponse 封装。
 *
 * 操作铁律（Agent 必须遵守）：
 * 1. 先看再动 — state 或 find 获取数字引用，再 click/type
 * 2. open 返回 target ID，后续命令必须用 tab 参数指向该标签页
 * 3. screenshot 无 path 时返回 base64，通过 ToolResponse.images 传给 LLM
 */

import * as opencli from "@little-house-studio/opencli-engine";
import { Tool } from "../../../base.js";
import type { ToolContext, ToolResponse, ToolDefinition } from "../../../base.js";
import { createToolResponse } from "../../../base.js";

export class BrowserTool extends Tool {
  readonly definition: ToolDefinition = {
    name: "use_browser",
    aliases: ["browser-verify", "browser-check", "browser_verify", "web-verify", "read-page"],
    description:
      "控制真实浏览器（基于 OpenCLI），复用已登录 Chrome 会话。\n\n" +
      "【关键：tab 参数】\n" +
      "open 命令会返回标签页 ID（targetId）。后续所有命令（state/extract/screenshot/click 等）\n" +
      "必须传 tab 参数指向该标签页，否则操作会落在默认空标签页！\n\n" +
      "【操作流程】\n" +
      "1. open url='https://...' → 返回 targetId\n" +
      "2. state tab='<targetId>' → 获取页面元素 [N]\n" +
      "3. click/type/fill target='[N]' tab='<targetId>'\n" +
      "4. 页面变化后重新 state tab='<targetId>'\n\n" +
      "【常用操作】\n" +
      "  检查：state, find, screenshot, frames\n" +
      "  读取：get (text/value/attributes), title, url, html\n" +
      "  交互：click, type, fill, select, keys, hover, scroll, check, uncheck, back\n" +
      "  等待：wait (selector/text/time)\n" +
      "  提取：extract (长文分块), network (API 优先)\n" +
      "  标签：tab-list, tab-new, tab-select, tab-close\n" +
      "  会话：bind (绑定已登录标签), unbind, close\n" +
      "  批量：steps 数组串联多步操作\n" +
      "  跨工作区：multi 支持不同 session 的步骤序列\n" +
      "  监听：watch 后端轮询监听 DOM 变化",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description:
            "操作类型：open|state|find|screenshot|frames|" +
            "get|title|url|html|" +
            "click|type|fill|select|keys|hover|scroll|check|uncheck|back|" +
            "wait|extract|network|eval|" +
            "tab-list|tab-new|tab-select|tab-close|" +
            "bind|unbind|close|help|" +
            "batch|multi|watch",
        },
        tab: { type: "string", description: "标签页 ID（open 返回的 targetId）。state/extract/screenshot/click 等命令必须传此参数！" },
        target: { type: "string", description: "数字引用 [N] 或 CSS 选择器" },
        text: { type: "string", description: "文本内容（type/fill/select/keys/scroll/wait 用）" },
        url: { type: "string", description: "URL（open/tab-new 用）" },
        js: { type: "string", description: "只读 JavaScript（eval 用）" },
        session: { type: "string", description: "浏览器会话名称（默认 default）" },
        subtype: { type: "string", description: "get 子类型", enum: ["text", "value", "attributes", "html"] },
        nth: { type: "string", description: "CSS 多匹配时的索引" },
        limit: { type: "string", description: "find 限制条数" },
        text_max: { type: "string", description: "find/extract/html 文本截断长度" },
        depth: { type: "string", description: "html JSON 树深度" },
        children_max: { type: "string", description: "html 子节点限制" },
        amount: { type: "string", description: "scroll 滚动量(px) / wait 等待秒数" },
        timeout: { type: "string", description: "wait 超时时间(ms)" },
        wait_type: { type: "string", description: "wait 类型：selector/text/time（默认 text）", enum: ["selector", "text", "time"] },
        max_chars: { type: "string", description: "extract 分块大小（默认 20000）" },
        start: { type: "string", description: "extract 起始字符（用于分块续读）" },
        path: { type: "string", description: "screenshot 保存路径（不填则返回 base64 图片）" },
        frame: { type: "string", description: "eval 跨域 iframe 索引" },
        detail: { type: "string", description: "network 获取单条请求详情" },
        filter: { type: "string", description: "network 按字段过滤" },
        raw: { type: "boolean", description: "network 返回完整 body" },
        all: { type: "boolean", description: "network 包含静态资源" },
        ttl: { type: "string", description: "network 缓存 TTL(ms)" },
        workspace: { type: "string", description: "bind/unbind 工作区名称" },
        domain: { type: "string", description: "bind 域名过滤" },
        path_prefix: { type: "string", description: "bind 路径前缀过滤" },
        command: { type: "string", description: "run 直接执行的原始命令" },
        steps: {
          type: "array",
          description: "批量操作步骤（batch/multi 用）。multi 支持跨 session 和 watch",
          items: {
            type: "object",
            properties: {
              session: { type: "string", description: "浏览器会话名称（multi 用）" },
              action: { type: "string" },
              target: { type: "string" },
              text: { type: "string" },
              js: { type: "string" },
              url: { type: "string" },
              tab: { type: "string" },
              subtype: { type: "string" },
              nth: { type: "string" },
              amount: { type: "string" },
              timeout: { type: "string" },
              wait_type: { type: "string" },
              continue_on_error: { type: "boolean", description: "失败时是否继续" },
              watch_target: { type: "string", description: "watch 监听的 CSS 选择器" },
              watch_type: { type: "string", enum: ["change", "text", "selector", "value"], description: "watch 监听类型" },
              poll_interval: { type: "string", description: "watch 轮询间隔(ms)" },
              extract_js: { type: "string", description: "watch 自定义提取 JS" },
            },
            required: ["action"],
          },
        },
        watch_type: { type: "string", description: "watch 监听类型：change/text/selector/value", enum: ["change", "text", "selector", "value"] },
        watch_target: { type: "string", description: "watch 监听的 CSS 选择器" },
        poll_interval: { type: "string", description: "watch 轮询间隔(ms，默认 2000)" },
        extract_js: { type: "string", description: "watch 自定义提取内容的 JS 表达式" },
        reason: { type: "string", description: "为什么必须调用此工具" },
      },
      required: ["action"],
      additionalProperties: false,
    },
    allowedModes: ["execute"],
    paramGuards: {
      "type": "true", "fill": "true", "keys": "true", "select": "true",
      "click": "true", "eval": "true",
    },
  };

  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResponse> {
    const action = String(params.action ?? "").trim().toLowerCase();
    if (!action) return createToolResponse(false, "缺少 action 参数。action='help' 查看所有可用操作。");

    if (!opencli.isAvailable()) {
      return createToolResponse(false, "opencli 未安装（提示：请先安装 opencli 并加入 PATH）。");
    }

    const session = String(params.session ?? "default").trim();
    const cwd = ctx.projectRoot;

    try {
      // ── 编排类 ──
      if (action === "batch") {
        const steps = params.steps as Array<Record<string, string>> | undefined;
        if (!steps || !Array.isArray(steps) || steps.length === 0) return createToolResponse(false, "batch 需要 steps 数组");
        return this.wrap(await opencli.batch(session, steps, { cwd }));
      }
      if (action === "multi") {
        const steps = params.steps as opencli.MultiStep[] | undefined;
        if (!steps || !Array.isArray(steps) || steps.length === 0) return createToolResponse(false, "multi 需要 steps 数组");
        return this.wrap(await opencli.multi(steps, { cwd }));
      }
      if (action === "watch") {
        return this.wrap(await opencli.watch(session, {
          tab: String(params.tab ?? ""),
          watch_target: String(params.watch_target ?? ""),
          target: String(params.target ?? ""),
          watch_type: String(params.watch_type ?? "change"),
          timeout: String(params.timeout ?? "60000"),
          poll_interval: String(params.poll_interval ?? "2000"),
          extract_js: String(params.extract_js ?? ""),
        }, { cwd }));
      }
      if (action === "run") {
        const command = String(params.command ?? "").trim();
        if (!command) return createToolResponse(false, "run 需要 command 参数");
        return this.wrap(await opencli.runRaw(session, command.split(/\s+/), { cwd }));
      }

      // ── 普通 action（SHORTCUTS）──
      const shortcutArgs: Record<string, string> = {
        url: String(params.url ?? ""), target: String(params.target ?? ""), text: String(params.text ?? ""),
        js: String(params.js ?? ""), tab: String(params.tab ?? ""), subtype: String(params.subtype ?? ""),
        nth: String(params.nth ?? ""), limit: String(params.limit ?? ""), text_max: String(params.text_max ?? ""),
        depth: String(params.depth ?? ""), children_max: String(params.children_max ?? ""), amount: String(params.amount ?? ""),
        timeout: String(params.timeout ?? ""), max_chars: String(params.max_chars ?? ""), start: String(params.start ?? ""),
        path: String(params.path ?? ""), frame: String(params.frame ?? ""), detail: String(params.detail ?? ""),
        filter: String(params.filter ?? ""), raw: params.raw ? "--raw" : "", all: params.all ? "--all" : "",
        ttl: String(params.ttl ?? ""), workspace: String(params.workspace ?? ""), domain: String(params.domain ?? ""),
        path_prefix: String(params.path_prefix ?? ""), wait_type: String(params.wait_type ?? ""),
      };
      return this.wrap(await opencli.run(session, action, shortcutArgs, { cwd }));
    } catch (e) {
      return createToolResponse(false, `browser 执行失败: ${e}`);
    }
  }

  /** 把引擎 EngineResult 封装为 ToolResponse */
  private wrap(r: opencli.EngineResult): ToolResponse {
    const extras: { payload: Record<string, unknown>; images?: { mimeType: string; data: string }[] } = { payload: r.payload };
    if (r.imageBase64) {
      extras.images = [{ mimeType: "image/png", data: r.imageBase64 }];
    }
    return createToolResponse(r.ok, r.message, extras);
  }
}
