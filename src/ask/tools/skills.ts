/// <reference types="vite/client" />
// Skills: Traditional Chinese markdown playbooks the model loads on demand with `loadSkill`.
// Bundled at build time (Vite `import.meta.glob`, which also works under Vitest and Nitro).
import { tool } from "ai";
import { z } from "zod";

export type Skill = { name: string; description: string; body: string };

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Splits `name`/`description` front matter from the body; throws on a malformed skill file. */
export function parseSkill(source: string): Skill {
  const match = FRONT_MATTER.exec(source.trim());
  if (!match) throw new Error("skill file has no front matter");
  const fields = new Map<string, string>();
  for (const line of (match[1] as string).split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0) fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  const name = fields.get("name");
  const description = fields.get("description");
  if (!name) throw new Error("skill front matter lacks name");
  if (!description) throw new Error("skill front matter lacks description");
  return { name, description, body: (match[2] as string).trim() };
}

const files = import.meta.glob<string>("../skills/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

const SKILLS: Skill[] = Object.values(files)
  .map(parseSkill)
  .sort((a, b) => a.name.localeCompare(b.name));
const byName = new Map(SKILLS.map((skill) => [skill.name, skill]));

export function listSkills(): { name: string; description: string }[] {
  return SKILLS.map(({ name, description }) => ({ name, description }));
}

export function createSkillTool() {
  const catalogue = SKILLS.map((s) => `${s.name}：${s.description}`).join("\n");
  return {
    loadSkill: tool({
      description: `載入一份回答流程（技能）。遇到符合下列情況的問題，先載入對應技能再照著做：\n${catalogue}`,
      inputSchema: z.object({ name: z.string().describe("技能名稱") }),
      execute: ({ name }) => {
        const skill = byName.get(name);
        if (!skill) return { error: "unknown_skill", available: SKILLS.map((s) => s.name) };
        return { name: skill.name, description: skill.description, body: skill.body };
      },
    }),
  };
}
