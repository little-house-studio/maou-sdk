/**
 * filtered-stdout —— 包装 stdout，过滤 Ink #935 的 \e[3J（抹 scrollback）。
 *
 * Ink 在内容超视口时写 clearTerminal = \e[2J\e[3J\e[H，其中 \e[3J 抹终端 scrollback，
 * 导致顶部 border 丢失 + 残留。这里把 \e[3J 从输出流剥离（保留 \e[2J\e[H 清视口）。
 * 对应 upstream PR #936（未合并，ansi-escapes 模块 frozen 无法直接 patch）。
 */

export function createFilteredStdout(stdout: NodeJS.WriteStream): NodeJS.WriteStream {
  const origWrite = stdout.write.bind(stdout) as (...args: any[]) => boolean;
  const write = (...args: any[]): boolean => {
    const data = args[0];
    if (typeof data === "string") {
      // 剥离 \e[3J（erase saved lines），保留 \e[2J（erase screen）+ \e[H（cursor home）
      args[0] = data.replace(/\x1b\[3J/g, "");
    }
    return origWrite(...args);
  };
  return new Proxy(stdout, {
    get(target, prop, receiver) {
      if (prop === "write") return write;
      const val = Reflect.get(target, prop, receiver);
      return typeof val === "function" ? val.bind(target) : val;
    },
  }) as NodeJS.WriteStream;
}
