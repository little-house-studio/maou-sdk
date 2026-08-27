import type { AppPorts } from "./types";

function unavailable(name: string): never {
  throw new Error(`draft host has no live port "${name}"`);
}

function asyncUnavailable(name: string) {
  return (..._args: unknown[]) => Promise.reject(new Error(`draft host has no live port "${name}"`));
}

/**
 * Draft host ports. Chrome uses fixtures in memory; live `/api` methods reject.
 * Not a public SDK export.
 */
export function createDraftPorts(): AppPorts {
  const reject = asyncUnavailable;
  return {
    kind: "draft",
    chat: {
      fetchMeta: reject("chat.fetchMeta"),
      fetchSessions: reject("chat.fetchSessions"),
      createSession: reject("chat.createSession"),
      switchSession: reject("chat.switchSession"),
      clearSession: reject("chat.clearSession"),
      deleteSession: reject("chat.deleteSession"),
      renameSession: reject("chat.renameSession"),
      exportTranscript: reject("chat.exportTranscript"),
      fetchApproval: reject("chat.fetchApproval"),
      setApprovalMode: reject("chat.setApprovalMode"),
      answerApproval: reject("chat.answerApproval"),
      fetchModels: reject("chat.fetchModels"),
      setModel: reject("chat.setModel"),
      fetchLlmConfig: reject("chat.fetchLlmConfig"),
      fetchSessionStats: reject("chat.fetchSessionStats"),
      runCommand: reject("chat.runCommand"),
      fetchCommandCatalog: reject("chat.fetchCommandCatalog"),
      streamChat: () => {
        unavailable("chat.streamChat");
      },
      abortChat: reject("chat.abortChat"),
      enqueueChat: reject("chat.enqueueChat"),
      fetchChatQueue: reject("chat.fetchChatQueue"),
      clearChatQueue: reject("chat.clearChatQueue"),
      removeChatQueueItem: reject("chat.removeChatQueueItem"),
    },
    shell: {
      fetchMeta: reject("shell.fetchMeta"),
      fetchAgents: reject("shell.fetchAgents"),
      setActiveAgent: reject("shell.setActiveAgent"),
      fetchTerminals: reject("shell.fetchTerminals"),
    },
    settings: {
      fetchMeta: reject("settings.fetchMeta"),
      fetchModels: reject("settings.fetchModels"),
      setModel: reject("settings.setModel"),
      setApprovalMode: reject("settings.setApprovalMode"),
      fetchLlmConfig: reject("settings.fetchLlmConfig"),
      saveLlmConfig: reject("settings.saveLlmConfig"),
      parseLlmClipboard: reject("settings.parseLlmClipboard"),
      testLlmConnection: reject("settings.testLlmConnection"),
      fetchSvgProbeGallery: reject("settings.fetchSvgProbeGallery"),
      runLlmSvgProbe: reject("settings.runLlmSvgProbe"),
      setSvgProbeReference: reject("settings.setSvgProbeReference"),
    },
    files: {
      fetchMdTree: reject("files.fetchMdTree"),
      fetchProjectTree: reject("files.fetchProjectTree"),
      fetchGitStatus: reject("files.fetchGitStatus"),
      readFsFile: reject("files.readFsFile"),
      writeFsFile: reject("files.writeFsFile"),
    },
    terminals: {
      fetchTerminals: reject("terminals.fetchTerminals"),
      fetchTerminalCapabilities: reject("terminals.fetchTerminalCapabilities"),
      stopTerminal: reject("terminals.stopTerminal"),
      agentTerminalWsUrl: () => unavailable("terminals.agentTerminalWsUrl"),
      humanTerminalWsUrl: () => unavailable("terminals.humanTerminalWsUrl"),
    },
    proactive: {
      fetchProactive: reject("proactive.fetchProactive"),
      putProactiveSettings: reject("proactive.putProactiveSettings"),
      patchProactiveItem: reject("proactive.patchProactiveItem"),
      startProactiveScan: reject("proactive.startProactiveScan"),
      startProactiveDispatch: reject("proactive.startProactiveDispatch"),
      abortProactive: reject("proactive.abortProactive"),
      streamProactiveChat: () => {
        unavailable("proactive.streamProactiveChat");
      },
    },
    models: {
      fetchModels: reject("models.fetchModels"),
    },
  } as AppPorts;
}
