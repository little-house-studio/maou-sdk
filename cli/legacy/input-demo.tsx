#!/usr/bin/env node
/** InputBox Demo — 测试 react-ink-textarea 在终端的各项功能 */
import React, { useState, useRef } from "react";
import { render, Box, Text, useInput } from "ink";
import { TextArea, type TextAreaHandle } from "react-ink-textarea";

const COMMANDS = ["/new", "/clear", "/stop", "/help", "/model", "/theme", "/quit"];

function App() {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [focus, setFocus] = useState(true);
  const [showCompletion, setShowCompletion] = useState(false);
  const [completionSel, setCompletionSel] = useState(0);
  const [completionItems, setCompletionItems] = useState<string[]>([]);
  const taRef = useRef<TextAreaHandle>(null);

  const log = (msg: string) => setLogs(prev => [...prev.slice(-4), msg]);

  // 全局快捷键（TextArea 自己处理字符/光标/退格/方向键）
  useInput((input, key) => {
    // 指令补全：当输入以 / 开头时
    if (value.startsWith("/") && !key.ctrl && !key.meta && !key.escape && input) {
      const matches = COMMANDS.filter(c => c.startsWith(value) && c !== value);
      if (matches.length > 0) {
        setShowCompletion(true);
        setCompletionItems(matches);
        setCompletionSel(0);
      } else {
        setShowCompletion(false);
      }
    } else if (!value.startsWith("/")) {
      setShowCompletion(false);
    }

    // 补全列表导航
    if (showCompletion) {
      if (key.upArrow) { setCompletionSel(s => Math.max(0, s - 1)); return; }
      if (key.downArrow) { setCompletionSel(s => Math.min(completionItems.length - 1, s + 1)); return; }
      if (key.tab || key.return) {
        const selected = completionItems[completionSel];
        if (selected) {
          setValue(selected + " ");
          setShowCompletion(false);
          // 用 imperative API 插入
          taRef.current?.insert(selected + " ");
        }
        return;
      }
      if (key.escape) { setShowCompletion(false); return; }
    }

    // Ctrl+K 菜单
    if (key.ctrl && input === "k") {
      log("📋 命令面板（demo 里暂未实现弹窗）");
      return;
    }

    // Esc 退出
    if (key.escape) {
      if (focus) {
        log("ℹ Esc = 退出（demo）");
      }
      return;
    }

    // Ctrl+C 退出
    if (key.ctrl && input === "c") {
      process.exit(0);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="green" bold>═══ react-ink-textarea Demo ═══</Text>
      <Text color="gray">Enter 发送 · Shift+Enter 换行 · / 指令补全 · Ctrl+C 退出</Text>
      <Text> </Text>

      {/* 指令补全列表 */}
      {showCompletion && completionItems.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          {completionItems.slice(0, 5).map((item, i) => (
            <Text key={item} color={i === completionSel ? "green" : "gray"}>
              {i === completionSel ? "▶ " : "  "}{item}
            </Text>
          ))}
          <Text color="gray"> Tab 确认 · ↑↓ 选择 · Esc 关闭</Text>
        </Box>
      )}

      {/* 输入区：react-ink-textarea */}
      <Box flexDirection="column">
        <TextArea
          ref={taRef}
          focus={focus}
          value={value}
          onChange={(v) => setValue(v)}
          onSubmit={(v) => {
            if (!v.trim()) return;
            setHistory(prev => [...prev, v]);
            log(`✓ 已发送: "${v.slice(0, 40)}${v.length > 40 ? "..." : ""}" (${[...v].length} 字)`);
            setValue("");
          }}
          placeholder="输入文字，Enter 发送，Shift+Enter 换行..."
          highlightActiveLine={true}
          activeLineColor="#1a1a1a"
          viewportLines={4}
        />
      </Box>

      <Text> </Text>

      {/* 历史记录 */}
      {history.length > 0 && (
        <Box flexDirection="column">
          <Text color="cyan" bold>── 历史 ──</Text>
          {history.map((h, i) => (
            <Text key={i} color="white">  [{i + 1}] {h.slice(0, 60)}{h.length > 60 ? "..." : ""}</Text>
          ))}
        </Box>
      )}

      <Text> </Text>

      {/* 日志 */}
      {logs.length > 0 && (
        <Box flexDirection="column">
          <Text color="gray" bold>── 日志 ──</Text>
          {logs.map((l, i) => (
            <Text key={i} color="gray">  {l}</Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

render(<App />);
