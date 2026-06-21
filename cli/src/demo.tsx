#!/usr/bin/env node
/**
 * Maou CLI 功能验收 Demo —— 手动逐项验收所有 TUI 能力
 *
 * 运行: cd cli && pnpm dev:demo   (或 node dist/demo.js)
 * 操作: ← → 或 数字键 1-9/0/a/b 切页 · q 退出 · 各页内有交互提示
 *
 * 不连真实 LLM（用 faux 流式 + 静态数据），纯展示组件能力供验收。
 */
import React, { useState, useEffect } from "react";
import { render, Box, Text, useInput, useApp, useStdout } from "ink";
import { currentTheme, setTheme, THEMES } from "./theme.js";
import { Panel } from "./components/Panel.js";
import { Gauge, Spark, Wireframe, AsciiArt, Spinner } from "./components/graphics.js";
import { Message } from "./components/Chat.js";
import { InputBox, colToCharIndex } from "./components/InputBox.js";
import { ModelPicker, CommandPalette, HelpModal } from "./components/Modals.js";
import { parseMouse, enableMouse, disableMouse } from "./input/mouse.js";
import { asciiFromImage } from "./image/ascii.js";
import { useStore } from "./state/store.js";
// @ts-ignore pngjs 无类型声明
import pngjs from "pngjs";
import { writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PAGES = [
  "① 多分割框 + RPG HUD 布局",
  "② Gauge 血条/魔条",
  "③ Sparkline 彩色函数曲线",
  "④ 3D 旋转线框（水晶/立方体）",
  "⑤ AsciiArt 2D 字符画 + 着色",
  "⑥ 图片→ASCII（4 模式）",
  "⑦ 消息流 + 工具调用卡片 + 思考",
  "⑧ 输入框 + 点击定位光标",
  "⑨ 弹窗：命令面板/模型选择/帮助",
  "⑩ 鼠标 SGR 实时事件",
  "⑪ 动画 spinner + 表情 + 主题切换",
  "⑫ 验收清单总览",
];

// 造测试图片（渐变圆）
function ensureTestImage(): string {
  const p = join(tmpdir(), "maou-demo-circle.png");
  if (existsSync(p)) return p;
  const { PNG } = pngjs;
  const png = new PNG({ width: 40, height: 40 });
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
    const i = (y * 40 + x) * 4;
    const dx = x - 20, dy = y - 20, d = Math.sqrt(dx * dx + dy * dy);
    const v = d < 18 ? Math.max(0, 255 - d * 9) : 0;
    png.data[i] = v; png.data[i + 1] = Math.round(v * 0.3); png.data[i + 2] = Math.round(v * 0.6); png.data[i + 3] = 255;
  }
  writeFileSync(p, PNG.sync.write(png));
  return p;
}

function Demo() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [page, setPage] = useState(0);
  const [frame, setFrame] = useState(0);
  const [angle, setAngle] = useState(0);
  const [wireModel, setWireModel] = useState<"crystal" | "cube">("crystal");
  const [input, setInput] = useState("点这行试试→中文abc混排");
  const [cursor, setCursor] = useState(0);
  const [imgMode, setImgMode] = useState<"block" | "braille" | "ramp" | "half">("block");
  const [lastMouse, setLastMouse] = useState<string>("（还没点击）");
  const [themeName, setThemeName] = useState("vampire");
  const store = useStore();
  const t = currentTheme;
  const img = ensureTestImage();

  useEffect(() => {
    const id = setInterval(() => { setFrame((f) => f + 1); setAngle((a) => a + 0.12); }, 90);
    return () => clearInterval(id);
  }, []);

  // 鼠标
  useEffect(() => {
    if (!stdout) return;
    enableMouse(stdout);
    const onData = (d: Buffer) => {
      const evs = parseMouse(d.toString("latin1"));
      for (const e of evs) {
        setLastMouse(`${e.type} @ 列${e.col} 行${e.row} 按钮${e.button}`);
        if (page === 7 && e.type === "down") {
          // 输入框点击定位（输入框在固定行，估算）
          const rel = Math.max(0, e.col - 3);
          setCursor(colToCharIndex(input, rel));
        }
      }
    };
    process.stdin.on("data", onData);
    return () => { process.stdin.off("data", onData); disableMouse(stdout); };
  }, [stdout, page, input]);

  // demo 用静态消息
  useEffect(() => {
    if (store.messages.length === 0) {
      useStore.setState({
        messages: [
          { id: "1", role: "user", content: "帮我看看天气，然后算 2+3", ts: 0 },
          { id: "2", role: "assistant", content: "好的，我来查天气并计算。", thinking: "用户想要天气+计算，我需要调用 weather 和 add 两个工具…", toolCalls: [
            { id: "t1", name: "get_weather", args: '{"city":"上海"}', result: "晴 26°C", done: true },
            { id: "t2", name: "add", args: '{"a":2,"b":3}', result: "5", done: true },
          ], usage: { input: 120, output: 45, cost: 0.0012 }, ts: 0 },
        ] as any,
        hud: { tokenHistory: [3,5,2,8,6,9,4,7,5,10,8,6,11,9,7], costHistory: [0.001,0.002,0.0015], totalCost: 0.0045, totalInput: 340, totalOutput: 120, round: 3 },
      });
    }
  }, []);

  useInput((char, key) => {
    if (store.modal) return;
    if (char === "q" || (key.ctrl && char === "c")) { if (stdout) disableMouse(stdout); exit(); return; }
    if (key.rightArrow || char === "n") return setPage((p) => (p + 1) % PAGES.length);
    if (key.leftArrow || char === "p") return setPage((p) => (p - 1 + PAGES.length) % PAGES.length);
    const num = "1234567890ab".indexOf(char);
    if (num >= 0 && num < PAGES.length) return setPage(num);
    // 页内交互
    if (page === 3 && char === "m") setWireModel((w) => (w === "crystal" ? "cube" : "crystal"));
    if (page === 5 && char === "m") setImgMode((m) => (m === "block" ? "braille" : m === "braille" ? "ramp" : m === "ramp" ? "half" : "block"));
    if (page === 8) {
      if (char === "k") return store.setModal("command");
      if (char === "o") return store.setModal("model");
      if (char === "h") return store.setModal("help");
    }
    if (page === 7 && char && !key.ctrl && !key.return && !key.leftArrow && !key.rightArrow) {
      if (key.backspace || key.delete) { if (cursor > 0) { setInput((v) => v.slice(0, cursor - 1) + v.slice(cursor)); setCursor((c) => c - 1); } }
      else { setInput((v) => v.slice(0, cursor) + char + v.slice(cursor)); setCursor((c) => c + 1); }
    }
    if (page === 10 && char === "t") { const names = Object.keys(THEMES); const next = names[(names.indexOf(currentTheme.name) + 1) % names.length]!; setTheme(next); setThemeName(next); }
  });

  const Header = () => (
    <Box justifyContent="space-between" paddingX={1}>
      <Text color={t.accent} bold>⚔ Maou CLI 功能验收 [{page + 1}/{PAGES.length}]</Text>
      <Text color={t.dim}>← → 切页 · 数字键跳页 · q 退出</Text>
    </Box>
  );
  const Title = ({ children }: { children: React.ReactNode }) => (
    <Box marginBottom={1}><Text color={t.role.assistant} bold>{children}</Text></Box>
  );
  const Check = ({ children }: { children: React.ReactNode }) => (
    <Text color={t.status.ok}>  ✓ {children}</Text>
  );

  return (
    <Box flexDirection="column" minHeight={26}>
      <Header />
      <Box borderStyle="round" borderColor={t.border} flexDirection="column" paddingX={1} flexGrow={1} marginX={1}>
        <Title>{PAGES[page]}</Title>

        {page === 0 && (
          <Box flexDirection="column">
            <Box height={10}>
              <Panel title="侧栏" icon="☰" width={16} focused>
                <Text color={t.fg}>✦ 新对话</Text>
                <Text color={t.fg}>◆ 选模型</Text>
                <Text color={t.fg}>⚡ 命令</Text>
              </Panel>
              <Panel title="对话" icon="✦" flexGrow={1}>
                <Text color={t.fg}>中间是聊天主区</Text>
                <Text color={t.dim}>flex 自适应宽度</Text>
              </Panel>
              <Panel title="HUD" icon="❖" width={22}>
                <Gauge label="HP" value={7} max={10} width={12} />
                <Gauge label="MP" value={4} max={10} width={12} color={t.spark[2]} />
              </Panel>
            </Box>
            <Check>三栏布局：圆角软框 + 标题图标 + 焦点高亮(◆)</Check>
            <Check>边框样式可区分质感（round/double/bold）</Check>
          </Box>
        )}

        {page === 1 && (
          <Box flexDirection="column">
            <Gauge label="HP" value={9} max={10} width={24} />
            <Gauge label="MP" value={5} max={10} width={24} color={t.spark[2]} />
            <Gauge label="EXP" value={3} max={10} width={24} color={t.status.ok} />
            <Gauge label="危险" value={9} max={10} width={24} />
            <Box marginTop={1}><Check>血条按比例填充 ▰▱，超 85% 自动变红（看"危险"行）</Check></Box>
          </Box>
        )}

        {page === 2 && (
          <Box flexDirection="column">
            <Spark values={[1,3,2,5,4,7,3,8,5,9,6,4,10,7,5,11,8,6,9]} width={40} height={12} label="Token 历史（盲文亚像素曲线）" />
            <Box marginTop={1}><Spark values={[5,5,5,5,5,5]} width={20} height={6} label="平线" /></Box>
            <Box marginTop={1}><Check>盲文曲线随数值起伏，彩色渐变（上深下浅），填充曲线下方</Check></Box>
          </Box>
        )}

        {page === 3 && (
          <Box flexDirection="column">
            <Box justifyContent="center"><Wireframe angle={angle} model={wireModel} width={20} height={10} /></Box>
            <Box marginTop={1}><Text color={t.dim}>当前模型: <Text color={t.accent}>{wireModel}</Text> · 按 <Text color={t.accent} bold>m</Text> 切换立方体/水晶</Text></Box>
            <Check>3D 线框实时旋转（盲文画线 + 透视投影）</Check>
          </Box>
        )}

        {page === 4 && (
          <Box flexDirection="column">
            <AsciiArt color={t.accent} lines={["  /\\_/\\  ", " ( o.o ) ", "  > ^ <  ", " MAOU AI "]} />
            <Box marginTop={1}>
              <AsciiArt lines={["████", "▓▓▓▓", "▒▒▒▒", "░░░░"]} colors={[["#f43f5e","#fb7185","#fb923c","#fbbf24"],["#c026d3","#e879f9","#a78bfa","#818cf8"],["#06b6d4","#22d3ee","#67e8f9","#a5f3fc"],["#34d399","#6ee7b7","#a7f3d0","#d1fae5"]]} />
            </Box>
            <Box marginTop={1}><Check>2D 字符画（猫头）+ 逐字 truecolor 着色（彩色方块）</Check></Box>
          </Box>
        )}

        {page === 5 && (
          <Box flexDirection="column">
            <Text color={t.dim}>图片→ASCII，模式: <Text color={t.accent}>{imgMode}</Text> · 按 <Text color={t.accent} bold>m</Text> 切换 block/braille/ramp/half</Text>
            <Box marginTop={1}>
              <AsciiArt {...asciiFromImage(img, { width: imgMode === "braille" ? 20 : 30, mode: imgMode, color: true })} />
            </Box>
            <Box marginTop={1}><Check>一张渐变圆 PNG 被转成字符画（4 模式可切，truecolor 保留原色）</Check></Box>
          </Box>
        )}

        {page === 6 && (
          <Box flexDirection="column">
            {store.messages.map((m) => <Message key={m.id} msg={m} frame={frame} />)}
            <Check>用户/助手消息分色 · 思考过程💭 · 工具卡片(✓绿/进行中spinner) · token 统计</Check>
          </Box>
        )}

        {page === 7 && (
          <Box flexDirection="column">
            <Text color={t.dim}>下面输入框：直接打字编辑 · <Text color={t.accent} bold>鼠标点击</Text>定位光标 · ←→ 移动</Text>
            <Box marginTop={1}><InputBox value={input} cursor={cursor} focused /></Box>
            <Box marginTop={1}><Text color={t.dim}>光标在字符索引 <Text color={t.accent}>{cursor}</Text>（中文占2列，点击会精确对齐）</Text></Box>
            <Check>点击输入框任意字符位置，光标跳过去（宽字符感知）</Check>
          </Box>
        )}

        {page === 8 && (
          <Box flexDirection="column">
            <Text color={t.fg}>按键打开弹窗（z-overlay 模态）：</Text>
            <Text color={t.accent} bold>  k</Text><Text color={t.fg}> = 命令面板（模糊搜索）</Text>
            <Text color={t.accent} bold>  o</Text><Text color={t.fg}> = 模型选择器（↑↓ 选 + 搜索）</Text>
            <Text color={t.accent} bold>  h</Text><Text color={t.fg}> = 帮助快捷键表</Text>
            <Box marginTop={1}><Check>弹窗叠在主界面上，Esc 关闭，自带搜索/选择交互</Check></Box>
          </Box>
        )}

        {page === 9 && (
          <Box flexDirection="column">
            <Text color={t.fg}>用鼠标在屏幕任意处点击/滚动，下面会实时显示事件：</Text>
            <Box marginTop={1} borderStyle="round" borderColor={t.accent} paddingX={1}>
              <Text color={t.role.toolResult}>最近鼠标事件: {lastMouse}</Text>
            </Box>
            <Box marginTop={1}><Check>SGR 鼠标：点击/释放/滚轮坐标实时解析（部分终端需开启鼠标报告）</Check></Box>
          </Box>
        )}

        {page === 10 && (
          <Box flexDirection="column">
            <Box>
              <Text color={t.fg}>Spinner(spin): </Text><Spinner frame={frame} />
              <Text color={t.fg}>   Spinner(pulse): </Text><Spinner frame={frame} kind="pulse" />
            </Box>
            <Box marginTop={1}><Text color={t.fg}>表情系统: </Text><Text color={t.role.assistant} bold>{store.expression}</Text></Box>
            <Box marginTop={1}><Text color={t.dim}>当前主题: <Text color={t.accent}>{themeName}</Text> · 按 <Text color={t.accent} bold>t</Text> 切换 vampire/cyber（看颜色变化）</Text></Box>
            <Box marginTop={1} flexDirection="column">
              <Gauge label="预览" value={frame % 11} max={10} width={20} />
              <Wireframe angle={angle} width={12} height={5} />
            </Box>
            <Check>动画 spinner 转动 · 表情可变 · 主题切换全局换色</Check>
          </Box>
        )}

        {page === 11 && (
          <Box flexDirection="column">
            <Text color={t.role.assistant} bold>验收清单（每页验过打勾）：</Text>
            {PAGES.slice(0, 11).map((p, i) => <Text key={i} color={t.fg}>  □ {p}</Text>)}
            <Box marginTop={1}><Text color={t.status.ok}>全部验过 = RPG 风 TUI 完整度达标 ✦</Text></Box>
            <Text color={t.dim}>真实聊天体验请跑 `pnpm dev`（需配 ~/.maou/llm-config.json）</Text>
          </Box>
        )}
      </Box>
      <Box paddingX={1}>
        <Text color={t.dim}>页面: </Text>
        {PAGES.map((_, i) => <Text key={i} color={i === page ? t.accent : t.dim}>{i === page ? "●" : "·"}</Text>)}
      </Box>
      {store.modal === "model" && <ModelPicker />}
      {store.modal === "command" && <CommandPalette onRun={() => store.setModal(null)} />}
      {store.modal === "help" && <HelpModal />}
    </Box>
  );
}

process.stdout.write("\x1b[?1049h\x1b[H");
const { waitUntilExit } = render(<Demo />, { exitOnCtrlC: false });
waitUntilExit().then(() => {
  process.stdout.write("\x1b[?1049l\x1b[?1006l\x1b[?1000l");
});
