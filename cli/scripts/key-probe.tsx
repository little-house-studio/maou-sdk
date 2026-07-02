import React from "react";
import { render, useInput, Text } from "ink";
function App() {
  useInput((input, key) => {
    process.stderr.write(`[probe] input=${JSON.stringify(input)} key=${JSON.stringify({return:key.return, ctrl:key.ctrl, shift:key.shift, escape:key.escape, name:(key as any).name})}\n`);
  });
  return React.createElement(Text, null, "probe ready");
}
render(React.createElement(App), { exitOnCtrlC: false });
