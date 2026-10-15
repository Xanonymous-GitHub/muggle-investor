import { describe, expect, it } from "vitest";
import { QUESTIONS } from "@/planner/rules/questionnaire";
import {
  AMOUNT_COPY,
  AMOUNT_ERROR_COPY,
  FIXED_SENTENCES,
  PRIVACY_LINE,
  QUESTION_COPY,
} from "@/ui/plan/copy";
import { AMOUNT_FIELDS } from "@/ui/plan/draft";
import { DISCLAIMER } from "@/ui/today/view-model";

describe("planner copy", () => {
  it("has a prompt for every question and none extra", () => {
    expect(Object.keys(QUESTION_COPY).sort()).toEqual([
      "age",
      "horizon",
      "income",
      "loss",
      "reserve",
    ]);
    expect(Object.keys(QUESTION_COPY).sort()).toEqual(QUESTIONS.map((q) => q.id).sort());
    for (const q of QUESTIONS) {
      expect(QUESTION_COPY[q.id].prompt.length).toBeGreaterThan(0);
    }
  });

  it("uses the agreed prompts and amount labels", () => {
    expect(QUESTIONS.map((q) => QUESTION_COPY[q.id].prompt)).toEqual([
      "你現在幾歲？",
      "這筆錢多久後可能要用？",
      "你的收入穩定嗎？",
      "手上有幾個月的生活費可以隨時動用？",
      "如果一年內帳面虧損 20%，你會怎麼做？",
    ]);
    expect(AMOUNT_FIELDS.map((f) => AMOUNT_COPY[f].label)).toEqual([
      "現在可以投入的錢",
      "每月還能再投入",
      "每月的生活費",
      "已經有的緊急預備金",
    ]);
  });

  it("never prints the string undefined", () => {
    const all = [
      ...Object.values(QUESTION_COPY).flatMap((c) => [c.prompt, c.hint ?? ""]),
      ...Object.values(AMOUNT_COPY).flatMap((c) => [c.label, c.hint ?? ""]),
      ...Object.values(AMOUNT_ERROR_COPY),
      PRIVACY_LINE,
      ...FIXED_SENTENCES,
    ];
    for (const s of all) expect(s).not.toContain("undefined");
  });

  it("has a message for every amount error and keeps the fixed sentences", () => {
    expect(Object.keys(AMOUNT_ERROR_COPY).sort()).toEqual(
      ["empty", "not_integer", "too_large", "zero"].sort(),
    );
    expect(PRIVACY_LINE).toBe("答案只留在這台裝置；算的時候會暫時傳到伺服器，不會被儲存。");
    expect(FIXED_SENTENCES).toEqual(["過去表現不代表未來。", DISCLAIMER]);
  });
});
