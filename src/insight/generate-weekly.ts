import { buildWeeklyFacts, type WeeklyDay } from "./facts-weekly";
import type { Lens } from "./lens";
import { type ProduceDeps, type ProduceResult, produceBriefing } from "./pipeline";
import { buildWeeklyPrompts, WEEKLY_PROMPT_VERSION } from "./prompts/weekly";

/**
 * Produces the weekly briefing for `weekKey` in one lens from that week's days. Throws (before
 * any LLM call) when `days` is empty, repeats a date or has a day from another week.
 */
export async function generateWeeklyBriefing(
  deps: ProduceDeps,
  input: { weekKey: string; days: WeeklyDay[]; lens: Lens },
): Promise<ProduceResult> {
  const { weekKey, days, lens } = input;
  const facts = buildWeeklyFacts(weekKey, days);
  const { system, prompt } = buildWeeklyPrompts(lens, facts);
  return produceBriefing(deps, {
    kind: "weekly",
    periodKey: weekKey,
    lens,
    promptVersion: WEEKLY_PROMPT_VERSION,
    system,
    prompt,
    facts,
  });
}
