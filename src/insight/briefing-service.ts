import type { Db } from "@/db/client";
import {
  type Briefing,
  BriefingDriftError,
  type BriefingKind,
  getBriefing,
  latestBriefing,
} from "@/db/repositories/briefings";
import { type GlossaryTerm, getTerm } from "@/glossary";
import { logger } from "@/lib/logger";
import type { Lens } from "./lens";

export type BriefingResponse = { briefing: Briefing; terms: Record<string, GlossaryTerm> };

/** Glossary entries for exactly the ids the briefing cites; ids the glossary lacks are dropped. */
function withTerms(briefing: Briefing): BriefingResponse {
  const terms: Record<string, GlossaryTerm> = {};
  for (const id of briefing.content.termIds) {
    const term = getTerm(id);
    if (term) terms[id] = term;
  }
  return { briefing, terms };
}

/** A stored briefing that no longer matches the content schema reads as missing, not as a failure. */
async function read(
  kind: BriefingKind,
  lens: Lens,
  load: () => Promise<Briefing | null>,
): Promise<BriefingResponse | null> {
  try {
    const briefing = await load();
    return briefing ? withTerms(briefing) : null;
  } catch (error) {
    if (!(error instanceof BriefingDriftError)) throw error;
    logger.warn(
      { kind, lens, reason: error.message },
      "stored briefing is drifted; treating as not found",
    );
    return null;
  }
}

export const getLatestBriefing = (db: Db, lens: Lens): Promise<BriefingResponse | null> =>
  read("daily", lens, () => latestBriefing(db, "daily", lens));

export const getDailyBriefing = (
  db: Db,
  date: string,
  lens: Lens,
): Promise<BriefingResponse | null> =>
  read("daily", lens, () => getBriefing(db, "daily", date, lens));

export const getWeeklyBriefing = (
  db: Db,
  weekKey: string,
  lens: Lens,
): Promise<BriefingResponse | null> =>
  read("weekly", lens, () => getBriefing(db, "weekly", weekKey, lens));
