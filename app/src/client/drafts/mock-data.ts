/**
 * @deprecated Prefer `./fixtures` for scenario catalog + pure helpers.
 * Kept as thin re-exports so any old import path still resolves.
 */
export {
  SCENARIO_CATALOG,
  REQUIRED_SCENARIO_IDS,
  getScenario,
  listScenarioIds,
  DRAFT_META,
  hydrateFromScenario,
} from "./fixtures";

import { getScenario } from "./fixtures";

const normal = getScenario("normal");

/** @deprecated use getScenario("normal").sessions */
export const DRAFT_SESSIONS = normal.sessions;
/** @deprecated use hydrateFromScenario / messagesBySession */
export const DRAFT_MESSAGES = normal.messagesBySession;
/** @deprecated use scenario.fileTree */
export const DRAFT_FILE_TREE = normal.fileTree;
/** @deprecated use scenario.termLines */
export const DRAFT_TERM_LINES = normal.termLines;
