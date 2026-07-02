// 单独测每个 Alt+Enter 序列（每次重新 spawn，避免缓冲串扰）
import pty from "@lydell/node-pty";
const code = `
import React from "react"; import { render, Text, useInput } from "ink";
function App(){ useInput((input,key)=>{ process.stdout.write("[probe] input="+JSON.stringify(input)+" return="+key.return+" meta="+key.meta+" escape="+key.escape+"\\n"); }); return React.createElement(Text,null,"ready"); }
render(React.createElement(App),{exitOnCtrlC:false});
`;
async function testSeq(name, seq) {
  const t = pty.spawn("/Users/mac/.nvm/versions/node/v24.13.0/bin/node", ["--input-type=module","-e",code], { cols:80, rows:24, cwd:"/Users/mac/Documents/vscodeProject/maou-sdk/cli", env:{...process.env, FORCE_COLOR:"0"} });
  let out=""; t.onData(d=>out+=d);
  await new Promise(r=>setTimeout(r,800));
  t.write(seq);
  await new Promise(r=>setTimeout(r,400));
  const probeLine = out.split("\n").find(l => l.includes("[probe]")) || "";
  const cleaned = probeLine.replace(/\x1b\[[0-9;?]*[a-zA-Z~<]/g,"").replace(/\r/g,"");
  process.stderr.write(name + " → " + cleaned + "\n");
  t.write("\x03"); await new Promise(r=>setTimeout(r,150));
}
await testSeq("\\r 单独", "\r");
await testSeq("\\x1b\\r (ESC+CR)", "\x1b\r");
await testSeq("\\x1b\\n (ESC+LF)", "\x1b\n");
await testSeq("\\x1b[27;3;13~", "\x1b[27;3;13~");
process.exit(0);
