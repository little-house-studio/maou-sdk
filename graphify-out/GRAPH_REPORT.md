# Graph Report - /Users/mac/Documents/vscodeProject/maou-sdk/core/context  (2026-09-06)

## Corpus Check
- 88 files · ~58,527 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1054 nodes · 2985 edges · 41 communities (35 shown, 6 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 50 edges (avg confidence: 0.77)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Session Store 0
- Harness Working Set
- Session Store 2
- Session Ledger 3
- Session Ledger
- session-goal
- Harness Working Set 6
- Compression
- Session Store 8
- Compression 9
- packageon
- Session Store 11
- session-plan
- Session Store
- Session Ledger 14
- Session Store 15
- Compression 16
- Session Store 17
- Session Store 18
- Session Events
- attachment-store
- Token Estimate
- Session Store 22
- File Cache Bake
- Session Store 24
- Session Store 25
- Harness Working Set 26
- Session Store 27
- user-message
- Session Store 29
- workspace-instructions
- platform-context
- Compress Modules 32
- list-cache
- Session Store 34
- session-tree
- Token Estimate 36
- fold-cache
- Compress Modules
- Session Store 40

## God Nodes (most connected - your core abstractions)
1. `SessionStore` - 125 edges
2. `MaouMessage` - 48 edges
3. `appendLedgerEvent()` - 42 edges
4. `ContextEngine` - 28 edges
5. `GoalHarnessService` - 25 edges
6. `SessionSearchIndex` - 24 edges
7. `HarnessSessionStore` - 23 edges
8. `TaskSessionStore` - 22 edges
9. `AutoCompressSession` - 21 edges
10. `BakeFile` - 21 edges

## Surprising Connections (you probably didn't know these)
- `SummaryCompressResult` --references--> `MaouMessage`  [EXTRACTED]
  src/compressor.ts → src/types/message.ts
- `summaryCompressHarness()` --indirect_call--> `maouToLLMMessage()`  [INFERRED]
  src/compressor.ts → src/types/message.ts
- `catchUpOffsetSidecar()` --indirect_call--> `line()`  [INFERRED]
  src/jsonl-offset.ts → src/demo-b1-seed.mjs
- `readNewJsonlLines()` --indirect_call--> `line()`  [INFERRED]
  src/jsonl-offset.ts → src/demo-b1-seed.mjs
- `readOffsetRecs()` --indirect_call--> `line()`  [INFERRED]
  src/jsonl-offset.ts → src/demo-b1-seed.mjs

## Import Cycles
- 3-file cycle: `src/session-event.ts -> src/session-store.ts -> src/session-ledger.ts -> src/session-event.ts`
- 3-file cycle: `src/session-event.ts -> src/session-store.ts -> src/tool-result.ts -> src/session-event.ts`
- 3-file cycle: `src/session-event.ts -> src/session-store.ts -> src/types/message.ts -> src/session-event.ts`
- 4-file cycle: `src/events-archive.ts -> src/session-ledger.ts -> src/session-event.ts -> src/session-store.ts -> src/events-archive.ts`
- 4-file cycle: `src/session-event.ts -> src/session-store.ts -> src/session-search-index.ts -> src/session-ledger.ts -> src/session-event.ts`

## Communities (41 total, 6 thin omitted)

### Community 0 - "Session Store 0"
Cohesion: 0.05
Nodes (29): CheckpointStore, genId(), nowIso(), MAX_AUTO_CHECKPOINTS, isOverlayType(), isSearchableType(), jsonlIoStats, isMessageEventType() (+21 more)

### Community 1 - "Harness Working Set"
Cohesion: 0.06
Nodes (62): activeWindowBoundary(), activeWindowSeqIds(), archiveCompressHarness(), assignTaskIds(), buildDroppedSummary(), buildLegacyResult(), categoryToRole(), collectRecentToolChain() (+54 more)

### Community 2 - "Session Store 2"
Cohesion: 0.08
Nodes (21): genId(), MemoryStore, nowIso(), atomicWriteJson(), ManagerState, nowIso(), SessionManager, SessionListItem (+13 more)

### Community 3 - "Session Ledger 3"
Cohesion: 0.07
Nodes (48): installContextContracts(), appendListeners, asToolCall(), bindSessionLedgerPort(), catalog, compactMessageData(), CORE_SPECS, coreTypes (+40 more)

### Community 4 - "Session Ledger"
Cohesion: 0.08
Nodes (40): compactByCategory(), injectDurableAppendFailure(), OFFSET_FILE, codePoints(), pruneBodyText(), pruneTextHeadTail(), pruneToolResultText(), TOOL_RESULT_PRUNE_HEAD_CHARS (+32 more)

### Community 5 - "session-goal"
Cohesion: 0.11
Nodes (26): applyGoalChange(), applyGoalEvent(), bindSessionGoalPort(), cacheKey(), decodeGoalChange(), decodeGoalSource(), decodeSnapshot(), emptyGoalFoldState() (+18 more)

### Community 6 - "Harness Working Set 6"
Cohesion: 0.10
Nodes (17): decodeSnapshot(), firstUncheckedPlanItem(), gapFingerprint(), goalHarness, goalHarnessDir(), GoalHarnessService, isRecord(), note() (+9 more)

### Community 7 - "Compression"
Cohesion: 0.14
Nodes (19): AutoCompressConfig, Summarizer, DEFAULT_LEGACY_CONFIG, LegacyCompressConfig, legacyContextModule, contextModules, registerContextModule(), resetContextModulesForTest() (+11 more)

### Community 9 - "Compression 9"
Cohesion: 0.10
Nodes (30): contentText(), CONTEXT_ASSERT_ENV, contextAssertEnabled(), ContextAssertRecord, contextStructure, describeContextDrift(), digest(), noteContextStructure() (+22 more)

### Community 10 - "packageon"
Cohesion: 0.06
Nodes (30): @little-house-studio/prompt, @little-house-studio/types, dependencies, @little-house-studio/prompt, @little-house-studio/types, description, devDependencies, @types/node (+22 more)

### Community 11 - "Session Store 11"
Cohesion: 0.14
Nodes (13): makeSummaryMsg(), atomicWrite(), nowIso(), TaskEntry, TaskSessionStore, LLMMessage, maouMessagesToLLM(), MaouTaskBlock (+5 more)

### Community 12 - "session-plan"
Cohesion: 0.19
Nodes (15): bindSessionPlanPort(), decodeSnapshot(), isRecord(), note(), renderPlanImplement(), renderPlanKickoff(), renderPlanPolicy(), renderPlanRevise() (+7 more)

### Community 13 - "Session Store"
Cohesion: 0.11
Nodes (20): AutoCompressResult, CompressMode, DEFAULT_AUTO_COMPRESS_CONFIG, bake(), BakeFileOptions, BakeMode, DiffEntry, FileType (+12 more)

### Community 14 - "Session Ledger 14"
Cohesion: 0.19
Nodes (25): crc32of(), durableAppend(), appendOffsetRec(), appendOffsetRecs(), catchUpOffsetSidecar(), countOffsetType(), isMessageOffsetType(), lastOffsetRec() (+17 more)

### Community 15 - "Session Store 15"
Cohesion: 0.09
Nodes (21): DEFAULT_RECENT_LIMIT, DeletePreview, DeleteResult, escapeRegExp(), FileSeg, inferRole(), LoadRecentPage, LocatedMessage (+13 more)

### Community 16 - "Compression 16"
Cohesion: 0.11
Nodes (7): AutoCompressSession, CompressPolicy, moduleConfigFor(), resolveAutoCompressConfig(), TokenThresholdPolicy, toModuleContext(), resolveContextModule()

### Community 17 - "Session Store 17"
Cohesion: 0.20
Nodes (6): readLineAt(), scanMessageOffsetsReverse(), parseLedgerLine(), asPrefixRef(), eventToMessage(), peekPendingWrites()

### Community 18 - "Session Store 18"
Cohesion: 0.18
Nodes (3): appendLedgerEvent(), emptyLifetime(), nowIso()

### Community 19 - "Session Events"
Cohesion: 0.18
Nodes (20): AppendSessionEventInput, authorAgent(), authorHuman(), authorSystem(), authorTool(), defaultAuthorForKind(), defaultWireRole(), formatAuthorLabel() (+12 more)

### Community 20 - "attachment-store"
Cohesion: 0.17
Nodes (17): ALLOWED_IMAGE_MIMES, AttachmentMeta, AttachmentRejectError, attachmentsRoot(), decodeImageBytes(), hydrateMessageImages(), ingestImageBatch(), MAX_ATTACH_BYTES (+9 more)

### Community 21 - "Token Estimate"
Cohesion: 0.18
Nodes (19): composeContextBreakdown(), ComposeContextBreakdownInput, ContextBarKey, ContextBarShare, contextBarShares(), ContextBreakdown, countImages(), estimateSessionMessageTokens() (+11 more)

### Community 22 - "Session Store 22"
Cohesion: 0.16
Nodes (18): durableAtomicWrite(), durableAtomicWriteJson(), fileSizeOrZero(), syncDir(), cleanupOrphanSeals(), listSealedSegments(), LIVE_TAIL_KEEP_BYTES, MANIFEST_FILE (+10 more)

### Community 24 - "Session Store 24"
Cohesion: 0.18
Nodes (9): CompressMaouResult, CompressReport, ContextEngineOptions, HarnessCurrentRecord, HarnessWorkingSetMeta, isHarnessMetaAligned(), sessionMessageFingerprint(), CompressionStage (+1 more)

### Community 25 - "Session Store 25"
Cohesion: 0.25
Nodes (14): appendSessionEvent(), appendToolResult(), AppendToolResultOutcome, asArgsRecord(), asRecord(), findToolCallIdByPayload(), formatToolFollowupText(), isToolCallIdPaired() (+6 more)

### Community 27 - "Session Store 27"
Cohesion: 0.28
Nodes (3): atomicWriteJson(), HarnessSessionStore, nowIso()

### Community 28 - "user-message"
Cohesion: 0.32
Nodes (15): agentSendAudio(), agentSendImages(), agentSendVideo(), agentUserMessageText(), asText(), collectMedia(), flattenAgentSendText(), flattenContent() (+7 more)

### Community 29 - "Session Store 29"
Cohesion: 0.17
Nodes (5): bar(), line(), main(), makeMsgs(), readSealedLine()

### Community 30 - "workspace-instructions"
Cohesion: 0.23
Nodes (12): compileWorkspaceInstructions(), dedupeInstructionFiles(), diffWorkspaceInstructions(), instructionContentHash(), instructionRelPaths(), loadWorkspaceInstructionFiles(), resolveWorkspaceInstructionsEnabled(), snapshotWorkspaceInstructions() (+4 more)

### Community 31 - "platform-context"
Cohesion: 0.18
Nodes (6): buildPlatformContext(), BuildPlatformContextOptions, nowISO(), PlatformContextProvider, PlatformContextRegistry, PlatformContextRequest

### Community 32 - "Compress Modules 32"
Cohesion: 0.17
Nodes (11): node_modules, src/**/*, src/**/*.test.ts, ../../tsconfig.base.json, compilerOptions, outDir, rootDir, exclude (+3 more)

### Community 33 - "list-cache"
Cohesion: 0.29
Nodes (10): LIST_CACHE_FILE, LIST_CACHE_VER, ListCacheItem, listCachePath(), ListCacheSnap, readListCache(), removeListCacheItem(), stripHeavySessionMetaText() (+2 more)

### Community 35 - "session-tree"
Cohesion: 0.38
Nodes (8): ensureEntryIds(), filterLlmVisible(), isLlmVisible(), newEntryId(), prefixThrough(), selectBranch(), SessionVisibility, TreeFields

### Community 36 - "Token Estimate 36"
Cohesion: 0.33
Nodes (7): contextRemainingRatio(), contextUsageRatio(), estimateTokens(), occupancyFromUsage(), parsePromptTokensFromUsage(), parseUsageTokens(), UsageTokens

### Community 37 - "fold-cache"
Cohesion: 0.28
Nodes (8): FOLD_CACHE_FILE, FOLD_CACHE_VER, foldCachePath(), FoldCacheSnap, foldCacheUsable(), messageFingerprint(), readFoldCache(), writeFoldCache()

## Knowledge Gaps
- **84 isolated node(s):** `name`, `version`, `description`, `type`, `license` (+79 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `SessionStore` connect `Session Store 8` to `Session Store 0`, `Session Store 2`, `Session Ledger 3`, `Session Ledger`, `session-goal`, `Session Store 34`, `Session Store 38`, `Session Store 40`, `Session Store`, `Session Store 15`, `Session Store 17`, `Session Store 18`, `Session Events`, `Session Store 25`, `Session Store 29`?**
  _High betweenness centrality (0.167) - this node is a cross-community bridge._
- **Why does `BakeFile` connect `File Cache Bake` to `Session Store`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Why does `GoalHarnessService` connect `Harness Working Set 6` to `Session Store`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _84 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Session Store 0` be split into smaller, more focused modules?**
  _Cohesion score 0.054244306418219465 - nodes in this community are weakly interconnected._
- **Should `Harness Working Set` be split into smaller, more focused modules?**
  _Cohesion score 0.060528559249786874 - nodes in this community are weakly interconnected._
- **Should `Session Store 2` be split into smaller, more focused modules?**
  _Cohesion score 0.07692307692307693 - nodes in this community are weakly interconnected._