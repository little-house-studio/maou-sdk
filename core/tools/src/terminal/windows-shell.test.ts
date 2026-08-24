import { describe, expect, it } from "vitest";
import {
  classifyWindowsShell,
  windowsAgentInvocation,
  wrapUnixPipefail,
} from "./windows-shell.js";

describe("windows-shell", () => {
  it("classify PowerShell / cmd / Git Bash", () => {
    expect(
      classifyWindowsShell(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`),
    ).toBe("powershell");
    expect(classifyWindowsShell("pwsh")).toBe("powershell");
    expect(classifyWindowsShell(String.raw`C:\Windows\System32\cmd.exe`)).toBe("cmd");
    expect(classifyWindowsShell(String.raw`C:\Program Files\Git\bin\bash.exe`)).toBe("unix-like");
  });

  it("PowerShell agent 用 -Command，不用 /c", () => {
    const inv = windowsAgentInvocation(
      "echo hi",
      String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
    );
    expect(inv.args).toEqual(["-NoProfile", "-NonInteractive", "-Command", "echo hi"]);
  });

  it("显式 cmd 仍走 /d /s /c", () => {
    const inv = windowsAgentInvocation("echo hi", String.raw`C:\Windows\System32\cmd.exe`);
    expect(inv.args).toEqual(["/d", "/s", "/c", "echo hi"]);
  });

  it("显式 Git Bash 走 -c", () => {
    const inv = windowsAgentInvocation("echo hi", String.raw`C:\Program Files\Git\bin\bash.exe`);
    expect(inv.args).toEqual(["-c", "echo hi"]);
  });
});

describe("wrapUnixPipefail", () => {
  it("bash/zsh/sh 包一层 pipefail", () => {
    expect(wrapUnixPipefail("false | true", "/bin/zsh")).toBe("set -o pipefail; false | true");
    expect(wrapUnixPipefail("false | true", "/bin/bash")).toBe("set -o pipefail; false | true");
    expect(wrapUnixPipefail("false | true", "/bin/sh")).toBe("set -o pipefail; false | true");
  });

  it("已有 pipefail 不再包", () => {
    expect(wrapUnixPipefail("set -o pipefail; echo x", "/bin/zsh")).toBe(
      "set -o pipefail; echo x",
    );
  });

  it("fish 不包", () => {
    expect(wrapUnixPipefail("echo x", "/usr/bin/fish")).toBe("echo x");
  });
});
