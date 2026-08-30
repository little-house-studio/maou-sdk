/** Published thread markers. Rail and stick share these names only. */

export const ASK_ANCHOR_ATTR = "data-ask-anchor";
export const ASK_ID_ATTR = "data-ask-id";
export const ASK_PREVIEW_ATTR = "data-ask-preview";
export const ASK_ANCHOR_SEL = "[data-ask-anchor]";
export const USER_STICK_CLASS = "wire-user-stick";
export const USER_MSG_CLIP_CLASS = "user-msg-clip";
export const THREAD_SCROLL_ATTR = "data-thread-scroll";

export type AskAnchorDataset = {
  askId: string;
  askPreview: string;
};

export type AskAnchorProps = {
  [ASK_ANCHOR_ATTR]: "";
  [ASK_ID_ATTR]: string;
  [ASK_PREVIEW_ATTR]: string;
};

export function askAnchorProps(id: string, preview: string): AskAnchorProps {
  return {
    [ASK_ANCHOR_ATTR]: "",
    [ASK_ID_ATTR]: id,
    [ASK_PREVIEW_ATTR]: preview,
  };
}

export function readAskAnchor(el: HTMLElement): AskAnchorDataset | null {
  const askId = el.dataset.askId;
  if (!askId) return null;
  return { askId, askPreview: el.dataset.askPreview ?? "" };
}
