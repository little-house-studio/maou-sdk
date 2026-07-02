// 探针：验证 Pi TUI 能否 import + 实例化
// NOTE: `Terminal` is an interface in pi-tui (erased at runtime); the concrete
// class is `ProcessTerminal`. We import TUI/Box/Text (real runtime classes)
// plus ProcessTerminal, and type-only-import the Terminal interface.
import { TUI, Box, Text, ProcessTerminal } from "@oh-my-pi/pi-tui";
import type { Terminal } from "@oh-my-pi/pi-tui";

console.log("TUI:", typeof TUI);
console.log("Box:", typeof Box);
console.log("Text:", typeof Text);
console.log("ProcessTerminal:", typeof ProcessTerminal);
console.log("ProcessTerminal callable:", typeof ProcessTerminal === "function");
// Touch the interface name so it's not tree-shaken.
void (0 as unknown as Terminal);
