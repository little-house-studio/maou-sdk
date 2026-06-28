## 使用指引

- find_code 是代码结构搜索，不是文本搜索。搜文本用 grep。
- 常用 action：
  - search：按名称搜符号（函数、类、变量等）
  - callers：谁调用了这个函数/方法
  - callees：这个函数/方法调用了谁
  - path：两个符号之间的调用链
  - impact：修改某符号会影响哪些代码
  - unused：查找未被引用的代码
- symbol 支持正则匹配，不确定全名时用部分名称搜索。
- 符号名有歧义时（多个文件定义了同名函数），用 in_file 指定文件路径消歧。
- kind 过滤符号类型：function/class/method/interface 等，缩小搜索范围。
- depth 控制调用关系搜索深度，默认值通常够用，太深会返回过多结果。
