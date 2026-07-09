import { spawn } from "node:child_process";
import xtermNs from "@xterm/headless";
const { Terminal } = xtermNs;
const NODE = "/Users/mac/.nvm/versions/node/v24.13.0/bin/node";
const CLI = "/Users/mac/Documents/vscodeProject/maou-sdk/cli/dist/index.js";
const wrapperCode = `
  Object.defineProperty(process.stdout,'isTTY',{value:true,configurable:true});
  Object.defineProperty(process.stdout,'columns',{value:100,configurable:true});
  Object.defineProperty(process.stdout,'rows',{value:32,configurable:true});
  Object.defineProperty(process.stdin,'isTTY',{value:true,configurable:true});
  process.stdin.setRawMode=()=>process.stdin; process.stdin.ref=()=>{}; process.stdin.unref=()=>{};
  await import("${CLI}");
`;
const term = new Terminal({ cols: 100, rows: 32, allowProposedApi: true });
const child = spawn(NODE, ["--input-type=module","-e",wrapperCode], { cwd: "/Users/mac/Downloads/coding测试", env: { ...process.env, TERM_PROGRAM:"iTerm.app", FORCE_COLOR:"1", COLORTERM:"truecolor" }, stdio: ["pipe","pipe","pipe"] });
let dead=false;
child.stdout.on("data", b => term.write(b.toString("utf-8")));
child.stderr.on("data", b => process.stderr.write("[err] "+b.toString("utf-8")));
child.on("exit", ()=>{dead=true;});
const write = s => { if(!dead) child.stdin.write(s); };
const wait = ms => new Promise(r=>setTimeout(r,ms));
const chatScrollOffset = () => { /* store 内部，读不到。看屏幕 chatScrollOffset 变化 */ };

// 先注入几条消息让对话区可滚（直接 dispatch store 不行，用 /new + 打字）
// 简化：先看 motion 到 NavBar 时 chatScrollOffset 有没有变
// 通过 stderr log store 状态——不行。看屏幕：对话区内容偏移变化
await wait(1500);
const line = r => { const l=term.buffer.active.getLine(r); return l?l.translateToString(true):""; };
process.stderr.write("=== motion 前 row 5 ===\n"+JSON.stringify(line(5))+"\n");
// motion 到 NavBar（row 31 xterm）
write("\x1b[<35;8;31M"); await wait(150);
write("\x1b[<35;20;31M"); await wait(150);
write("\x1b[<35;50;31M"); await wait(150);
process.stderr.write("=== motion NavBar 后 row 5 ===\n"+JSON.stringify(line(5))+"\n");
// motion 到对话区
write("\x1b[<35;50;15M"); await wait(150);
write("\x1b[<35;50;10M"); await wait(150);
process.stderr.write("=== motion 对话区后 row 5 ===\n"+JSON.stringify(line(5))+"\n");
try{write("\x03\x03");}catch{} await wait(300); child.kill("SIGKILL"); process.exit(0);
