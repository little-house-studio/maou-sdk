// 最小 textarea + Alt+Enter 测试
import pty from "@lydell/node-pty";
const code = `
import React from "react"; import { render, Text } from "ink"; import { TextArea } from "react-ink-textarea";
function App() {
  const [v, setV] = React.useState("");
  return React.createElement(React.Fragment, null, [
    React.createElement(Text, {key:"l"}, "val=" + JSON.stringify(v)),
    React.createElement(TextArea, {key:"t", focus:true, value:v, onChange:(nv)=>{ process.stdout.write("[onChange] " + JSON.stringify(nv) + "\\n"); setV(nv); }, onSubmit:(val)=>{ process.stdout.write("[ONSUBMIT] " + JSON.stringify(val) + "\\n"); }})
  ]);
}
render(React.createElement(App),{exitOnCtrlC:false});
`;
const t = pty.spawn("/Users/mac/.nvm/versions/node/v24.13.0/bin/node", ["--input-type=module","-e",code], { cols:80, rows:24, cwd:"/Users/mac/Documents/vscodeProject/maou-sdk/cli", env:{...process.env, FORCE_COLOR:"0"} });
let out=""; t.onData(d=>out+=d);
await new Promise(r=>setTimeout(r,800));
// 逐字符 hi
for (const ch of "hi") { t.write(ch); await new Promise(r=>setTimeout(r,40)); }
// Alt+Enter
t.write("\x1b\r");
await new Promise(r=>setTimeout(r,400));
// 逐字符 world
for (const ch of "world") { t.write(ch); await new Promise(r=>setTimeout(r,40)); }
await new Promise(r=>setTimeout(r,400));

const probes = out.split("\n").filter(l => l.includes("[onChange]") || l.includes("[ONSUBMIT]")).map(l => l.replace(/\x1b\[[0-9;?]*[a-zA-Z~<]/g,"").replace(/\r/g,""));
process.stderr.write("=== onChange/onSubmit 事件 ===\n");
probes.forEach(p => process.stderr.write(p + "\n"));
process.stderr.write("\n=== 屏幕显示 ===\n");
const screen = out.replace(/\x1b\[[0-9;?]*[a-zA-Z~<]/g,"").replace(/\x1b[()][AB0-2]/g,"").replace(/\r/g,"");
const lines = screen.split("\n").filter(l => /val=|hi|world/.test(l));
lines.slice(0,5).forEach(l => process.stderr.write(JSON.stringify(l) + "\n"));
t.write("\x03"); await new Promise(r=>setTimeout(r,200)); process.exit(0);
