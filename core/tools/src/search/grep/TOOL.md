## 使用指引

- pattern 使用正则表达式（ripgrep 语法），特殊字符需转义：`\.` `\(` `\)` `\{` 等。
- 常用场景：搜函数定义 `function\s+\w+`、搜 import `import.*from`、搜 TODO `TODO|FIXME`。
- 用 glob 限定文件类型可大幅减少噪音：`glob: "*.py"` 只搜 Python 文件。
- ignore_case=true 适合搜变量名（大小写不统一的场景）。
- head_limit 默认 50，结果多时调大，但注意返回内容可能很长。
- grep 搜文本内容，不搜代码结构（调用关系、类继承等）。搜结构用 find_code。
