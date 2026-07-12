## 使用指引

### 做什么
- 实时互联网搜索（**全免费、开箱即用**，无需付费 API Key）。
- 管线：多源 SERP 合并 → 粗排 → 正文/摘要增强 → 可答题重排 → `[n]/url/Content/L1` 输出。
- 质量对标与实验见 `docs/SEARCH_QUALITY_REPORT.md`。
- **优先采信** Content/L 行里结构完整的释义/文档句；短视频话题页仅旁证。

### 数据源（均免费）
1. **垂直 API**（`category` 触发）：GitHub / npm / MDN / SO / Arxiv / HN / Wikipedia / News RSS…
2. **通用引擎**（**不禁止 ddgr**，欢迎安装以提升质量）：
   - 顺序：`ddgr` → `ddg-lite` → `bing`（中文自动 `cn.bing.com`）→ `ddg-instant`
   - `ddgr` 是可选外部 CLI（`brew install ddgr` / `pip install ddgr`），**不是** npm 依赖
   - 未安装 / 执行失败 = `unavailable`：**跳过该引擎，并在返回文案里明确告诉 AI「缺什么、怎么装」**，禁止静默吞掉
3. **降级规则（硬性）**：
   - 只有引擎**可用且查询成功、结果为 0 条**（`empty`）才试下一个
   - `unavailable` ≠ 搜空：不假装搜过，但必须把安装/修复提示写进 tool message
4. 排序层：URL 归一化、噪声域过滤、可信域加权、相关度门控、时效衰减

### 参数
| 参数 | 必填 | 说明 |
|------|------|------|
| `query` | 是 | 主搜索词，短而具体 |
| `sub_queries` | 否 | 最多 4 个并发子查询，复杂问题必拆 |
| `time` | 强烈建议 | `d`/`w`/`m`/`y`；要「最新」用 `d` 或 `w` |
| `category` | 建议 | 技术用 `coding`；资讯用 `news`；不确定用 `general` |
| `reason` | 否 | 为何联网 |
| `max_results` | 否 | 默认 10，最大 15 |

### 可靠性与时效（系统已做）
1. **整词/反头词（硬）**：多字中文主体必须命中足够覆盖率的连续实体；**禁止**「巧乐兹火车头」变成词典「巧」字页。数字黑话（飞8分钱）只在 title/snippet 判命中，支持「八↔8」，禁止 URL 数字误命中、禁止串到「让子弹飞分钱」。
2. **头词塌缩救援**：Bing bot 对部分「巧*」query 会整页塌成字典——检测后自动 `site:bilibili/zhihu` 二次检索 + 搜狗备援；360 遇 captcha 标 unavailable 不假搜空。
3. **长梗分层**：全文实体=满分；前缀品牌（≥3 字，如只有「巧乐兹」）=弱分可保留；1～2 字头词/字典页=硬丢。
4. **中文多源**：Bing 引号整词变体 + 搜狗 + 360 so.com + 百度（反爬时跳过）。
5. **URL 归一化 / 释义增强 / empty 才降级**：同前；unavailable 写明安装/修复提示。

### 可选环境变量（免费）
```bash
# 可选：提高 GitHub Search 未认证限流（个人 token，非付费搜索服务）
export GITHUB_TOKEN=...
# 或
export GH_TOKEN=...
```

### 使用技巧
- **一次多枪**：主 query + `sub_queries` 覆盖「是什么 / 对比 / 迁移 / 官方」。
- **时效敏感**（CVE、版本发布、新闻）：`time: "d"` 或 `"w"` + 必要时 `category: "news"`。
- **写代码/查库**：`category: "coding"`，让 GitHub·npm·SO·MDN 合并进结果。
- **拿到高价值链接后**：再读正文，不要只凭 snippet 下结论。
- **无结果 / 全 low**：换关键词、放宽 `time`、改 `general`、增加 `sub_queries`。

### 何时调用
- 需要实时/版本相关信息，或本地无法确认的事实。
- 排障很久无进展，需要外部文档/issue。

### 何时不调用
- 纯本地代码、已在上下文的信息、一般编程常识。

### 结果阅读
```
1. [high] 标题
   domain | https://...
   📅2026-07-01 · 源=github-api · score=0.82 rel=0.90 fresh=0.75
   → 摘要…
```
- `[high|mid|low]` = 可靠性档位  
- `fresh` 低 + 你设了 `time:d` → 谨慎采用  
- `源=ddg-instant` / `bing` → 优先交叉验证
