# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this repo

maou-sdk is a pnpm monorepo of reusable SDK packages for building AI agent applications. All packages are under the `@little-house-studio/*` scope. The companion app `maou-agent` (separate repo at `../maou-agent`) consumes these packages via `file:` dependencies.

## Commands

```bash
# Build all packages (pnpm handles topological order)
pnpm -r run build

# Typecheck all packages
pnpm -r run typecheck

# Run tests (only core/llm has tests — vitest, no network, uses faux provider)
pnpm -r run test
# Or directly:
cd core/llm && pnpm test
# Single test file:
cd core/llm && npx vitest run src/llm-extensions.test.ts

# CLI dev mode (runs the TUI directly via tsx, no build needed)
cd cli && pnpm dev
# Or from anywhere:
npx tsx /path/to/maou-sdk/cli/src/index.tsx

# terminal-engine requires Rust toolchain (napi-rs)
cd terminal-engine && napi build --release --platform

# Clean all dist
pnpm -r run clean
```

## Architecture

Package dependency graph (bottom → top):

```
core/types          ← base types, ConfigStore, project-manager, Profiler
core/prompt         ← types (PromptCompiler, template parsing)
core/llm            ← standalone (LLMClient, ModelCaller, stream, adapters, faux)
*-engine (×4)       ← standalone native/TS engines (see below)
core/context        ← prompt (SessionStore, ContextEngine, compressor, buildMessages)
core/tools          ← types + 4 engines + zod (ToolRegistry, 24 builtin tools, DynamicToolLoader)
core/agent          ← types + llm + tools + context + prompt (AgentRuntime, Runtime facade, hooks, registry, factory)
core/hub            ← agent + types (PluginBase, plugin discovery)
agent/coding-agent  ← agent + cli + context + tools (createCodingAgent, templates, cli-config)
cli                 ← agent + coding-agent + all core (Ink+React TUI, AgentCliConfig framework)
```

### Engine packages (4)

| Package | Tech | Consumed by |
|---|---|---|
| `terminal-engine` | **Rust + napi-rs** (portable-pty, tokio, dashmap) — only native package, builds to `.node` binary | `core/tools` via `file:` dependency |
| `lsp-engine` | TS (vscode-jsonrpc) — headless LSP client | `core/tools/src/code/lsp/` |
| `sqry-engine` | TS (zero deps) — wraps external `sqry` binary for code structure search | `core/tools/src/code/find_code/` |
| `opencli-engine` | TS (zero deps) — browser automation (Playwright-based) | `core/tools/src/browser/` |

### CLI architecture

`cli` is a generic TUI framework (Ink + React + Zustand). It loads any agent via `AgentCliConfig`:

```
maou <path>          → dynamic import agent cli config file → App(config)
maou (no args)       → default: @little-house-studio/coding-agent/cli-config
```

An agent developer writes a `cli-config.ts` that `export default` an `AgentCliConfig` (interface in `cli/src/types.ts`): `createAgent()` assembles dependencies + calls `createCodingAgent` (or equivalent), `getPreset()` returns an APIPreset, `getProviders()/getModels()` for model picker.

### Agent instantiation pattern

Agents use the "file-as-agent" convention: `createAgentFromTemplate()` writes a `.agent.ref` (reference mode) pointing to a template directory under the package. The instance lives at `<projectRoot>/.maou/agents/<name>/`. Runtime reads prompts/tools from the template; `agent.custom.json` overrides config.

### Tool system

24 builtin tools, all extend the `Tool` base class (`core/tools/src/base.ts`): each tool directory has `tool.ts` + `schema.json` + `TOOL.md`. `ToolRegistry.nativeToolSchemas(whitelist)` filters by agent's `PERMISSION.jsonc` + `agent.json` tools. `DynamicToolLoader` scans agent `tools/` dirs for custom tools. Output compression (`compressOutput`) reduces token usage on tool results.

## Key conventions

- **ESM only**: all packages `"type": "module"`. Relative imports use `.js` extension (NodeNext requirement).
- **Import scope**: `@little-house-studio/*` (old docs may show `maou-agent/*` — outdated).
- **tsconfig**: each package `extends ../../tsconfig.base.json` (NodeNext, strict, ES2022). Exceptions: `core/llm` inlines config; `cli` uses ESNext + Bundler + JSX (Ink/React).
- **Build output**: `dist/` (gitignored). `main: dist/index.js`, `types: dist/index.d.ts`.
- **Workspace deps**: `workspace:*` for internal TS packages. `file:` only for `terminal-engine` (native binary).
- **No CLAUDE.md, .cursorrules, or copilot instructions exist** — this is the first.
- **Design docs**: `SDK/SDK设计.md` (layer design), `GLOSSARY.md` (terminology), `core/agent/DESIGN.md` (agent layer checklist), `core/context/DESIGN.md`, `cli/DESIGN.md`. Note: `SDK/开发者文档/` uses outdated import paths.
- **maou-agent** (separate repo at `../maou-agent`): the application that consumes this SDK. Its `harness/server.ts` runs the HTTP backend (port 8099); `plugins/feishu/` is the Feishu bot integration. Changes to SDK packages require `pnpm -r build` before maou-agent picks them up (file: symlinks to dist).

## Testing

Only `core/llm` has tests (vitest). Tests use a `faux` provider that short-circuits LLM calls — no network needed. No other packages have test infrastructure yet.
