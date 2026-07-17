# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this repo

pnpm monorepo of reusable SDK packages for AI agent applications (`@little-house-studio/*`). Companion app **maou-agent** lives at `../maou-agent` and consumes packages via `file:` links into `*/dist`.

After editing any package source, rebuild before the app sees changes:

```bash
pnpm -r run build
# or one package:
pnpm --filter @little-house-studio/tools build
```

## Commands

```bash
pnpm install
pnpm -r run build
pnpm -r run typecheck
pnpm -r run test
pnpm -r run clean

# Single-package tests (vitest)
cd core/llm && pnpm test
cd core/llm && npx vitest run src/llm-extensions.test.ts
cd core/tools && pnpm exec vitest run src/path-guard.test.ts
cd core/agent && pnpm exec vitest run src/agent/init-project-context.test.ts
cd cli && pnpm test
cd cli && npx vitest run src/input/terminal-approval.test.ts

# CLI (Ink TUI, no prior build of cli needed)
cd cli && pnpm dev
cd cli && pnpm dev -- coding          # product shortcut if supported
# Ratatui TUI (Rust child binary + Node bridge)
cd cli && npm run build:tui-ratatui   # release: tui-ratatui/target/release/maou-tui-ratatui
cd cli && npm run dev:ratatui         # debug build + MAOU_TUI=ratatui
# Force binary path: MAOU_TUI_BIN=... MAOU_TUI=ratatui …

# Native engines
cd terminal-engine && napi build --release --platform
# DCG binary for destructive-command gate (postinstall / ensure-dcg)
pnpm run ensure-dcg
```

Host tools expected on PATH for code-intel tools: `sqry` (`cargo install sqry`), `typescript-language-server`, optional language servers for `lsp` tool.

## Architecture (big picture)

```
core/types
core/prompt          → PromptCompiler, templates
core/llm             → LLMClient, adapters, stream (faux provider in tests)
*-engine (4)         → terminal (Rust/napi), lsp, sqry, opencli
core/context         → sessions, compression, buildMessages, project context inject
core/tools           → ToolRegistry, builtins, security gate, terminal policy
core/agent           → AgentRuntime, Runtime facade, registry/factory, MCP, commands
core/hub             → plugin discovery
agent/coding-agent   → createCodingAgent + templates/coding + /init task command
cli                  → Ink+React TUI and/or ratatui binary; AgentCliConfig product loader
```

**Run loop**: product CLI (`cli`) or maou-agent HTTP → `Runtime` / `AgentRuntime.run()` async generator → stream events → tools via `ToolRegistry` / executor → LLM via `core/llm`.

**File-as-agent**: instances at `<project>/.maou/agents/<name>/` (often `.agent.ref` → package template). Runtime merges template + `agent.custom.json`; tools filtered by `agent.json` `tools` ∩ optional `PERMISSION.jsonc`.

**Project docs inject** (`core/context` `project-context.ts` → `buildMessages`): reads `<project>/.maou/project/{USER,PROJECT,RULE,DESIGN,EXPERIENCE}.md` (fallback `.maou/context/`), wraps as `<project_info>…</project_info>` system message. Coding product `/init` is a **task-mode** command (`templates/coding/command/init.md`, `mode: task`) that injects a large user task and continues the agent loop (not a fixed reply).

**Terminal security** (`core/tools/src/security/`): pre-exec only — `gateTerminalCommand` → fatal deny / dangerous pending / ask. CLI `setTerminalApprover` blocks until UI choice (once/always/deny/blacklist). Approval UI should show model tool-call `description`/`reason` first; risk colors low=yellow, high=red. DCG hard-blocks destructive patterns (yolo does not bypass DCG).

**Code search tools**: `find_code` → `sqry-engine` (structure/call graph); `lsp` → `lsp-engine` (semantics/diagnostics). Workspace seed must skip `.maou` and prefer TS under `tsconfig` roots.

**CLI dual frontend**: business state in Node (`cli/src`); Ratatui is a view shell (`cli/tui-ratatui`) over JSONL protocol (`protocol.rs` / `headless/protocol-types.ts`). Prefer editing Node for product logic; Rust for paint/input parity.

## Conventions

- ESM (`"type": "module"`); relative imports use `.js` suffix (NodeNext) except cli (Bundler + JSX).
- Scope: `@little-house-studio/*` (docs saying `maou-agent/*` are outdated).
- Per-package `dist/` is the publish/consume surface; never point app imports at `src/` across packages.
- Design notes: `GLOSSARY.md`, `core/agent/DESIGN.md`, `cli/DESIGN.md`, `SDK/SDK设计.md` (some paths in `SDK/开发者文档/` are stale).

## Testing notes

Vitest is used across `core/llm`, `core/tools`, `core/context`, `core/agent`, `cli`, `sqry-engine`, etc. Prefer package-local `pnpm exec vitest run <file>`. LLM tests use faux provider (no network). Ratatui: `cargo test --manifest-path cli/tui-ratatui/Cargo.toml`.
