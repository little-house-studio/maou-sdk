// 最小测试：Ink + react-ink-textarea 在 pty 下 onSubmit 是否触发
import pty from "@lydell/node-pty";
const code = `
import React from "react";
import { render, Text } from "ink";
import { TextArea } from "react-ink-textarea";
function App() {
  const [v, setV] = React.useState("");
  return React.createElement(React.Fragment, null, [
    React.createElement(Text, { key: "lbl" }, "type + enter:"),
    React.createElement(TextArea, { key: "ta", focus: true, value: v, onChange: setV, onSubmit: (val) => { process.stdout.write("[ONSUBMIT] " + JSON.stringify(val) + "\\n"); } })
  ]);
}
render(React.createElement(App), { exitOnCtrlC: false });
`;
const t = pty.spawn("/Users/mac/.nvm/versions/node/v24.13.0/bin/node", ["--input-type=module", "-e", code], {
  cols: 80, rows: 24, cwd: "/Users/mac/Documents/vscodeProject/maou-sdk/cli", env: { ...process.env, FORCE_COLOR: "0" },
});
let out = "";
t.onData(d => out += d);
await new Promise(r => setTimeout(r, 1000));
t.write("hi\r");
await new Promise(r => setTimeout(r, 800));
const stripped = out.replace(/\x1b\[[0-9;?]*[a-zA-Z~<]/g, "").replace(/\r/g, "\\r");
process.stderr.write("输出:\n" + stripped + "\n");
process.stderr.write("onSubmit 触发: " + out.includes("[ONSUBMIT]") + "\n");
t.write("\x03");
await new Promise(r => setTimeout(r, 200));
process.exit(0);
