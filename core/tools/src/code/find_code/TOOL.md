## 使用指引

- find_code 是**代码结构**搜索（符号 / 调用关系），不是文本搜索。搜文本用 grep。
- 常用 action：
  - search：按名称搜符号（函数、类、变量等）
  - callers：谁调用了这个函数/方法
  - callees：这个函数/方法调用了谁
  - path：两个符号之间的调用链
  - impact：修改某符号会影响哪些代码
  - unused：查找未被引用的代码
  - explain / hierarchy / subgraph / cycles / duplicates：解释、层级、局部图、循环、重复代码
- symbol 支持正则匹配，不确定全名时用部分名称搜索；精确名用 exact=true。
- 符号名有歧义时（多个文件定义了同名函数），用 in_file 指定文件路径消歧。
- kind 过滤符号类型：function/class/method/interface 等，缩小搜索范围。
- lang 过滤语言：可用 `typescript` / `ts`、`javascript` / `js`、`python` / `py` 等。
- depth 控制调用关系搜索深度，默认值通常够用，太深会返回过多结果。
- 依赖本机已安装 `sqry`（`cargo install sqry`），首次会在项目根构建 `.sqry` 索引。
