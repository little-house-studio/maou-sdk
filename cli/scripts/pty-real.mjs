import pty from "node-pty";
const term = pty.spawn("/usr/bin/env", ["node", "/Users/mac/Documents/vscodeProject/maou-sdk/cli/dist/index.js"], {
  name: "xterm-256color", cols: 100, rows: 32, cwd: "/Users/mac/Downloads/coding测试", env: { ...process.env, FORCE_COLOR: "1" },
});
let all = ""; term.onData(d => all += d);
await new Promise(r=>setTimeout(r,800));
term.write("读 README.md 一句话总结\x0d");
let waited = 0;
while (waited < 40000) { await new Promise(r=>setTimeout(r,500)); waited += 500; if (all.includes("[ch.01]") || all.includes("DONE")) break; }
const strip = s => s.replace(/\x1b\[[0-9;?]*[a-zA-Z~<]/g,"").replace(/\x1b[()][AB0-2]/g,"").replace(/\r/g,"");
console.log("=== 对话后渲染(末800) ===");
console.log(strip(all).slice(-800));
term.write("\x03"); await new Promise(r=>setTimeout(r,200)); term.kill(); process.exit(0);
