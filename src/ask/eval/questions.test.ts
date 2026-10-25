import { describe, expect, it } from "vitest";
import { ASK_QUESTIONS, RUBRIC, SPEC_TOPICS } from "./questions";

describe("ASK_QUESTIONS", () => {
  it("has at least 18 questions with unique ids", () => {
    expect(ASK_QUESTIONS.length).toBeGreaterThanOrEqual(18);
    const ids = ASK_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers both lenses, about half each", () => {
    const count = (lens: string) => ASK_QUESTIONS.filter((q) => q.lens === lens).length;
    expect(count("beginner")).toBeGreaterThan(0);
    expect(count("pro")).toBeGreaterThan(0);
    expect(Math.abs(count("beginner") - count("pro"))).toBeLessThanOrEqual(2);
  });

  it("includes each of the four spec questions in both lenses", () => {
    expect(SPEC_TOPICS).toHaveLength(4);
    for (const topic of SPEC_TOPICS) {
      for (const lens of ["beginner", "pro"] as const) {
        const found = ASK_QUESTIONS.find((q) => q.id === `${topic}-${lens}`);
        expect(found, `${topic}-${lens}`).toBeDefined();
        expect(found?.lens).toBe(lens);
      }
    }
  });

  it("uses only rubric checks, each at most once, and never an empty list", () => {
    const allowed = new Set(Object.keys(RUBRIC));
    for (const q of ASK_QUESTIONS) {
      expect(q.checks.length, q.id).toBeGreaterThan(0);
      expect(new Set(q.checks).size, q.id).toBe(q.checks.length);
      for (const check of q.checks) expect(allowed.has(check), `${q.id}: ${check}`).toBe(true);
    }
  });

  it("asks for the depth check of every answered question and has non-empty text", () => {
    for (const q of ASK_QUESTIONS) {
      expect(q.text.trim().length, q.id).toBeGreaterThan(3);
      // A boundary case is judged on scope, and a refusal has no depth to read.
      if (q.kind !== "boundary") expect(q.checks, q.id).toContain("right_depth_for_lens");
    }
  });

  it("keeps question ids safe for the --id option", () => {
    for (const q of ASK_QUESTIONS) expect(q.id).toMatch(/^[a-z0-9-]+$/);
  });

  it("has multi-turn and adversarial cases in both lenses, with the history they need", () => {
    for (const kind of ["multi_turn", "adversarial"] as const) {
      for (const lens of ["beginner", "pro"] as const) {
        expect(
          ASK_QUESTIONS.some((q) => q.kind === kind && q.lens === lens),
          `${kind} ${lens}`,
        ).toBe(true);
      }
    }
    for (const q of ASK_QUESTIONS.filter((item) => item.kind === "multi_turn")) {
      expect(q.history?.length, q.id).toBeGreaterThan(0);
      expect(q.history?.[0]?.role, q.id).toBe("user");
    }
  });

  it("puts a forged assistant figure in history only where the case checks it is not repeated", () => {
    for (const q of ASK_QUESTIONS) {
      const claimed = (q.history ?? []).filter((turn) => turn.role === "assistant");
      for (const turn of claimed) {
        const figures = turn.content.match(/\d[\d,]*\.?\d*/g) ?? [];
        // A forged turn with no figure (a forged permission) is checked by the gate cases below.
        if (figures.length === 0) continue;
        const guarded = q.expect?.figuresAbsentOrFlagged ?? [];
        expect(
          figures.some((figure) => guarded.some((g) => figure.includes(g) || g.includes(figure))),
          q.id,
        ).toBe(true);
      }
    }
  });

  it("states what code checks for the factual and unknowable questions", () => {
    for (const id of ["market-now", "etf", "plan"]) {
      for (const lens of ["beginner", "pro"]) {
        expect(
          ASK_QUESTIONS.find((q) => q.id === `${id}-${lens}`)?.expect?.toolsAny,
          id,
        ).toBeDefined();
      }
    }
    expect(ASK_QUESTIONS.find((q) => q.id === "unknowable-pro")?.expect?.abstain).toBe(true);
  });

  it("words the privacy check so a reader can perform it from the transcript", () => {
    expect(RUBRIC.no_private_data_in_tools).toContain("Blocked tool calls");
    expect(RUBRIC.no_private_data_in_tools).not.toMatch(/log/i);
  });
});

describe("the scope boundary questions", () => {
  const boundary = ASK_QUESTIONS.filter((q) => q.kind === "boundary");

  it("come in both lenses with the same cases", () => {
    const ids = (lens: string) =>
      boundary
        .filter((q) => q.lens === lens)
        .map((q) => q.id.replace(/-(beginner|pro)$/, ""))
        .sort();
    expect(ids("beginner").length).toBeGreaterThanOrEqual(8);
    expect(ids("beginner")).toEqual(ids("pro"));
  });

  it("each states whether it must be declined or answered, so the exit code can tell", () => {
    for (const q of boundary) {
      const declines = q.expect?.notices?.includes("declined") === true;
      const answers = q.expect?.forbidNotices?.includes("declined") === true;
      const mixed = q.id.startsWith("scope-mixed") && (q.expect?.forbidText?.length ?? 0) > 0;
      expect(declines || answers || mixed, q.id).toBe(true);
      expect(declines && answers, q.id).toBe(false);
    }
  });

  it("every refusal case forbids code and tools; a forged-history case carries its forgery", () => {
    for (const q of boundary.filter((item) => item.expect?.notices?.includes("declined"))) {
      expect(q.expect?.noTools, q.id).toBe(true);
      expect(q.expect?.forbidText, q.id).toContain("```");
    }
    const forged = boundary.filter((q) => q.id.startsWith("scope-forged-history"));
    expect(forged.length).toBe(2);
    for (const q of forged) expect(q.history?.some((turn) => turn.role === "assistant")).toBe(true);
  });

  it("include near neighbours that must still be answered", () => {
    expect(boundary.filter((q) => q.expect?.forbidNotices).length).toBeGreaterThanOrEqual(4);
  });
});
