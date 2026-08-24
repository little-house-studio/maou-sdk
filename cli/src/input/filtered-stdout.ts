/**
 * filtered-stdout —— 包装 stdout，过滤 \e[3J（抹 scrollback）。
 *
 * \e[3J 会抹终端 scrollback，导致顶部 border 丢失。这里把它从输出流剥离
 * （保留 \e[2J\e[H 清视口）。
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
