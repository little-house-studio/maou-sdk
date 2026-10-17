## 使用指引

- 不指定 id 为临时终端（执行完即销毁）。指定 id 仅用于「命名 + 日志/管理定位」，**每次调用都是新 shell，不保留上一轮的 cd / export 等状态**；需要复用会话状态请把命令写在同一次调用里（如 `cd /tmp && export X=1 && …`）。
- **每次调用必填 `description`（任务简介）**：一句话说明这次在干什么；CLI 折叠标题只显示它。`reason` 是「为什么必须用工具」。
- `background=false`（默认）：阻塞等待命令结束（成功或失败进程即停）。`timeout` 是这次等待的上限（默认 120s）；到点还在跑则转后台并带回当前输出，下一轮会带上结束结果。
- `background=true`：立刻后台，不阻塞；建议带 `id` 方便 logs/stop。
- 等某行日志再返回：`return_when=until` + `match`/`expr`。`id` 正在运行时才可省略 `command` 挂到该任务输出；任务已结束时请用 `manage logs id=…` 看结果。
- 仍在跑时可用 `manage stop` 打断；对已结束任务 stop 不会改变其 exited 状态。
- 给交互式程序（input/prompt/REPL）发输入用 `action=write`，**通常要以 `\n` 结尾**（如 `"y\n"`）进程才会提交；`"\x03"` 表示 Ctrl+C。
- 每次 use_terminal 返回末尾会附带 **── 终端状态 ──** 快照（运行中 / 已结束），不必先 manage list。
- command 中的路径含空格时必须用引号包裹。Unix 用 `$HOME`、`/tmp`；Windows 上本工具走原生 PowerShell，用 `$env:USERPROFILE`、`C:\Users\…`，不要调用 `wsl.exe`。
- `result_limit` 控制返回行数，默认 200。采集/落盘最多 256KiB（超了留尾巴）。全文落到会话旁文件，页脚给出路径；过几轮微压后只留这条路径。
- manage_action=list 查看全表；logs / stop / rm 操作指定 id。
- 列表为空时仍会说明原因（临时任务销毁、其它 agent 终端等）。
- 不要用终端执行文件读写操作——有专门的阅读工具/write_file/edit_file 工具。

### 条件返回（return_when + Python expr）

挂在命令输出上（新开，或已有后台 `id`），不是扫文件。用正则 + 短 Python 表达式，命中即返回。

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

// 挂到已有后台 build，等到 DONE
{"action":"run","id":"build","return_when":"until","match":"DONE","reason":"等后台结束"}
```


### 安全（统一模块 `src/security/`）

通用操作安全集中在 **`@little-house-studio/tools` → `src/security/`**（见该目录 `README.md`），本工具只调用 `gateTerminalCommand`。

| 层级 | 行为 | 来源 |
|------|------|------|
| **致命 fatal** | 永久硬拦 | `hard-deny`（关机/重启）+ DCG critical deny |
| **危险 dangerous** | 用户/审核/相同命令再执行一次 | DCG 非 critical deny + 残留 `local-rules` |
| **安全 safe** | 放行 / 普通 ask | DCG allow + 产物白名单 |

环境变量：`MAOU_DCG_PATH`、`MAOU_DCG_PACKS`、`MAOU_DCG_STRICT=1`、`MAOU_DCG_BYPASS=1`。  
安装：`node scripts/ensure-dcg.mjs`。
