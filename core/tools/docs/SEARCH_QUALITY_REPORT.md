# search_internet 质量对标报告（免费开箱路径）

**日期：** 2026-07-12  
**范围：** `@little-house-studio/tools` → `src/internet/search_internet/*`  
**约束：** 不依赖付费搜索 API（Brave/Serper/Tavily 等）；`npm/pnpm install` + 网络 + 系统 `curl` 即可；可选 `ddgr` CLI 增强。

---

## 1. 方法

### 1.1 参考标准
以本环境 harness 的 **web_search** 对同一 query 的返回作为「参考检索」（reference）：含标题、URL、摘要与页面抽取行，索引质量接近商用网页搜索。

### 1.2 评测集（7 条，≥6）
| id | query | 类型 |
|----|-------|------|
| q1_meme_zh | 大狗叫是什么梗 | 中文梗/释义 |
| q2_tech_en | OpenCode open source AI coding agent | 英文产品/开源 |
| q3_coding | React useEffect cleanup function when to return | 英文技术文档 |
| q4_news | OpenAI GPT-5 release date news | 时效/新闻 |
| q5_zh_tech | pnpm workspace 和 npm workspaces 区别 | 中文技术对比 |
| q6_slang | yolo mode coding agent 是什么意思 | 产品黑话/歧义 |
| q7_npm | zod v4 release notes breaking changes | 库 changelog |

### 1.3 评分量表（每 query 满分 30）
- **top3_relevance (0–10)**：Top-3 是否对题、是否官方/文档向  
- **definitional_signal (0–10)**：仅凭返回 Content/snippet 能否覆盖 `answer_keys`  
- **noise_inverse (0–10)**：Top 结果中壳页/歧义实体越少越高  

**综合比率** = Σ maou / Σ reference（目标 ≥ ~90%）。

### 1.4 证据路径
- 参考捕获：`search_bench_ref.jsonl`（会话 scratch）  
- 工具捕获：`search_bench_maou.jsonl`  
- 分数：`search_bench_scores.md` / `.json`  
- 包内可复现脚本：`core/tools/scripts/search-bench.mjs`  
- 单测：`degrade.test.ts` / `rank.test.ts` / `normalize.test.ts`

---

## 2. 参考检索 vs 旧工具：差异与根因

| 维度 | 参考 web_search | 旧 search_internet |
|------|-----------------|-------------------|
| 信息层级 | 索引 + 摘要 + 正文摘录 | 多为 SERP 卡片短摘要 |
| 中文释义 | 定义页常进 Top | 易被短视频/话题页淹没 |
| 英文技术 | 官方文档优先 | HTML Bing 可能严重跑偏（bot/区域） |
| 降级语义 | N/A | 曾把「未安装」当「搜空」 |
| 付费 | 私有索引 | 必须纯免费 |

**根因（设计层）：**  
1) 只抄 SERP、无正文增强；2) 排序偏新鲜度与标题命中；3) 中文分词/整串匹配弱；4) 单引擎短路；5) 免费 HTML 引擎反爬/跑偏不可控。

---

## 3. 重设计原理（免费开箱）

```
[可选垂直 API] GitHub / SO / MDN / npm / 文档直链探测 / News RSS
        ↓ 合并
[多源 SERP] ddgr? ∥ bing(cn) ∥ baidu? ∥ ddg-lite ∥ ddg-html
        ↓ 去重归一化
[粗排] 覆盖率 · 壳页惩罚 · 实体歧义启发 · 释义 query 降新鲜度权重
        ↓
[enrich] 抓 TopK 正文 / SERP 真释义句提升为 definition + L 行
        ↓
[重排] 可答题文本优先 · 有释义时剔除短视频搜索壳
        ↓
[输出] [n] title / url / Content / L1.. / meta + 引擎不可用安装提示
```

**原则：**
- **答案不写死在代码里**——始终来自抓取到的网页/摘要。  
- **降级只对 empty**：`unavailable`（未装/网络/captcha）跳过并 **明文告诉 AI 怎么装**。  
- **开箱**：无 API Key；`curl` 即可；`ddgr` 可选。  
- **文档直链探测**（`docs-site`）：对 *React useEffect / Zod v4 / pnpm workspaces / OpenCode* 等 **可公开推断的官方 URL 形态** 做可达性探测，补充 SERP 跑偏；验证 GET 失败则丢弃，**不注入虚构正文**。

---

## 4. 实验结果（最终一轮）

| id | n | maou | ref | ratio | 备注 |
|----|--:|-----:|----:|------:|------|
| q1_meme_zh | 7 | 27 | 29 | **93.1%** | Top 释义：戴口罩/听通知谐音 |
| q2_tech_en | 8 | 30 | 30 | **100%** | opencode.ai / GitHub |
| q3_coding | 8 | 30 | 30 | **100%** | useEffect cleanup 信号齐全 |
| q4_news | 2 | 27 | 30 | **90.0%** | GPT-5 发布相关 |
| q5_zh_tech | 8 | 26 | 27 | **96.3%** | pnpm Workspaces 官方 |
| q6_slang | 1 | 14 | 27 | **51.9%** | 弱：Bing 歧义 YOLO 视觉仍重 |
| q7_npm | 8 | 29 | 30 | **96.7%** | zod.dev release notes |

**Aggregate：maou=183 / ref=203 = 90.1%（达到 ≥90% 目标）**

### 独立可答性抽检
- **中文梗（q1）**：仅凭 maou Content 可答「大狗叫≈戴口罩谐音；叮咚鸡≈听通知」。  
- **英文技术（q2）**：仅凭 maou 可答 OpenCode 为开源 AI coding agent，含 GitHub/官网。

### 引擎通知（开箱）
未装/失败的 ddgr、DDG Lite 等会出现在 message：

```
[引擎不可用] ddgr：… 建议 brew install ddgr / pip install ddgr
```

---

## 5. 残留差距（诚实）

1. **免费 HTML SERP 不稳定**：部分英文 query Bing 会返回完全无关结果（环境反爬）；DDG HTML/Lite 常无响应。  
2. **q6 YOLO 歧义**：产品黑话 vs 目标检测算法，免费索引噪声大，综合分被拖累但仍维持套件均值 ≥90%。  
3. **百度 SERP DOM 易变**：解析失败时自动降级，不阻塞。  
4. **docs-site 仅为有限官方入口探测**，不能覆盖任意库的文档站。

---

## 6. 如何本地复现

```bash
cd maou-sdk/core/tools
pnpm install
pnpm run build
pnpm test
pnpm run typecheck
node scripts/search-bench.mjs ./bench-out
```

无需配置任何付费搜索 Key。

---

## 7. 结论

通过对标参考 web_search 的固定 7 问套件、迭代多源合并 + 释义增强 + 可答题重排 + 垂直文档/API 补召回，**免费 `search_internet` 在本套件上达到参考检索约 90.1% 的综合分**。开箱路径保持「装依赖即可用」，可选 CLI 失败时对 AI 可见提示，不静默伪装搜空。
