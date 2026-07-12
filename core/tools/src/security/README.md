# 操作安全（Security）

通用「终端/命令操作安全」集中在此目录，避免散落在 `terminal/` 各文件。

## 结构

```
security/
  index.ts                 # 对外 API
  types.ts                 # SecurityTier 等
  gate.ts                  # 三层门禁评估与放行决策
  hard-deny.ts             # 致命硬拦（fork bomb / 关机 / curl|sh / dd…）
  local-rules.ts           # 补 DCG 默认未开 pack 的资产风险（docker/k8s/db/云…）
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
4. DCG deny → 映射 fatal/dangerous  
5. DCG allow → **local-rules**（补资产/供应链）  
6. safe → **approval**（白名单 / ask / auto / yolo）  

执行层（PTY 路径沙箱、自定义 filter）在 `terminal-engine`，不混入本目录。

## 领域特例（允许解耦）

- 某 skill 清理自己的临时目录  
- 浏览器/文件工具的 `safePath`  
- 写在对应工具旁，不要塞进 `local-rules`  

## 残留风险（审计备忘）

见同目录维护时同步更新 `AUDIT.md` 或下方「已知缺口」。

### 已知残余风险

| 风险 | 状态 |
|------|------|
| 写脚本再 `bash script.sh` 绕过 SERP 扫描 | 残余：DCG heredoc 管 `bash -c`，不管文件内脚本 |
| `rimraf` / `rm -r`（无 f） | 故意未当 fatal；可走 dangerous 若扩展 |
| 默认未开 DCG docker/db pack | 已用 **local-rules** 覆盖常见 prune/destroy/DROP |
| 文件工具写敏感路径 | 依赖 `safePath` 项目根限制，非命令安全 |
| 泄露密钥到 stdout/日志 | 部分 curl -H 规则；无法覆盖所有 exfil |
| `MAOU_DCG_BYPASS=1` | 人为旁路 |
| 引擎层 filter 预设默认关 | 主策略在 TS security；引擎仅 sandbox+自定义 |
