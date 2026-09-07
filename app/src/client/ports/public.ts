/**
 * Public host-port contract (types only).
 * Live implementation is `createLivePorts` in the SPA host — not this export.
 */
export type AppPortKind = "live";

export type AppPorts = {
  kind: AppPortKind;
  chat: Record<string, unknown>;
  shell: Record<string, unknown>;
  settings: Record<string, unknown>;
  files: Record<string, unknown>;
  terminals: Record<string, unknown>;
  proactive: Record<string, unknown>;
  models: Record<string, unknown>;
};
