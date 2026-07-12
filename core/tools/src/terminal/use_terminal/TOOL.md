## 使用指引

- 不指定 id 为临时终端（执行完即销毁），指定 id 为持久终端（可反复操作）。
- 常驻终端适合需要保持状态的场景：dev server、watch 模式、REPL 等。
- command 中的路径含空格时必须用引号包裹。
- timeout 默认 120 秒，长任务设 background=true 避免超时。
- 前台超时会自动转后台，不会丢失进程。
- result_limit 控制返回内容长度，大输出建议设小值（如 2000），避免 token 浪费。
- manage_action=list 查看所有终端，manage_action=logs 查看后台终端输出。
- 不要用终端执行文件读写操作——有专门的阅读工具/write_file/edit_file 工具。

### 安全（统一模块 `src/security/`）

通用操作安全集中在 **`@little-house-studio/tools` → `src/security/`**（见该目录 `README.md`），本工具只调用 `gateTerminalCommand`。

| 层级 | 行为 | 来源 |
|------|------|------|
| **致命 fatal** | 永久硬拦 | `hard-deny` + DCG 灾难规则（reset-hard / 磁盘…） |
| **危险 dangerous** | 用户/审核/相同命令再执行一次 | DCG 其它 deny + `local-rules`（docker prune、DROP TABLE…） |
| **安全 safe** | 放行 / 普通 ask | DCG allow + 产物白名单 |

环境变量：`MAOU_DCG_PATH`、`MAOU_DCG_PACKS`、`MAOU_DCG_STRICT=1`、`MAOU_DCG_BYPASS=1`。  
安装：`node scripts/ensure-dcg.mjs`。
