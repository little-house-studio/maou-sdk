import * as api from "../api";
import * as md from "../markdown/api";
import * as proactive from "../live/proactive-api";
import type { AppPorts } from "./types";

/** Live host: same `/api` + WS helpers the panels used to import. */
export function createLivePorts(): AppPorts {
  return {
    kind: "live",
    chat: {
      fetchMeta: api.fetchMeta,
      fetchSessions: api.fetchSessions,
      createSession: api.createSession,
      switchSession: api.switchSession,
      clearSession: api.clearSession,
      deleteSession: api.deleteSession,
      renameSession: api.renameSession,
      exportTranscript: api.exportTranscript,
      fetchApproval: api.fetchApproval,
      setApprovalMode: api.setApprovalMode,
      answerApproval: api.answerApproval,
      fetchModels: api.fetchModels,
      setModel: api.setModel,
      fetchLlmConfig: api.fetchLlmConfig,
      fetchSessionStats: api.fetchSessionStats,
      runCommand: api.runCommand,
      fetchCommandCatalog: api.fetchCommandCatalog,
      streamChat: api.streamChat,
      abortChat: api.abortChat,
      enqueueChat: api.enqueueChat,
      fetchChatQueue: api.fetchChatQueue,
      clearChatQueue: api.clearChatQueue,
      removeChatQueueItem: api.removeChatQueueItem,
    },
    shell: {
      fetchMeta: api.fetchMeta,
      fetchAgents: api.fetchAgents,
      setActiveAgent: api.setActiveAgent,
      fetchTerminals: api.fetchTerminals,
    },
    settings: {
      fetchMeta: api.fetchMeta,
      fetchModels: api.fetchModels,
      setModel: api.setModel,
      setApprovalMode: api.setApprovalMode,
      fetchLlmConfig: api.fetchLlmConfig,
      saveLlmConfig: api.saveLlmConfig,
      parseLlmClipboard: api.parseLlmClipboard,
      testLlmConnection: api.testLlmConnection,
      fetchSvgProbeGallery: api.fetchSvgProbeGallery,
      runLlmSvgProbe: api.runLlmSvgProbe,
      setSvgProbeReference: api.setSvgProbeReference,
    },
    files: {
      fetchMdTree: md.fetchMdTree,
      fetchProjectTree: md.fetchProjectTree,
      fetchGitStatus: md.fetchGitStatus,
      readFsFile: md.readFsFile,
      writeFsFile: md.writeFsFile,
    },
    terminals: {
      fetchTerminals: api.fetchTerminals,
      fetchTerminalCapabilities: api.fetchTerminalCapabilities,
      stopTerminal: api.stopTerminal,
      agentTerminalWsUrl: api.agentTerminalWsUrl,
      humanTerminalWsUrl: api.humanTerminalWsUrl,
    },
    proactive: {
      fetchProactive: proactive.fetchProactive,
      putProactiveSettings: proactive.putProactiveSettings,
      patchProactiveItem: proactive.patchProactiveItem,
      startProactiveScan: proactive.startProactiveScan,
      startProactiveDispatch: proactive.startProactiveDispatch,
      abortProactive: proactive.abortProactive,
      streamProactiveChat: proactive.streamProactiveChat,
    },
    models: {
      fetchModels: api.fetchModels,
    },
  };
}
