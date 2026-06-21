/**
 * 表情检测 — 从文本内容推断表情状态
 * 用于桌面宠物和 UI 表情渲染
 */

/** 表情 → 状态映射 */
const EMOJI_MAP: Record<string, string> = {
  '😊': 'happy', '😄': 'laughing', '😂': 'laughing', '🤣': 'laughing',
  '😢': 'sad', '😭': 'crying', '😿': 'crying',
  '😠': 'angry', '😡': 'angry',
  '🤔': 'thinking', '😕': 'confused',
  '😮': 'surprised', '😲': 'surprised',
  '😉': 'wink', '🥰': 'love', '😍': 'love', '❤️': 'love', '💕': 'love',
  '😎': 'cool', '😴': 'sleepy', '💤': 'sleepy',
  '😨': 'scared', '😰': 'scared',
  '😜': 'silly', '😐': 'deadpan',
  '🥺': 'pleading', '🤩': 'starry',
  '✨': 'excited', '🎉': 'excited',
  '🤗': 'happy', '😇': 'happy',
  '🤯': 'surprised', '😳': 'surprised',
  '😤': 'angry', '😩': 'tired',
  '😏': 'smirk', '🤨': 'confused',
  '🤪': 'silly', '😋': 'silly',
  '😱': 'scared', '🙀': 'scared',
}

/** 关键词 → 状态映射 */
const KEYWORD_MAP: Array<[string[], string]> = [
  [['lol', 'haha'], 'laughing'],
  [['hmm', 'let me think', 'let me see', 'i think', 'considering'], 'thinking'],
  [['wow', 'amazing', 'incredible', 'unbelievable'], 'surprised'],
  [['unfortunately', 'sadly', 'regret', 'sorry'], 'sad'],
  [['angry', 'annoying', 'frustrating'], 'angry'],
  [['love', 'wonderful', 'beautiful', 'fantastic'], 'love'],
]

/**
 * 从 assistant 内容检测表情
 * @param content - 文本内容
 * @returns 表情状态名称
 */
export function detectExpression(content: string): string {
  if (!content) return 'neutral'

  // 优先匹配 emoji
  for (const [emoji, expr] of Object.entries(EMOJI_MAP)) {
    if (content.includes(emoji)) return expr
  }

  // 降级匹配关键词
  const lower = content.toLowerCase()
  for (const [keywords, expr] of KEYWORD_MAP) {
    if (keywords.some(kw => lower.includes(kw))) return expr
  }

  return 'neutral'
}