/** @deprecated 请从 `../security/index.js` 导入 */
export {
  assessCommandSecurity,
  gateTerminalCommand,
  mapDcgDenyToTier,
} from "../security/gate.js";
export type {
  SecurityTier,
  SecurityGateAction,
  SecurityAssessment,
  SecurityGateResult,
} from "../security/types.js";
