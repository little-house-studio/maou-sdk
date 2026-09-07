import {
  ensureEntryIds,
  filterLlmVisible,
  prefixThrough,
  selectBranch,
  type TreeFields,
} from "../session-tree.js";

/** 树形上下文：消息当节点，按叶子取枝、按可见性过滤。不经过 SessionStore。 */
export function createMessageTree<T extends TreeFields>(messages: T[]) {
  let nodes = ensureEntryIds(messages);
  return {
    get messages() {
      return nodes;
    },
    replace(next: T[]) {
      nodes = ensureEntryIds(next);
      return this;
    },
    branch(leafId?: string | null) {
      return selectBranch(nodes, leafId);
    },
    llmVisible(leafId?: string | null) {
      return filterLlmVisible(leafId === undefined ? nodes : selectBranch(nodes, leafId));
    },
    prefixThrough(entryId: string) {
      return prefixThrough(nodes, entryId);
    },
  };
}
