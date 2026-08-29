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
  loadOlderMessages,
  previewDeleteSession,
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
  fetchTodayUsage,
  fetchSessions,
  searchSessions,
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
  setPermissionPreset,
  setSessionSendMode,
  fetchPendingAsk,
  answerAsk,
  forkFromMessage,
  sendMessageFeedback,
  fetchSessionPlan,
  togglePlan,
  mutateGoal,
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
  searchSessions: typeof searchSessions;
  createSession: typeof createSession;
  switchSession: typeof switchSession;
  clearSession: typeof clearSession;
  deleteSession: typeof deleteSession;
  previewDeleteSession: typeof previewDeleteSession;
  loadOlderMessages: typeof loadOlderMessages;
  renameSession: typeof renameSession;
  exportTranscript: typeof exportTranscript;
  fetchApproval: typeof fetchApproval;
  setApprovalMode: typeof setApprovalMode;
  setPermissionPreset: typeof setPermissionPreset;
  setSessionSendMode: typeof setSessionSendMode;
  fetchPendingAsk: typeof fetchPendingAsk;
  answerAsk: typeof answerAsk;
  forkFromMessage: typeof forkFromMessage;
  sendMessageFeedback: typeof sendMessageFeedback;
  fetchSessionPlan: typeof fetchSessionPlan;
  togglePlan: typeof togglePlan;
  mutateGoal: typeof mutateGoal;
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
  fetchTodayUsage: typeof fetchTodayUsage;
};

export type SettingsPorts = {
  fetchMeta: typeof fetchMeta;
  fetchModels: typeof fetchModels;
  setModel: typeof setModel;
  setApprovalMode: typeof setApprovalMode;
  setPermissionPreset: typeof setPermissionPreset;
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
