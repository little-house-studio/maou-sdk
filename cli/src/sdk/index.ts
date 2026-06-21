/** SDK 接线 —— 用 LLMConfig + stream 驱动 CLI */
import { LLMConfig, stream, type StreamEvent, type Context } from "@little-house-studio/llm";

export interface RunOpts {
  provider: string;
  model: string;
  systemPrompt: string;
  history: Context["messages"];
  signal?: AbortSignal;
  onEvent: (ev: StreamEvent) => void;
}

export async function runChat(opts: RunOpts): Promise<void> {
  const config = new LLMConfig({ configPath: process.env.MAOU_LLM_CONFIG });
  const preset = config.toAPIPreset(opts.provider, opts.model);
  const ctx: Context = { systemPrompt: opts.systemPrompt, messages: opts.history };
  for await (const ev of stream(preset, ctx, { signal: opts.signal })) {
    opts.onEvent(ev);
    if (ev.type === "done" || ev.type === "error") return;
  }
}

export { LLMConfig, stream };
