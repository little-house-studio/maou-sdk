/** 与 @little-house-studio/types stripTaskCompletionMarkup 对齐；避免客户端打进 types 整包。 */

const OPEN_TAG = /<task_completion\b/i;
const OPEN_NAME = "<task_completion>";
const CLOSE_NAME = "</task_completion>";

export function stripTaskCompletionMarkup(text: string): string {
  if (!text) return text;
  let out = text.replace(/<task_completion\b[^>]*>[\s\S]*?<\/task_completion>/gi, "");
  const open = out.search(OPEN_TAG);
  if (open >= 0) out = out.slice(0, open);
  const lt = out.lastIndexOf("<");
  if (lt >= 0) {
    const suffix = out.slice(lt).toLowerCase();
    if (OPEN_NAME.startsWith(suffix) || CLOSE_NAME.startsWith(suffix)) {
      out = out.slice(0, lt);
    }
  }
  return out;
}
