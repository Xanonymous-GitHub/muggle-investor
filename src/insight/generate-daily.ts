import type { DigestSnapshot, SectorBoard } from "@/sources/darkfanxing";
import { buildDailyFacts } from "./facts";
import type { Lens } from "./lens";
import { type ProduceDeps, type ProduceResult, produceBriefing } from "./pipeline";
import { buildDailyPrompts, DAILY_PROMPT_VERSION } from "./prompts/daily";

/**
 * Produces the daily briefing for `digest.tradeDate` in one lens. A board from a different trade
 * date is ignored (with a warning) rather than mixed into the facts.
 */
export async function generateDailyBriefing(
  deps: ProduceDeps,
  input: { digest: DigestSnapshot; board: SectorBoard | null; lens: Lens },
): Promise<ProduceResult> {
  const { digest, lens } = input;
  let board = input.board;
  if (board && board.tradeDate !== digest.tradeDate) {
    deps.logger.warn(
      { digestDate: digest.tradeDate, boardDate: board.tradeDate, lens },
      "sector board is for another trade date; building the daily briefing without it",
    );
    board = null;
  }
  const facts = buildDailyFacts(digest, board);
  const { system, prompt } = buildDailyPrompts(lens, facts, digest.caveats);
  return produceBriefing(deps, {
    kind: "daily",
    periodKey: facts.periodKey,
    lens,
    promptVersion: DAILY_PROMPT_VERSION,
    system,
    prompt,
    facts,
  });
}
