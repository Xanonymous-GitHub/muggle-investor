import { describe, expect, it } from "vitest";
import { createSkillTool, listSkills, parseSkill } from "./skills";

const OPTIONS = { toolCallId: "t", messages: [], context: {} };

async function loadSkill(name: string): Promise<Record<string, unknown>> {
  const result = await createSkillTool().loadSkill?.execute?.({ name }, OPTIONS);
  return result as Record<string, unknown>;
}

describe("parseSkill", () => {
  it("reads name and description from the front matter and keeps the body", () => {
    const skill = parseSkill("---\nname: demo\ndescription: 一個範例\n---\n\n第一行\n第二行\n");
    expect(skill).toEqual({ name: "demo", description: "一個範例", body: "第一行\n第二行" });
  });

  it("rejects a file without front matter, name or description", () => {
    expect(() => parseSkill("沒有前言")).toThrow();
    expect(() => parseSkill("---\nname: demo\n---\n內容")).toThrow();
    expect(() => parseSkill("---\ndescription: x\n---\n內容")).toThrow();
  });
});

describe("skills", () => {
  it("lists every bundled skill with a name and a description", () => {
    const skills = listSkills();
    expect(skills.map((s) => s.name).sort()).toEqual([
      "etf-evaluation",
      "explain-term",
      "sector-breakdown",
    ]);
    for (const skill of skills) {
      expect(skill.description.trim().length).toBeGreaterThan(0);
    }
  });

  it("loadSkill returns the markdown body of a known skill, without front matter", async () => {
    const result = await loadSkill("explain-term");
    expect(result.name).toBe("explain-term");
    expect(typeof result.body).toBe("string");
    expect(result.body as string).not.toContain("---");
    expect(result.body as string).toContain("lookupTerm");
  });

  it("loadSkill answers an unknown name with the available names", async () => {
    const result = await loadSkill("nope");
    expect(result).toEqual({
      error: "unknown_skill",
      available: ["etf-evaluation", "explain-term", "sector-breakdown"],
    });
  });

  it("loadSkill describes itself in Traditional Chinese and lists the skills for the model", () => {
    const tool = createSkillTool().loadSkill;
    expect(tool?.description).toMatch(/[一-鿿]/);
    for (const skill of listSkills()) expect(tool?.description).toContain(skill.name);
  });

  it.each(listSkills().map((s) => s.name))("skill %s is a plain playbook", async (name) => {
    const result = await loadSkill(name);
    const body = result.body as string;
    expect(body.split("\n").filter((line) => line.trim() !== "").length).toBeGreaterThanOrEqual(10);
    // No hard-coded market data: a 4+ digit sequence may only be a year ("年").
    for (const match of body.matchAll(/\d{4,}/g)) {
      expect(body.slice(match.index + match[0].length, match.index + match[0].length + 1)).toBe(
        "年",
      );
    }
  });
});
