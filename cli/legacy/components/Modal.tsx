/** Modal — 命令/模型/帮助 弹窗（用 @inkjs/ui Select） */
import React from "react";
import { Box, Text } from "ink";
import { Select } from "@inkjs/ui";
import { useStore } from "../state/store.js";
import { currentTheme as t } from "../theme.js";
import type { AgentCliConfig } from "../types.js";

const COMMANDS = [
  { value: "new", label: "新对话" },
  { value: "model", label: "选模型" },
  { value: "sessions", label: "切换会话" },
  { value: "help", label: "帮助" },
  { value: "quit", label: "退出" },
];

export function CommandPalette({ onRun }: { onRun: (id: string) => void }) {
  const setModal = useStore(s => s.setModal);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.accent} paddingX={2} {...({ position: "absolute", top: 3, left: 2 } as object)}>
      <Text color={t.accent} bold>► 命令</Text>
      <Select
        options={COMMANDS}
        onChange={(v) => { onRun(v); setModal(null); }}
        visibleOptionCount={5}
      />
    </Box>
  );
}

export function ModelPicker({ config }: { config: AgentCliConfig }) {
  const { setProviderModel, setModal, toastMsg } = useStore();
  const providers = config.getProviders?.() ?? [];
  const items = providers.flatMap(p =>
    (config.getModels?.(p.id) ?? []).map(m => ({ value: `${p.id}\0${m.id}`, label: `${p.name}/${m.name}` }))
  );
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.accent} paddingX={2} {...({ position: "absolute", top: 3, left: 2 } as object)}>
      <Text color={t.accent} bold>◆ 模型</Text>
      <Select
        options={items}
        onChange={(v) => {
          const [p, m] = v.split("\0");
          setProviderModel(p!, m!);
          toastMsg(`已切换 ${p}/${m}`, "ok");
          setModal(null);
        }}
        visibleOptionCount={5}
      />
    </Box>
  );
}

export function HelpModal() {
  const setModal = useStore(s => s.setModal);
  const keys: [string, string][] = [
    ["↵ Enter", "发送"], ["Ctrl+K", "命令面板"], ["Ctrl+M", "选模型"],
    ["Ctrl+G/E", "外部编辑器"], ["Ctrl+N", "新对话"],
    ["Esc", "中断/关闭"], ["Ctrl+C", "退出"],
  ];
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.accent} paddingX={2} {...({ position: "absolute", top: 3, left: 2 } as object)}>
      <Text color={t.accent} bold>? 快捷键</Text>
      {keys.map(([k, d]) => <Text key={k}><Text color={t.accent} bold>{k.padEnd(12)}</Text> <Text color={t.fg}>{d}</Text></Text>)}
      <Text color={t.dim}>Esc 关闭</Text>
    </Box>
  );
}
