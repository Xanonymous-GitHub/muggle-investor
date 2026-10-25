// What a request holds that must not reach an external service, gathered in one place: numbers
// (amounts, quantities, plan figures, amounts written in chat) and texts (saved notes, the
// questionnaire answers, sensitive first-person sentences from the chat). Pure.
import { QUESTIONS } from "@/planner/rules/questionnaire";
import { sensitiveFromChat } from "./egress";
import { type AskRequest, privateValues } from "./schema";

/** The wording of the option the person chose for each questionnaire question. */
export function planAnswerTexts(plan: AskRequest["profile"]["plan"]): string[] {
  if (!plan) return [];
  const texts: string[] = [];
  for (const question of QUESTIONS) {
    const chosen = (plan.answers as Record<string, string>)[question.id];
    const label = question.options.find((option) => option.id === chosen)?.label;
    if (label) texts.push(label);
  }
  return texts;
}

export type RequestPrivacy = {
  /** Live: the data tools add plan-derived amounts while the answer runs. */
  numbers: number[];
  texts: string[];
  /** Symbols of the user's holdings: public, so searching for them is allowed. */
  publicSymbols: Set<string>;
};

export function requestPrivacy(request: Pick<AskRequest, "profile" | "messages">): RequestPrivacy {
  const { profile, messages } = request;
  const own = privateValues(profile);
  const chat = sensitiveFromChat(messages);
  return {
    numbers: [...own.numbers, ...chat.numbers],
    texts: [...own.texts, ...planAnswerTexts(profile.plan), ...chat.texts],
    publicSymbols: new Set(profile.holdings.map((holding) => holding.symbol)),
  };
}
