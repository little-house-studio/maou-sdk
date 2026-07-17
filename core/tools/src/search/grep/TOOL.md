## 使用指引

- pattern 使用正则表达式（ripgrep 语法），特殊字符需转义：`\.` `\(` `\)` `\{` 等。
- **默认 output_mode=content**：返回 `文件:行号:匹配行`（可加 context）。不要默认只用 files_with_matches。
- 仅当只需「哪些文件命中」时再设 `output_mode=files_with_matches`；计数用 `count`。
- 常用场景：搜函数定义 `function\s+\w+`、搜 import `import.*from`、搜 TODO `TODO|FIXME`。
- 用 glob 限定文件类型可大幅减少噪音：`glob: "*.ts"` 只搜 TypeScript。
- **默认已排除** `node_modules` / `dist` / `.git` / `build` 等；一般不需要再手动 path 排除。
- 想缩小范围仍建议 `path: client/src` 或 `glob: "src/**/*.ts"`。
- ignore_case=true 适合搜变量名（大小写不统一的场景）。
- head_limit 默认 250，结果多时调大，但注意返回内容可能很长。
- grep 搜文本内容，不搜代码结构（调用关系、类继承等）。搜结构用 find_code。
