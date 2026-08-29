/**
 * CLI overlay 问卷：ask_user 宿主。
 */

import type { AskUserRequest, AskUserResult } from "@little-house-studio/tools";
import { bindAskUserHost } from "@little-house-studio/tools";
import { useStore } from "../state/store.js";

type PendingAsk = {
  payload: AskUserRequest;
  resolve: (result: AskUserResult) => void;
  reject: (err: Error) => void;
};

let pending: PendingAsk | null = null;
const answers = new Map<string, string>();

export function getCliAsk(): AskUserRequest | null {
  return pending?.payload ?? null;
}

export function recordCliAskAnswer(questionId: string, value: string): void {
  answers.set(questionId, value);
}

export function settleCliAsk(result: AskUserResult | null): boolean {
  if (!pending) return false;
  if (result) pending.resolve(result);
  else pending.reject(new Error("ask_user cancelled"));
  pending = null;
  answers.clear();
  return true;
}

export function submitCliAskQuestions(): boolean {
  if (!pending || pending.payload.kind !== "questions") return false;
  const questions = pending.payload.questions ?? [];
  return settleCliAsk({
    kind: "questions",
    answers: questions.map((q) => ({
      questionId: q.id,
      value: answers.get(q.id) ?? "",
      skipped: !answers.get(q.id),
    })),
  });
}

export function bindCliAskHost(): void {
  bindAskUserHost({
    request: (payload) =>
      new Promise<AskUserResult>((resolve, reject) => {
        if (pending) pending.reject(new Error("replaced"));
        pending = { payload, resolve, reject };
        useStore.getState().setOverlay("ask");
      }),
  });
}
