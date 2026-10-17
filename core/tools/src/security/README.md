# 操作安全（Security）

通用「终端/命令操作安全」集中在此目录，避免散落在 `terminal/` 各文件。

## 结构

```
security/
  index.ts                 # 对外 API
  types.ts                 # SecurityTier 等
  gate.ts                  # 三层门禁评估与放行决策
  hard-deny.ts             # 致命硬拦（DCG 现有 pack 仍 allow 的关机/重启）
  local-rules.ts           # DCG 现有 pack 仍 allow 的缺口（命令行明文 Authorization）
  dcg/
    client.ts              # DCG 子进程适配（必要依赖）
    safe-allow.ts          # 开发向安全操作白名单（rm -rf dist 等）
  approval/
    terminal-policy.ts     # 用户白/黑名单 + normal/auto/yolo + 二次确认窗口
```

## 三层模型

| 层 | 行为 |
|----|------|
| **fatal** | 永久拒绝。不可 yolo、不可二次执行、不可用户白名单。 |
| **dangerous** | 需确认：UI / 审核 Agent / 10 分钟内相同命令再执行一次。 |
| **safe** | 放行；未知命令仍可走 ask/auto。 |

## 评估顺序（gate）

1. `MAOU_DCG_BYPASS` / `DCG_BYPASS`（旁路，生产慎用）
2. **hard-deny** → fatal  
3. **DCG**（+ safe-allow 升 safe）  
4. DCG deny → critical=fatal，其余=dangerous
5. DCG allow → **local-rules**（现有 pack 仍 allow 的缺口）  
6. safe → **approval**（白名单 / ask / auto / yolo）  

评测默认额外启用的官方 pack 见 `DEFAULT_DCG_EXTRA_PACKS`（`MAOU_DCG_PACKS` / `DCG_PACKS` 可覆盖）。`DCG_PACKS` 叠加默认 `core.filesystem` / `core.git` / `system.disk`。

执行层（PTY 路径沙箱、自定义 filter）在 `terminal-engine`，不混入本目录。

## 领域特例（允许解耦）

- 某 skill 清理自己的临时目录  
- 浏览器/文件工具的 `safePath`  
- 写在对应工具旁  

## 残留风险（审计备忘）

| 风险 | 状态 |
|------|------|
| 写脚本再 `bash script.sh` 绕过 SERP 扫描 | 残余：DCG heredoc 管 `bash -c`，不管文件内脚本 |
| `rimraf` / `rm -r`（无 f） | 故意未当 fatal；可走 dangerous 若扩展 |
| `poetry publish` / `twine upload` | DCG `package_managers` 对 poetry 因 keyword gate 未命中；无 twine 规则 |
| 文件工具写敏感路径 | 依赖 `safePath` 项目根限制，非命令安全 |
| `MAOU_DCG_BYPASS=1` | 人为旁路 |
| 引擎层 filter 预设默认关 | 主策略在 TS security；引擎仅 sandbox+自定义 |
