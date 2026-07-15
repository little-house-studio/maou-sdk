/**
 * Agent-layer MCP host/client surface.
 *
 * Spec target: MCP 2025-11-25 (tools / resources / prompts, JSON-RPC 2.0)
 * Implementation: @modelcontextprotocol/sdk Client + transports
 */

export {
  MCP_TOOL_PREFIX,
  sanitizeMcpSegment,
  namespacedMcpToolName,
  isNamespacedMcpToolName,
  parseNamespacedMcpToolName,
} from "./names.js";

export {
  mapMcpInputSchemaToJsonSchema,
  mapListedToolToDescriptor,
  flattenMcpContentToText,
  extractMcpImages,
  mapCallToolResultToToolResponse,
  mapProtocolErrorToToolResponse,
} from "./mappers.js";
export type {
  McpListedTool,
  McpContentBlock,
  McpCallToolResult,
} from "./mappers.js";

export { McpSession } from "./session.js";
export type {
  McpSessionConfig,
  McpSessionStatus,
  McpTransportKind,
} from "./session.js";

export {
  createMcpBridgeTool,
  invokerAsHandler,
  registerMcpTools,
  unregisterMcpTools,
} from "./tool-bridge.js";
export type { McpToolCallHandler } from "./tool-bridge.js";

export {
  McpConnectionManager,
  McpToolExecutionError,
  isMcpToolExecutionError,
} from "./manager.js";
export type { McpManagerOptions, McpConnectionState } from "./manager.js";

export {
  listStandardMcpConfigPaths,
  mapStandardTransport,
  standardEntryToConnection,
  parseMcpServersFile,
  discoverStandardMcpConnections,
} from "./config-discover.js";
export type {
  StandardMcpServerEntry,
  StandardMcpConfigFile,
  DiscoverMcpConfigOptions,
  DiscoveredMcpConfigSource,
} from "./config-discover.js";

export {
  snapshotMcpCatalog,
  enrichMcpCatalogWithProtocolLists,
  formatMcpCatalogPrompt,
  buildMcpCatalogPrompt,
} from "./catalog.js";
export type { McpCatalogServerBlock, McpCatalogSnapshot } from "./catalog.js";

export {
  MCP_GATEWAY_TOOL_NAME,
  parseMcpToolExposureStrategy,
  readMcpToolStrategyFromAgentConfig,
} from "./strategy.js";
export type { McpToolExposureStrategy } from "./strategy.js";

export { createMcpGatewayTool } from "./gateway-tool.js";
export type { McpGatewayBackend } from "./gateway-tool.js";
