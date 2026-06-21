#!/usr/bin/env node
/**
 * Maou CLI 功能验收 Demo —— 手动逐项验收所有 TUI 能力
 *
 * 运行: cd cli && pnpm dev:demo
 * 全局: ← → / n p 翻页 · 数字 1-9,0 跳前 10 页 · q 退出
 *       ` (反引号) 开/关鼠标 —— 关闭时终端可自由拖选复制（默认关）
 *
 * 不连真实 LLM（faux 数据），纯展示组件能力供验收。
 */
import React, { useState, useEffect } from "react";
import { render, Box, Text, useApp } from "ink";
import { currentTheme, setTheme, THEMES } from "./theme.js";
import { Panel } from "./components/Panel.js";
import { Gauge, Spark, Wireframe, AsciiArt, Spinner } from "./components/graphics.js";
import { Message } from "./components/Chat.js";
import { InputBox, colToCharIndex } from "./components/InputBox.js";
import { ModelPicker, CommandPalette, HelpModal } from "./components/Modals.js";
import { GradientText, GradientBar, GradientBlock, GradientField } from "./components/Gradient.js";
import { ScrollView } from "./components/Scrollable.js";
import { Collapsible } from "./components/Collapsible.js";
import { FocusFrame } from "./components/Focus.js";
import { Markdown } from "./components/Markdown.js";
import { asciiFromImage } from "./image/ascii.js";
import { useStore } from "./state/store.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { useMouse } from "./hooks/useMouse.js";
import { useScroll } from "./hooks/useScroll.js";
import { useCleanInput } from "./hooks/useCleanInput.js";
// @ts-ignore pngjs 无类型声明
import pngjs from "pngjs";
import { writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PAGES = [
  "① 多分割框 + 响应式布局（缩放终端实时重排）",
  "② Gauge 血条/魔条",
  "③ Sparkline 彩色函数曲线",
  "④ 渐变：逐字/横条/竖块/对角场",
  "⑤ 3D 旋转线框（水晶/立方体）",
  "⑥ AsciiArt 2D 字符画 + 着色",
  "⑦ 图片→ASCII（4 模式）",
  "⑧ Markdown / HTML 卡片渲染",
  "⑨ 消息流 + 工具卡片 + 思考",
  "⑩ 可滚动对话框（滚轮/↑↓ + 滚动条）",
  "⑪ 可折叠侧栏（展开/收起动画）",
  "⑫ 聚焦流光框（Tab 切焦点）",
  "⑬ 输入框 + 点击定位光标（需开鼠标）",
  "⑭ 不透明弹窗（命令/模型/帮助）",
  "⑮ 鼠标 SGR 实时事件（需开鼠标）",
  "⑯ 动画 spinner + 表情 + 主题切换",
  "⑰ 验收清单总览",
];

const TRANSCRIPT: { who: string; c: "user" | "assistant" | "system"; text: string }[] = [
  { who: "你", c: "user", text: "帮我规划一次三天的京都旅行" },
  { who: "Vampire", c: "assistant", text: "好的，Day1：清水寺 → 二年坂 → 祇园夜游" },
  { who: "Vampire", c: "assistant", text: "Day2：伏见稻荷千本鸟居 → 岚山竹林 → 渡月桥" },
  { who: "Vampire", c: "assistant", text: "Day3：金阁寺 → 龙安寺枯山水 → 锦市场" },
  { who: "你", c: "user", text: "第二天能加个咖啡馆吗" },
  { who: "Vampire", c: "assistant", text: "推荐 % Arabica 岚山店，渡月桥边喝拿铁看河景" },
  { who: "系统", c: "system", text: "已保存行程到 ~/.maou/sessions" },
  { who: "你", c: "user", text: "预算大概多少" },
  { who: "Vampire", c: "assistant", text: "交通+门票约 ¥6000/人，餐饮另算" },
  { who: "你", c: "user", text: "帮我订 Day1 的清水寺门票" },
  { who: "Vampire", c: "assistant", text: "清水寺无需预约，现场购票 ¥400" },
  { who: "你", c: "user", text: "好，谢谢" },
  { who: "Vampire", c: "assistant", text: "祝旅途愉快 🦇 需要随时叫我" },
  { who: "系统", c: "system", text: "本轮 3 工具调用 · 1.2k tokens · ¥0.01" },
];

const MD_SAMPLE = `# 角色卡：Vampire

**Maou** 是一个 *prompt-first* 的 AI Agent，支持 \`工具调用\` 与多模型切换。

## 核心能力
- 🩸 多 LLM provider（<b>25+</b> 厂商）
- 🦇 工具系统 <i>完全可插拔</i>
- 🌙 文档见 [SDK](https://example.com)

> 设计原则：插件就该长成插件的样子。

\`\`\`ts
const r = await complete(model, { messages });
\`\`\`

普通段落里也能混 ~~删除线~~ 和 <code>行内码</code>。`;

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

export function Demo() {
  const { exit } = useApp();
  const term = useTerminalSize();
  const [page, setPage] = useState(0);
  const [frame, setFrame] = useState(0);
  const [angle, setAngle] = useState(0);
  const [wireModel, setWireModel] = useState<"crystal" | "cube">("crystal");
  const [input, setInput] = useState("点这行→中文abc混排定位");
  const [cursor, setCursor] = useState(0);
  const [imgMode, setImgMode] = useState<"block" | "braille" | "ramp" | "half">("block");
  const [lastMouse, setLastMouse] = useState("（还没事件）");
  const [themeName, setThemeName] = useState("vampire");
  const [mouseOn, setMouseOn] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [focusIdx, setFocusIdx] = useState(0);
  const store = useStore();
  const t = currentTheme;
  const img = ensureTestImage();
  const chat = useScroll(TRANSCRIPT.length, 9);

  useEffect(() => {
    const id = setInterval(() => { setFrame((f) => f + 1); setAngle((a) => a + 0.12); }, 90);
    return () => clearInterval(id);
  }, []);

  // 鼠标（默认关；按 ` 开启）。关闭时终端原生拖选复制可用。
  useMouse(mouseOn, (e) => {
    setLastMouse(`${e.type} @ 列${e.col} 行${e.row} 键${e.button}`);
    if (page === 12 && e.type === "down") {
      const rel = Math.max(0, e.col - 8); // 估算输入框文本起始列
      setCursor(colToCharIndex(input, rel));
    }
    if (page === 9) {
      if (e.type === "wheelUp") chat.scrollBy(-1);
      if (e.type === "wheelDown") chat.scrollBy(1);
    }
  });

  // demo 静态消息
  useEffect(() => {
    if (store.messages.length === 0) {
      useStore.setState({
        messages: [
          { id: "1", role: "user", content: "帮我看看天气，然后算 2+3", ts: 0 },
          { id: "2", role: "assistant", content: "好的，我来查天气并计算。", thinking: "用户想要天气+计算，调用 weather 和 add…", toolCalls: [
            { id: "t1", name: "get_weather", args: '{"city":"上海"}', result: "晴 26°C", done: true },
            { id: "t2", name: "add", args: '{"a":2,"b":3}', result: "5", done: true },
          ], usage: { input: 120, output: 45, cost: 0.0012 }, ts: 0 },
        ] as any,
      });
    }
  }, []);

  useCleanInput((char, key) => {
    if (store.modal) return;
    if (char === "q" || (key.ctrl && char === "c")) { exit(); return; }
    if (char === "`") return setMouseOn((m) => !m);
    if (key.rightArrow || char === "n") return setPage((p) => (p + 1) % PAGES.length);
    if (key.leftArrow || char === "p") return setPage((p) => (p - 1 + PAGES.length) % PAGES.length);
    const num = "1234567890".indexOf(char);
    if (char && num >= 0) return setPage(num);
    // —— 页内交互 ——
    if (page === 4 && char === "m") setWireModel((w) => (w === "crystal" ? "cube" : "crystal"));
    if (page === 6 && char === "m") setImgMode((m) => (m === "block" ? "braille" : m === "braille" ? "ramp" : m === "ramp" ? "half" : "block"));
    if (page === 9) { if (key.upArrow) chat.scrollBy(-1); if (key.downArrow) chat.scrollBy(1); }
    if (page === 10 && (char === "c" || char === " ")) setSidebarOpen((s) => !s);
    if (page === 11 && key.tab) setFocusIdx((f) => (f + 1) % 3);
    if (page === 12 && char && !key.ctrl && !key.tab && !key.return) {
      if (key.backspace || key.delete) { if (cursor > 0) { setInput((v) => v.slice(0, cursor - 1) + v.slice(cursor)); setCursor((c) => c - 1); } }
      else { setInput((v) => v.slice(0, cursor) + char + v.slice(cursor)); setCursor((c) => c + 1); }
    }
    if (page === 13) {
      if (char === "k") return store.setModal("command");
      if (char === "o") return store.setModal("model");
      if (char === "h") return store.setModal("help");
    }
    if (page === 15 && char === "t") { const names = Object.keys(THEMES); const next = names[(names.indexOf(currentTheme.name) + 1) % names.length]!; setTheme(next); setThemeName(next); }
  });

  const Check = ({ children }: { children: React.ReactNode }) => <Text color={t.status.ok}>  ✓ {children}</Text>;
  const Hint = ({ children }: { children: React.ReactNode }) => <Text color={t.dim}>{children}</Text>;

  return (
    <Box flexDirection="column" minHeight={28}>
      {/* 顶栏 */}
      <Box justifyContent="space-between" paddingX={1}>
        <GradientText bold>{`⚔ Maou CLI 功能验收 [${page + 1}/${PAGES.length}]`}</GradientText>
        <Text>
          <Text color={mouseOn ? t.status.ok : t.dim}>🖱 {mouseOn ? "ON" : "OFF"}</Text>
          <Text color={t.dim}> ` 切 · {term.cols}×{term.rows} · q 退</Text>
        </Text>
      </Box>

      <Box borderStyle="round" borderColor={t.border} flexDirection="column" paddingX={1} flexGrow={1} marginX={1}>
        <Box marginBottom={1}><Text color={t.role.assistant} bold>{PAGES[page]}</Text></Box>

        {page === 0 && (
          <Box flexDirection="column">
            <Hint>断点: <Text color={t.accent}>{term.breakpoint}</Text> · 侧栏:{term.showSidebar ? "显示" : "折叠"} · HUD:{term.showHud ? "显示" : "折叠"}（缩放终端看变化）</Hint>
            <Box height={9} marginTop={1}>
              {term.showSidebar && (
                <Panel title="侧栏" icon="☰" width={14} focused>
                  <Text color={t.fg}>✦ 新对话</Text>
                  <Text color={t.fg}>◆ 选模型</Text>
                  <Text color={t.fg}>⚡ 命令</Text>
                </Panel>
              )}
              <Panel title="对话" icon="✦" flexGrow={1}>
                <Text color={t.fg}>中间主区（flex 自适应宽度）</Text>
                <Text color={t.dim}>窄屏时侧栏/HUD 自动让位</Text>
              </Panel>
              {term.showHud && (
                <Panel title="HUD" icon="❖" width={20}>
                  <Gauge label="HP" value={7} max={10} width={10} />
                  <Gauge label="MP" value={4} max={10} width={10} color={t.spark[2]} />
                </Panel>
              )}
            </Box>
            <Check>三栏布局随终端宽度断点重排（响应式底层 useTerminalSize）</Check>
          </Box>
        )}

        {page === 1 && (
          <Box flexDirection="column">
            <Gauge label="HP" value={9} max={10} width={24} />
            <Gauge label="MP" value={5} max={10} width={24} color={t.spark[2]} />
            <Gauge label="EXP" value={3} max={10} width={24} color={t.status.ok} />
            <Gauge label="危险" value={9} max={10} width={24} />
            <Box marginTop={1}><Check>血条按比例填充，超 85% 自动变红（看"危险"行）</Check></Box>
          </Box>
        )}

        {page === 2 && (
          <Box flexDirection="column">
            <Spark values={[1,3,2,5,4,7,3,8,5,9,6,4,10,7,5,11,8,6,9]} width={40} height={12} label="Token 历史（盲文亚像素曲线）" />
            <Box marginTop={1}><Check>盲文曲线随数值起伏，彩色渐变 + 曲线下填充</Check></Box>
          </Box>
        )}

        {page === 3 && (
          <Box flexDirection="column">
            <Hint>逐字渐变文本：</Hint>
            <GradientText bold>{"████  Maou Vampire Agent  渐变流光标题  ████"}</GradientText>
            <Box marginTop={1}><Hint>横向渐变条：</Hint></Box>
            <GradientBar width={40} />
            <GradientBar width={40} stops={["#22d3ee", "#a78bfa", "#f43f5e"]} />
            <Box marginTop={1}><Hint>竖向渐变块 + 对角渐变场：</Hint></Box>
            <Box>
              <GradientBlock width={10} height={5} />
              <Box marginLeft={2}><GradientField width={18} height={5} /></Box>
            </Box>
            <Box marginTop={1}><Check>逐字/横条/竖块/对角四种渐变填充（truecolor 插值）</Check></Box>
          </Box>
        )}

        {page === 4 && (
          <Box flexDirection="column">
            <Box justifyContent="center"><Wireframe angle={angle} model={wireModel} width={20} height={10} /></Box>
            <Box marginTop={1}><Hint>当前: <Text color={t.accent}>{wireModel}</Text> · 按 <Text color={t.accent} bold>m</Text> 切换立方体/水晶</Hint></Box>
            <Check>3D 线框实时旋转（盲文画线 + 透视投影）</Check>
          </Box>
        )}

        {page === 5 && (
          <Box flexDirection="column">
            <AsciiArt color={t.accent} lines={["  /\\_/\\  ", " ( o.o ) ", "  > ^ <  ", " MAOU AI "]} />
            <Box marginTop={1}>
              <AsciiArt lines={["████", "▓▓▓▓", "▒▒▒▒", "░░░░"]} colors={[["#f43f5e","#fb7185","#fb923c","#fbbf24"],["#c026d3","#e879f9","#a78bfa","#818cf8"],["#06b6d4","#22d3ee","#67e8f9","#a5f3fc"],["#34d399","#6ee7b7","#a7f3d0","#d1fae5"]]} />
            </Box>
            <Box marginTop={1}><Check>2D 字符画 + 逐字 truecolor 着色</Check></Box>
          </Box>
        )}

        {page === 6 && (
          <Box flexDirection="column">
            <Hint>图片→ASCII，模式: <Text color={t.accent}>{imgMode}</Text> · 按 <Text color={t.accent} bold>m</Text> 切 block/braille/ramp/half</Hint>
            <Box marginTop={1}>
              <AsciiArt {...asciiFromImage(img, { width: imgMode === "braille" ? 20 : 30, mode: imgMode, color: true })} />
            </Box>
            <Box marginTop={1}><Check>渐变圆 PNG 转字符画（4 模式 + truecolor 保留原色）</Check></Box>
          </Box>
        )}

        {page === 7 && (
          <Box flexDirection="column">
            <Box borderStyle="round" borderColor={t.borderSoft} paddingX={1} flexDirection="column">
              <Markdown source={MD_SAMPLE} width={Math.min(60, term.cols - 8)} />
            </Box>
            <Box marginTop={1}><Check>标题/列表/代码块/引用/粗斜/删除线/链接 + 内联 HTML(&lt;b&gt;&lt;i&gt;&lt;code&gt;)</Check></Box>
          </Box>
        )}

        {page === 8 && (
          <Box flexDirection="column">
            {store.messages.map((m) => <Message key={m.id} msg={m} frame={frame} />)}
            <Check>用户/助手分色 · 思考💭 · 工具卡片(✓) · token 统计</Check>
          </Box>
        )}

        {page === 9 && (
          <Box flexDirection="column">
            <Hint>↑↓ 或滚轮（需开鼠标 `）滚动 · 右侧滚动条随位置移动 · {chat.offset + 1}-{Math.min(TRANSCRIPT.length, chat.offset + 9)}/{TRANSCRIPT.length}</Hint>
            <Box marginTop={1}>
              <ScrollView height={9} offset={chat.offset} contentHeight={TRANSCRIPT.length} width={Math.min(64, term.cols - 8)}>
                {TRANSCRIPT.map((m, i) => (
                  <Text key={i} color={m.c === "user" ? t.role.user : m.c === "assistant" ? t.role.assistant : t.dim}>
                    {m.c === "user" ? "▶" : m.c === "assistant" ? "✦" : "⚙"} {m.who}: {m.text}
                  </Text>
                ))}
              </ScrollView>
            </Box>
            <Box marginTop={1}><Check>固定视口裁剪 + 负偏移滚动 + 滚动条滑块（真滚动，非截断）</Check></Box>
          </Box>
        )}

        {page === 10 && (
          <Box flexDirection="column">
            <Hint>按 <Text color={t.accent} bold>c</Text> 或 <Text color={t.accent} bold>空格</Text> 折叠/展开侧栏（带滑动动画）· 侧栏:{sidebarOpen ? "展开" : "收起"}</Hint>
            <Box height={8} marginTop={1}>
              <Collapsible open={sidebarOpen} size={18} axis="x">
                <Box borderStyle="round" borderColor={t.accent} flexDirection="column" paddingX={1} width={18}>
                  <Text color={t.accent} bold>☰ 菜单</Text>
                  <Text color={t.fg}>✦ 新对话</Text>
                  <Text color={t.fg}>◆ 模型</Text>
                  <Text color={t.fg}>⚡ 命令</Text>
                  <Text color={t.fg}>⚙ 设置</Text>
                </Box>
              </Collapsible>
              <Box borderStyle="round" borderColor={t.border} flexGrow={1} paddingX={1} marginLeft={sidebarOpen ? 0 : 0}>
                <Text color={t.fg}>主区域：侧栏收起时我会自动占满宽度</Text>
              </Box>
            </Box>
            <Check>折叠/展开有缓动动画（useTween + overflow 裁剪）</Check>
          </Box>
        )}

        {page === 11 && (
          <Box flexDirection="column">
            <Hint>按 <Text color={t.accent} bold>Tab</Text> 切换焦点 · 聚焦框边框<Text color={t.accent}>流光呼吸</Text> + 双线 · 当前焦点: {focusIdx + 1}/3</Hint>
            <Box marginTop={1} height={6}>
              {[0, 1, 2].map((i) => (
                <Box key={i} marginRight={1} flexGrow={1}>
                  <FocusFrame focused={focusIdx === i} frame={frame} title={`面板 ${i + 1}`} flexGrow={1}>
                    <Text color={t.fg}>{focusIdx === i ? "★ 已聚焦" : "未聚焦"}</Text>
                    <Text color={t.dim}>Tab 移动</Text>
                  </FocusFrame>
                </Box>
              ))}
            </Box>
            <Check>焦点可视化：边框颜色沿渐变流动 + 圆角↔双线切换</Check>
          </Box>
        )}

        {page === 12 && (
          <Box flexDirection="column">
            <Hint>{mouseOn ? "鼠标已开：点击输入框任意字符，光标跳过去" : "按 ` 开启鼠标后可点击定位（关闭时可拖选复制）"}</Hint>
            <Box marginTop={1}><InputBox value={input} cursor={cursor} focused /></Box>
            <Box marginTop={1}><Hint>光标字符索引 <Text color={t.accent}>{cursor}</Text>（中文占 2 列，点击宽字符感知对齐）· ←→ 移动也可</Hint></Box>
            <Check>点击列→字符索引（宽字符感知）· 也可直接打字编辑</Check>
          </Box>
        )}

        {page === 13 && (
          <Box flexDirection="column">
            <Text color={t.fg}>按键打开不透明弹窗（带投影、不透底）：</Text>
            <Box marginTop={1} flexDirection="column">
              <Text><Text color={t.accent} bold>  k</Text><Text color={t.fg}> = 命令面板（模糊搜索）</Text></Text>
              <Text><Text color={t.accent} bold>  o</Text><Text color={t.fg}> = 模型选择器（↑↓ + 搜索）</Text></Text>
              <Text><Text color={t.accent} bold>  h</Text><Text color={t.fg}> = 帮助快捷键表</Text></Text>
            </Box>
            <Box marginTop={1}><Check>弹窗每格填底色 + 投影 —— 不再透出背后内容（修复项）</Check></Box>
          </Box>
        )}

        {page === 14 && (
          <Box flexDirection="column">
            <Text color={t.fg}>{mouseOn ? "点击/滚动屏幕任意处，下面实时显示：" : "按 ` 开启鼠标，再点击/滚动查看事件："}</Text>
            <Box marginTop={1} borderStyle="round" borderColor={t.accent} paddingX={1}>
              <Text color={t.role.toolResult}>最近事件: {lastMouse}</Text>
            </Box>
            <Box marginTop={1}><Check>SGR 鼠标：点击/释放/滚轮坐标实时解析（1000 模式，不抢拖选）</Check></Box>
          </Box>
        )}

        {page === 15 && (
          <Box flexDirection="column">
            <Box>
              <Text color={t.fg}>Spinner: </Text><Spinner frame={frame} />
              <Text color={t.fg}>   Pulse: </Text><Spinner frame={frame} kind="pulse" />
              <Text color={t.fg}>   表情: </Text><Text color={t.role.assistant} bold>{store.expression}</Text>
            </Box>
            <Box marginTop={1}><Hint>主题: <Text color={t.accent}>{themeName}</Text> · 按 <Text color={t.accent} bold>t</Text> 切 vampire/cyber（全局换色）</Hint></Box>
            <Box marginTop={1}><GradientBar width={36} /></Box>
            <Box marginTop={1}><Gauge label="预览" value={frame % 11} max={10} width={20} /></Box>
            <Check>动画 spinner · 表情 · 主题切换全局换色（连渐变/血条一起变）</Check>
          </Box>
        )}

        {page === 16 && (
          <Box flexDirection="column">
            <Text color={t.role.assistant} bold>验收清单（逐页验过打勾）：</Text>
            <Box flexDirection="column" marginTop={1}>
              {PAGES.slice(0, 16).map((p, i) => <Text key={i} color={t.fg}>  □ {p}</Text>)}
            </Box>
            <Box marginTop={1}><Text color={t.status.ok}>全部验过 = RPG 风 TUI 完整度达标 ✦</Text></Box>
            <Hint>真实聊天请跑 `pnpm dev`（需配 ~/.maou/llm-config.json）</Hint>
          </Box>
        )}
      </Box>

      {/* 页码点 */}
      <Box paddingX={1}>
        <Text color={t.dim}>页面 </Text>
        {PAGES.map((_, i) => <Text key={i} color={i === page ? t.accent : t.dim}>{i === page ? "●" : "·"}</Text>)}
      </Box>

      {store.modal === "model" && <ModelPicker />}
      {store.modal === "command" && <CommandPalette onRun={() => store.setModal(null)} />}
      {store.modal === "help" && <HelpModal />}
    </Box>
  );
}

if (process.env.MAOU_DEMO_TEST !== "1") {
  process.stdout.write("\x1b[?1049h\x1b[H");
  const { waitUntilExit } = render(<Demo />, { exitOnCtrlC: false });
  waitUntilExit().then(() => {
    process.stdout.write("\x1b[?1006l\x1b[?1000l\x1b[?1049l");
  });
}
