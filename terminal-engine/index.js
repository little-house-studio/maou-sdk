export function initEngine() {}
export function setPersistPath() {}
export function setFilter() {}
export function setSandbox() {}
export function shutdown() {}
export function cleanupAgent() {}
export function statusPanel() { return ""; }
export function list() { return []; }
export async function logs() { return ""; }
export async function run(agentName, command, cwd, description, timeoutMs, resultLimit) {
  throw new Error("[terminal-engine] Rust 终端引擎未安装，请安装 Rust + VS Build Tools 后运行 scripts/build-native.ps1");
}
export async function runBackground(agentName, command, cwd, description, id) {
  throw new Error("[terminal-engine] Rust 终端引擎未安装");
}
export async function remove() {
  throw new Error("[terminal-engine] Rust 终端引擎未安装");
}
export async function stop() {
  throw new Error("[terminal-engine] Rust 终端引擎未安装");
}
export async function write(id, agentName, input) {
  throw new Error("[terminal-engine] Rust 终端引擎未安装");
}