/**
 * 限流 + 并发控制 —— 保护厂商配额、防刷爆
 *
 * 两个独立原语，可叠加使用：
 * - ConcurrencyLimiter：同时最多 N 个请求（信号量）
 * - RateLimiter：每时间窗最多 N 个请求（令牌桶/固定窗口）
 * - composeLimiter：组合多个限制器（全满足才放行）
 *
 * Chat 场景：多用户并发 → ConcurrencyLimiter；免费额度防超 → RateLimiter。
 */

/** 并发限制器（信号量） */
export class ConcurrencyLimiter {
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active++;
  }

  release(): void {
    this.active--;
    const next = this.waiters.shift();
    if (next) next();
  }

  /** 包裹一个 async 函数，自动 acquire/release */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  get current(): number {
    return this.active;
  }
}

/** 速率限制器（固定窗口：每 windowMs 最多 max 个） */
export class RateLimiter {
  private timestamps: number[] = [];
  constructor(
    private max: number,
    private windowMs: number = 60_000,
  ) {}

  async acquire(): Promise<void> {
    const now = Date.now();
    // 清理过期时间戳
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    if (this.timestamps.length >= this.max) {
      // 等到最早的窗口过期
      const wait = this.windowMs - (now - this.timestamps[0]);
      await new Promise((r) => setTimeout(r, Math.max(1, wait)));
      return this.acquire();
    }
    this.timestamps.push(now);
  }

  /** 包裹一个 async 函数，自动限流 */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    return fn();
  }

  /** 剩余可用请求数（当前窗口） */
  get remaining(): number {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs);
    return Math.max(0, this.max - this.timestamps.length);
  }
}

/** 组合多个限制器（全部 acquire 后才执行） */
export async function withLimiters<T>(
  limiters: Array<{ acquire: () => Promise<void>; release?: () => void }>,
  fn: () => Promise<T>,
): Promise<T> {
  const acquired: Array<{ release?: () => void }> = [];
  try {
    for (const l of limiters) {
      await l.acquire();
      acquired.push(l);
    }
    return await fn();
  } finally {
    // 逆序 release
    for (let i = acquired.length - 1; i >= 0; i--) {
      acquired[i].release?.();
    }
  }
}
