export { createWebUiServer, type WebUiServer, type WebUiServerOpts } from "./create-server.js";
export {
  MAOU_WEBUI_BIND_HOST,
  MAOU_WEBUI_DEFAULT_HOST,
  MAOU_WEBUI_DEFAULT_PORT,
  maouWebUiPublicUrl,
  maouWebUiUrl,
  openInSystemBrowser,
  probeMaouWebUi,
  resolveListenPlan,
} from "./local-entry.js";


export { AgentHub, type AgentHubOpts } from "./agent-hub.js";
export {
  initAgentTerminalEngine,
  listAgentTerminals,
  getAgentTerminalLogs,
  writeAgentTerminal,
  attachAgentTerminalSocket,
} from "./agent-terminals.js";
export {
  listMarkdownTree,
  readProjectFile,
  writeProjectFile,
  createMarkdownFile,
  resolveSafePath,
  mountMarkdownRoutes,
} from "./markdown/index.js";
export { CopilotHub, type CopilotHubOpts, type CopilotChatContext } from "./copilot-hub.js";
export { mountProactiveRoutes } from "./proactive/routes.js";
// 主动智能在 Agent 层（附属驻扎）；WebUI 只 re-export
export {
  ProactiveService,
  type ProactiveSnapshot,
  type CodingDispatchPort,
  isQueued,
  parseProactiveMarkdown,
  ensureProactiveStationed,
  isStationedAffiliateAgentName,
} from "@little-house-studio/agent";
