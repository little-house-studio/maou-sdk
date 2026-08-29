## 使用指引

- 不指定 id 为临时终端（执行完即销毁），指定 id 为持久终端（可反复操作）。
- **每次调用必填 `description`（任务简介）**：一句话说明这次在干什么；CLI 折叠标题只显示它。`reason` 是「为什么必须用工具」。
- `background=false`（默认）：阻塞等待命令结束（成功或失败进程即停）。`timeout` 是这次等待的上限（默认 120s）；到点还在跑则转后台并带回当前输出，下一轮会带上结束结果。
- `background=true`：立刻后台，不阻塞；建议带 `id` 方便 logs/stop。
- 等某行日志再返回：`return_when=until` + `match`/`expr`。
- 仍在跑时可用 `manage stop` 打断。
- 每次 use_terminal 返回末尾会附带 **── 终端状态 ──** 快照（运行中 / 已结束），不必先 manage list。
- command 中的路径含空格时必须用引号包裹。Unix 用 `$HOME`、`/tmp`；Windows 上本工具走原生 PowerShell，用 `$env:USERPROFILE`、`C:\Users\…`，不要调用 `wsl.exe`。
- result_limit 控制返回内容长度，大输出建议设小值（如 2000），避免 token 浪费。
- manage_action=list 查看全表；logs / stop / rm 操作指定 id。
- 列表为空时仍会说明原因（临时任务销毁、其它 agent 终端等）。
- 不要用终端执行文件读写操作——有专门的阅读工具/write_file/edit_file 工具。

### 条件返回（return_when + Python expr）

挂在 `run` 的命令输出上，不是扫文件。用正则 + 短 Python 表达式，命中即返回。

| 参数 | 含义 |
|------|------|
| `return_when` | `filter` 筛出所有命中行；`until` 第一次命中即返回 |
| `match` | 可选正则；命中时 `m` 为 Match，否则 `None` |
| `expr` | 受限 Python 表达式，可用 `line` / `n` / `re` / `m` |
| `keep_running` | until 命中后是否保留进程（默认 true） |
| `timeout` | until 默认 3600s 上限；filter 跑命令默认 120s |
| `context_lines` / `max_hits` | 上下文行数 / filter 条数上限 |

表达式约定：

- 仅表达式（禁止 import/赋值/打开文件）
- 例：`m is not None and 2 < int(m.group(1)) < 5`
- 仅 match 时默认 expr 为 `m is not None`
- 子串：`"ERROR" in line`

示例：

```json
// 等到 A= 非 0
{"action":"run","command":"python debug.py","return_when":"until","match":"A\\s*=\\s*(\\d+)","expr":"m is not None and int(m.group(1)) > 0","timeout":3600,"reason":"等信号"}
```


### 安全（统一模块 `src/security/`）

通用操作安全集中在 **`@little-house-studio/tools` → `src/security/`**（见该目录 `README.md`），本工具只调用 `gateTerminalCommand`。

| 层级 | 行为 | 来源 |
|------|------|------|
| **致命 fatal** | 永久硬拦 | `hard-deny` + DCG 灾难规则（reset-hard / 磁盘…） |
| **危险 dangerous** | 用户/审核/相同命令再执行一次 | DCG 其它 deny + `local-rules`（docker prune、DROP TABLE…） |
| **安全 safe** | 放行 / 普通 ask | DCG allow + 产物白名单 |

环境变量：`MAOU_DCG_PATH`、`MAOU_DCG_PACKS`、`MAOU_DCG_STRICT=1`、`MAOU_DCG_BYPASS=1`。  
安装：`node scripts/ensure-dcg.mjs`。
