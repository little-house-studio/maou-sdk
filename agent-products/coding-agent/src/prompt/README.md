# 编程角色提示词资产

此目录存放 coding-agent 专属的编程角色提示词。

## 现状

迁移自 maou-agent 时，编程角色的**实质提示词在共享的 `ROLE/default/` + `ROLE/presets/`**
（`SOUL.md` / `IDENTITY.md` / `TOOL.md` / `RULE.md` / `JOB_RULE.md`），那些是所有 agent 共用，
按「共享件保留」原则未搬入本包。原 `ROLE/coding/lmd.md` 为空占位，无实质内容。

## 约定

- coding-agent 通过 `createCodingAgent({ ... })` 装配时，由应用层把 `configStore.api.promptRoot`
  指向编程角色目录（默认复用共享 `ROLE/`）。
- 本目录用于放**仅 coding-agent 需要**的提示词覆盖（如编程专属 `RULE.md` 片段），
  后续扩展时填充。
