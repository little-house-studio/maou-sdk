/** @deprecated 请从 `../security/index.js` 导入 */
export {
  evaluateWithDcg,
  resolveDcgBinary,
  ensureDcgInstalled,
  formatDcgDenyMessage,
  setDcgEvaluatorForTest,
  resetDcgBinaryCache,
} from "../security/dcg/client.js";
export type {
  DcgEvalResult,
  DcgGuardOptions,
  DcgDecision,
  DcgEvaluator,
} from "../security/dcg/client.js";
