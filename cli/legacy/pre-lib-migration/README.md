# pre-lib-migration 快照

2026-07-10 库替换前的 `cli/src` 源文件完整备份。

回退某文件：

```bash
cp legacy/pre-lib-migration/<path> src/<path>
```

例如恢复旧 SelectList：

```bash
cp legacy/pre-lib-migration/overlay/SelectList.tsx src/overlay/SelectList.tsx
```

本目录只读存档，不要在这里改业务逻辑。
