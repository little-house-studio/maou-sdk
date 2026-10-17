/** use_computer 的 MCP 式目录。list 时返回，不进 system prompt。 */

export type ComputerActionKind = "observe" | "act";

export type ComputerActionSpec = {
  name: string;
  kind: ComputerActionKind;
  plan: boolean;
  description: string;
};

export const COMPUTER_ACTIONS: ComputerActionSpec[] = [
  { name: "screenshot", kind: "observe", plan: true, description: "截当前屏或指定 App 窗口，返回图片。先看再用。" },
  { name: "snapshot", kind: "observe", plan: true, description: "读控件树，返回 [N] 与 snapshotId。可附带截图。" },
  { name: "apps", kind: "observe", plan: true, description: "列出可见应用。" },
  { name: "windows", kind: "observe", plan: true, description: "列出窗口。可按 app/pid 过滤。" },
  { name: "permissions", kind: "observe", plan: true, description: "辅助功能 / 屏幕录制 / 键鼠权限。" },
  { name: "help", kind: "observe", plan: true, description: "短用法。" },
  { name: "activate", kind: "act", plan: false, description: "激活或打开 App。" },
  { name: "click", kind: "act", plan: false, description: "点 [N] 或 x/y。带上 snapshot。" },
  { name: "type", kind: "act", plan: false, description: "往焦点或 [N] 打字。" },
  { name: "press", kind: "act", plan: false, description: "按键，如 return / tab。" },
  { name: "scroll", kind: "act", plan: false, description: "滚动。amount 行数。" },
  { name: "hotkey", kind: "act", plan: false, description: "组合键，如 keys=[\"cmd\",\"s\"]。" },
  { name: "set-value", kind: "act", plan: false, description: "写入控件值（AXSetValue）。" },
  { name: "record", kind: "act", plan: false, description: "短抽帧，不是常驻录屏。" },
];

export function formatComputerCatalog(): string {
  const lines = [
    "use_computer 是桌面控制门面（网页用 use_browser）。",
    "先 list，再 call。每个 agent 有自己的虚拟光标，互不抢系统指针。",
    "",
    "list — 本目录",
    "call — name=操作，arguments=参数",
    "例：call name=screenshot arguments={app:\"Finder\"}",
    "例：call name=click arguments={target:\"[3]\",snapshot:\"cu1_…\"}",
    "",
  ];
  for (const a of COMPUTER_ACTIONS) {
    const mode = a.plan ? "plan+execute" : "execute";
    lines.push(`${a.name}  (${a.kind}, ${mode})  ${a.description}`);
  }
  return lines.join("\n");
}
