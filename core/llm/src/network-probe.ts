/**
 * 网络连通性探测
 *
 * 从 client.ts 拆出（原 _waitForNetwork private 方法）。
 * 设计要求"网络问题一直 ping 网络，而不是一直重试 llm 发送"：网络故障时先探测连通性恢复，再重试 LLM。
 *
 * 只依赖一个 fetch 实现（作为参数传入），无 this 依赖，故独立成模块。
 */

/** 网络探测间隔：网络故障时先 ping 网络（而非盲目重试 LLM），每 3s 探测一次 */
const NETWORK_PROBE_INTERVAL_MS = 3_000;
/** 网络探测总上限（ms），超过则放弃、抛出网络错误 */
const NETWORK_PROBE_TIMEOUT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 网络故障探测：用轻量 HEAD 请求探测连通性，每 NETWORK_PROBE_INTERVAL_MS 探测一次，
 * 直到通或超过 NETWORK_PROBE_TIMEOUT_MS。返回 true=网络已恢复，false=超时。
 * 不抛错——网络探测本身的失败只是"还没通"。
 */
export async function waitForNetwork(fetchImpl: typeof fetch): Promise<boolean> {
  const deadline = Date.now() + NETWORK_PROBE_TIMEOUT_MS;
  const probeUrl = "https://www.google.com/generate_204";
  while (Date.now() < deadline) {
    try {
      await fetchImpl(probeUrl, { method: "HEAD", signal: AbortSignal.timeout(5000) } as RequestInit);
      return true; // 任何 HTTP 响应都算"网络通"（即使非 204）
    } catch {
      // 探测失败：等下一轮
      await sleep(NETWORK_PROBE_INTERVAL_MS);
    }
  }
  return false;
}

/** 导出常量供 client 复用（错误信息里要用） */
export const NETWORK_PROBE_TIMEOUT_VALUE = NETWORK_PROBE_TIMEOUT_MS;
