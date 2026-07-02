import { TUI, Editor, ProcessTerminal } from "@oh-my-pi/pi-tui";
import type { EditorTheme } from "@oh-my-pi/pi-tui";

const terminal = new ProcessTerminal();
const tui = new TUI(terminal, false);
const editor = new Editor({} as EditorTheme);
editor.onSubmit = (text) => {
  process.stderr.write("[ONSUBMIT] " + JSON.stringify(text) + "\n");
  tui.stop();
  process.exit(0);
};
tui.addChild(editor);
tui.setFocus(editor);
tui.start();
process.stderr.write("[test] editor focused, type + enter\n");
setTimeout(() => { process.stderr.write("[test] 5s timeout\n"); tui.stop(); process.exit(0); }, 5000);
