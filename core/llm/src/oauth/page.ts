/**
 * 本机 OAuth 回调页（成功 / 失败）。不依赖外部静态资源。
 */

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPage(title: string, heading: string, message: string, details?: string): string {
  const detailHtml = details
    ? `<pre style="margin-top:16px;font:13px/1.5 ui-monospace,monospace;color:#a1a1aa;white-space:pre-wrap;word-break:break-word">${escapeHtml(details)}</pre>`
    : "";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    html { color-scheme: dark; }
    body {
      margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 24px; background: #09090b; color: #fafafa;
      font: 15px/1.6 ui-sans-serif, system-ui, sans-serif; text-align: center;
    }
    main { max-width: 520px; }
    h1 { margin: 0 0 10px; font-size: 24px; font-weight: 650; }
    p { margin: 0; color: #a1a1aa; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(heading)}</h1>
    <p>${escapeHtml(message)}</p>
    ${detailHtml}
  </main>
</body>
</html>`;
}

export function oauthSuccessHtml(message = "登录完成，可以关闭此窗口回到终端。"): string {
  return renderPage("登录成功", "登录成功", message);
}

export function oauthErrorHtml(message: string, details?: string): string {
  return renderPage("登录失败", "登录失败", message, details);
}
