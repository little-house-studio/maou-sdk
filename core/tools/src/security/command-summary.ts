/**
 * 终端命令人话简介 —— 给审批 UI 用的短说明（非安全裁决本身）。
 */

export type CommandRiskLevel = "low" | "high";

export interface CommandHumanSummary {
  /** 一句人话，说明这条命令大概在干什么 */
  summary: string;
  /** 风险：low=普通确认(黄)，high=危险确认(红) */
  risk: CommandRiskLevel;
  /** 短标签：读/装依赖/删文件… */
  label: string;
}

function firstToken(cmd: string): string {
  const t = cmd.trim().replace(/^\s*sudo\s+/i, "");
  return (t.split(/\s+/)[0] || "").replace(/^.*\//, "").toLowerCase();
}

/**
 * 根据命令文本生成用户可读简介。
 * @param risk 来自安全门禁的分级（dangerous → high，其余 ask → low）
 */
export function describeCommandForApproval(
  command: string,
  risk: CommandRiskLevel = "low",
): CommandHumanSummary {
  const raw = command.trim().replace(/\s+/g, " ");
  const cmd = raw.replace(/^\s*sudo\s+/i, "");
  const bin = firstToken(cmd);
  const lower = cmd.toLowerCase();

  const base = (label: string, summary: string): CommandHumanSummary => ({
    label,
    summary,
    risk,
  });

  // ── 读 / 查 ──
  if (/^(ls|dir|pwd|whoami|id|uname|date|hostname|env|printenv|which|type|file|stat|wc|head|tail|cat|less|more|tree|du|df)\b/.test(lower)) {
    return base("查看", "在终端里查看信息或列出文件，一般不改动你的项目。");
  }
  if (/^(git)\s+(status|log|diff|show|branch|remote|stash\s+list)\b/.test(lower)) {
    return base("查看 Git", "查看仓库状态或历史，不会提交、删除或改写历史。");
  }
  if (/^(git)\s+clone\b/.test(lower)) {
    return base("克隆仓库", "从远端下载一份代码仓库到本地。");
  }
  if (/^(git)\s+(fetch|pull)\b/.test(lower)) {
    return base("更新代码", "从远端拉取最新提交到本地分支。");
  }
  if (/^(git)\s+push\b/.test(lower)) {
    return base("推送代码", "把本地提交上传到远端仓库。");
  }
  if (/^(git)\s+commit\b/.test(lower)) {
    return base("创建提交", "把已暂存的改动写成一次 Git 提交。");
  }
  if (/^(git)\s+add\b/.test(lower)) {
    return base("暂存改动", "把文件改动加入 Git 暂存区，准备提交。");
  }
  if (/^(git)\s+(checkout|switch|restore)\b/.test(lower)) {
    return base("切换/还原", "切换分支或还原文件内容，可能丢掉未保存的改动。");
  }
  if (/^(git)\s+(reset|clean|rebase|push\s+.*--force|push\s+-f)\b/.test(lower)) {
    return base("改写历史", "可能丢弃提交或未跟踪文件，属于高风险 Git 操作。");
  }

  // ── 包管理 / 构建 ──
  if (/^(npm|pnpm|yarn|bun)\s+(i|install|add|ci)\b/.test(lower)) {
    return base("安装依赖", "安装或更新项目依赖包（可能修改 lockfile 与 node_modules）。");
  }
  if (/^(npm|pnpm|yarn|bun)\s+(run|test|build|start|dev|lint|typecheck)\b/.test(lower) || /^(npx|tsx|vite|vitest|tsc|jest|pytest|cargo|go)\b/.test(lower)) {
    return base("运行脚本", "运行构建、测试或开发脚本，通常会读写项目文件/产物。");
  }
  if (/^(pip|pip3|uv|poetry|cargo)\s+(install|add)\b/.test(lower)) {
    return base("安装依赖", "安装语言依赖包到当前环境。");
  }
  if (/^(docker|podman)\b/.test(lower)) {
    return base("容器操作", "操作 Docker/容器（拉取镜像、运行或清理），可能影响本机容器环境。");
  }
  if (/^(kubectl|helm)\b/.test(lower)) {
    return base("集群操作", "对 Kubernetes 集群发起请求，可能改动线上资源。");
  }

  // ── 写 / 删 ──
  if (/^(rm|rmdir|unlink)\b/.test(lower) || /\brm\s+(-[a-z]*r|[a-z]*r-)/i.test(lower)) {
    return base("删除文件", "删除文件或目录，删错可能难以恢复。");
  }
  if (/^(mv|cp|install)\b/.test(lower)) {
    return base("复制/移动", "复制或移动文件，可能覆盖目标路径已有内容。");
  }
  if (/^(chmod|chown)\b/.test(lower)) {
    return base("改权限", "修改文件权限或所有者。");
  }
  if (/^(mkdir|touch)\b/.test(lower)) {
    return base("创建文件", "创建目录或空文件。");
  }
  if (/^(curl|wget)\b/.test(lower) && (/\|/.test(cmd) || /\b-o\b|\b--output\b/.test(lower))) {
    return base("下载内容", "从网络下载内容，可能写入本地文件或通过管道执行。");
  }
  if (/^(curl|wget)\b/.test(lower)) {
    return base("网络请求", "向网络地址发起请求，可能上传或下载数据。");
  }
  if (/^(ssh|scp|rsync)\b/.test(lower)) {
    return base("远程访问", "连接远程机器或同步文件，可能改动远端数据。");
  }
  if (/^(kill|pkill|killall)\b/.test(lower)) {
    return base("结束进程", "结束本机正在运行的进程。");
  }
  if (/^(brew|apt|apt-get|yum|dnf|pacman)\b/.test(lower)) {
    return base("系统软件", "安装或管理系统级软件包。");
  }
  if (/^(open|xdg-open|start)\b/.test(lower)) {
    return base("打开资源", "用系统默认程序打开文件或链接。");
  }

  // 兜底
  if (risk === "high") {
    return base(
      "高风险命令",
      `将执行终端命令「${bin || "cmd"}」：系统判定为高风险，请确认你理解它会改动什么再授权。`,
    );
  }
  return base(
    "终端命令",
    `将执行终端命令「${bin || "cmd"}」：请根据命令本身判断是否允许 AI 在本机运行。`,
  );
}
