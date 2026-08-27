/**
 * Host ports — the only I/O surface chrome/panels may call.
 * Live wraps `/api` + WS helpers; draft wraps fixtures (not a public SDK).
 */
import type {
  answerApproval,
  abortChat,
  clearChatQueue,
  clearSession,
  createSession,
  deleteSession,
  enqueueChat,
  exportTranscript,
  fetchAgents,
  fetchCommandCatalog,
  fetchApproval,
  fetchChatQueue,
  fetchLlmConfig,
  fetchMeta,
  fetchModels,
  fetchSessionStats,
  fetchSessions,
  fetchSvgProbeGallery,
  fetchTerminalCapabilities,
  fetchTerminals,
  parseLlmClipboard,
  removeChatQueueItem,
  renameSession,
  runCommand,
  runLlmSvgProbe,
  saveLlmConfig,
  setActiveAgent,
  setApprovalMode,
  setModel,
  setSvgProbeReference,
  stopTerminal,
  streamChat,
  switchSession,
  testLlmConnection,
  agentTerminalWsUrl,
  humanTerminalWsUrl,
} from "../api";
import type {
  fetchGitStatus,
  fetchMdTree,
  fetchProjectTree,
  readFsFile,
  writeFsFile,
} from "../markdown/api";
import type {
  abortProactive,
  fetchProactive,
  patchProactiveItem,
  putProactiveSettings,
  startProactiveDispatch,
  startProactiveScan,
  streamProactiveChat,
} from "../live/proactive-api";

export type ChatPorts = {
  fetchMeta: typeof fetchMeta;
  fetchSessions: typeof fetchSessions;
  createSession: typeof createSession;
  switchSession: typeof switchSession;
  clearSession: typeof clearSession;
  deleteSession: typeof deleteSession;
  renameSession: typeof renameSession;
  exportTranscript: typeof exportTranscript;
  fetchApproval: typeof fetchApproval;
  setApprovalMode: typeof setApprovalMode;
  answerApproval: typeof answerApproval;
  fetchModels: typeof fetchModels;
  setModel: typeof setModel;
  fetchLlmConfig: typeof fetchLlmConfig;
  fetchSessionStats: typeof fetchSessionStats;
  runCommand: typeof runCommand;
  fetchCommandCatalog: typeof fetchCommandCatalog;
  streamChat: typeof streamChat;
  abortChat: typeof abortChat;
  enqueueChat: typeof enqueueChat;
  fetchChatQueue: typeof fetchChatQueue;
  clearChatQueue: typeof clearChatQueue;
  removeChatQueueItem: typeof removeChatQueueItem;
};

export type ShellPorts = {
  fetchMeta: typeof fetchMeta;
  fetchAgents: typeof fetchAgents;
  setActiveAgent: typeof setActiveAgent;
  fetchTerminals: typeof fetchTerminals;
};

export type SettingsPorts = {
  fetchMeta: typeof fetchMeta;
  fetchModels: typeof fetchModels;
  setModel: typeof setModel;
  setApprovalMode: typeof setApprovalMode;
  fetchLlmConfig: typeof fetchLlmConfig;
  saveLlmConfig: typeof saveLlmConfig;
  parseLlmClipboard: typeof parseLlmClipboard;
  testLlmConnection: typeof testLlmConnection;
  fetchSvgProbeGallery: typeof fetchSvgProbeGallery;
  runLlmSvgProbe: typeof runLlmSvgProbe;
  setSvgProbeReference: typeof setSvgProbeReference;
};

export type FilesPorts = {
  fetchMdTree: typeof fetchMdTree;
  fetchProjectTree: typeof fetchProjectTree;
  fetchGitStatus: typeof fetchGitStatus;
  readFsFile: typeof readFsFile;
  writeFsFile: typeof writeFsFile;
};

export type TerminalPorts = {
  fetchTerminals: typeof fetchTerminals;
  fetchTerminalCapabilities: typeof fetchTerminalCapabilities;
  stopTerminal: typeof stopTerminal;
  agentTerminalWsUrl: typeof agentTerminalWsUrl;
  humanTerminalWsUrl: typeof humanTerminalWsUrl;
};

export type ProactivePorts = {
  fetchProactive: typeof fetchProactive;
  putProactiveSettings: typeof putProactiveSettings;
  patchProactiveItem: typeof patchProactiveItem;
  startProactiveScan: typeof startProactiveScan;
  startProactiveDispatch: typeof startProactiveDispatch;
  abortProactive: typeof abortProactive;
  streamProactiveChat: typeof streamProactiveChat;
};

export type ModelsPorts = {
  fetchModels: typeof fetchModels;
};

export type AppPorts = {
  kind: "draft" | "live";
  chat: ChatPorts;
  shell: ShellPorts;
  settings: SettingsPorts;
  files: FilesPorts;
  terminals: TerminalPorts;
  proactive: ProactivePorts;
  models: ModelsPorts;
};
