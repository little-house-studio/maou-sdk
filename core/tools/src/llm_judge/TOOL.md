## 使用指引

- 让辅助 LLM 在主循环中做独立判断：安全检查、代码审查、路由判定、二次确认等。
- 辅助模型与主模型分离，独立 token 统计，不污染主调用上下文——主模型「自己审自己」会有确认偏误，llm_judge 用独立模型审更客观。
- `question` 必填，写清判断条件；`context` 可选，给待审查的代码/命令/方案列表等。
- `format` 默认 text（自由文本判断）；需要结构化结论（如 `{ safe: true, reason }`）时用 json。
- 适用：关键决策点 sanity check、方案路由（A/B 选哪个）、安全审查、自我代码审查；不适合复杂推理（仍由主模型自己做）。
- 辅助模型通常更小更快，做轻量判断；复杂分析请主模型自己做或用更专门的工具（如 code-review skill）。
- 未注入 AuxModelCaller 时工具返回未启用提示；runtime 需配置 `RuntimeOptions.auxModelCaller`。
