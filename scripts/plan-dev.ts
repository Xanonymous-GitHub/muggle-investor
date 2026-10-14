/**
 * Runs the planner against the real database from .env, to check the engine on stored data.
 *
 * Usage:
 *   bun run plan:dev -- --level 3 --lump 600000 --monthly 15000 --expenses 30000 --reserve 90000 --income stable
 *   bun run plan:dev -- --discover
 *
 * The plan uses the same `planPortfolio` as `POST /api/plan` and prints the profile, the amounts,
 * the selected instruments (history and median turnover), the window and the three scenarios.
 * `--level` is reached through the questionnaire (see `parsePlanArgs`). `--discover` prints the
 * ETFs in the stored universe that are in no category list, with a name-based guess. Prints no
 * environment values; failures print only `describeFailure`'s fixed category. Exits 1 on bad
 * arguments, a database failure or an unavailable plan.
 */
import { getEnv } from "@/config/env";
import { listEtfUniverse } from "@/db/repositories/etf-universe";
import { getPriceStats } from "@/db/repositories/prices";
import { toTaipei } from "@/market-clock/market-clock";
import { type PlanArgs, parsePlanArgs } from "@/planner/plan-args";
import { DataUnavailableError, planPortfolio } from "@/planner/plan-service";
import { CATEGORY_MEMBERS } from "@/planner/rules/instruments";
import type { PlanBacktest, PlanResponse } from "@/planner/schema";
import {
  type Candidate,
  discoverCandidates,
  medianTurnover,
  selectInstruments,
} from "@/planner/selection";
import { describeFailure } from "@/server/describe-failure";
import { getDb } from "@/server/services";

const parsed = parsePlanArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(parsed.message);
  process.exit(1);
}

const exitCode = await run(parsed.value).catch((error: unknown) => {
  console.error(describeFailure(error));
  return 1;
});
process.exit(exitCode);

const twd = (n: number) => n.toLocaleString("en-US");
const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(2)}%`);

async function run(args: PlanArgs) {
  getEnv();
  const db = getDb();

  if (args.mode === "discover") {
    const universe = await listEtfUniverse(db);
    const found = discoverCandidates(universe);
    console.log(`ETF universe ${universe.length} rows; ${found.length} in no category list`);
    for (const hint of ["core", "bond", "dividend", null] as const) {
      const group = found.filter((row) => row.hint === hint);
      console.log(`\n[${hint ?? "no guess"}] ${group.length}`);
      for (const row of group) console.log(`  ${row.symbol}  ${row.name}`);
    }
    return 0;
  }

  const now = new Date();
  await printSelection(db, toTaipei(now).date);
  try {
    const plan = await planPortfolio({ db, now }, args.request);
    printPlan(plan, args.level, args.request);
    return 0;
  } catch (error) {
    if (error instanceof DataUnavailableError) {
      console.error("data unavailable: no eligible core instrument has price data");
      return 1;
    }
    throw error;
  }
}

/** Per category: who is eligible, who is not and why (the data behind the primaries). */
async function printSelection(db: ReturnType<typeof getDb>, asOf: string) {
  const names = new Map((await listEtfUniverse(db)).map((row) => [row.symbol, row.name]));
  const candidates: Candidate[] = [];
  for (const symbol of Object.values(CATEGORY_MEMBERS).flat()) {
    const stats = await getPriceStats(db, symbol);
    if (stats) candidates.push({ symbol, name: names.get(symbol) ?? symbol, stats });
  }
  const selection = selectInstruments(candidates, asOf);
  console.log(`selection as of ${asOf}`);
  for (const category of ["core", "bond", "dividend"] as const) {
    const { primary, alternate, rejected } = selection[category];
    console.log(
      `  ${category}: primary ${primary?.symbol ?? "none"}, alternate ${alternate?.symbol ?? "none"}`,
    );
    for (const c of [primary, alternate]) if (c) console.log(`    ${describe(c)}`);
    for (const r of rejected) {
      const stats = candidates.find((c) => c.symbol === r.symbol);
      console.log(
        `    rejected ${r.symbol} (${r.reasons.join(", ")})${stats ? ` ${describe(stats)}` : ""}`,
      );
    }
    const missing = CATEGORY_MEMBERS[category].filter(
      (s) => !candidates.some((c) => c.symbol === s),
    );
    if (missing.length > 0) console.log(`    no stored bars: ${missing.join(", ")}`);
  }
  console.log("");
}

const describe = (c: Candidate) =>
  `${c.symbol} ${c.name}: ${c.stats.firstDate}..${c.stats.lastDate}, ${c.stats.barCount} bars, median turnover ${twd(Math.round(medianTurnover(c.stats)))}`;

function printPlan(plan: PlanResponse, level: number, request: { lump: number; monthly: number }) {
  const { profile, amounts } = plan;
  console.log(
    `profile: level ${profile.level} (requested ${level}), capacity ${profile.capacity}, willingness ${profile.willingness}, capped by horizon ${profile.cappedByHorizon}, reserve first ${profile.reserveFirst}`,
  );
  console.log(
    `amounts: lump ${twd(request.lump)}, monthly ${twd(request.monthly)}; reserve target ${twd(amounts.reserveTarget)}, gap ${twd(amounts.reserveGap)}, investable ${twd(amounts.investable)}, tranche months ${amounts.trancheMonths}, months to fill reserve ${amounts.monthsToFillReserve ?? "n/a"}`,
  );
  const s = amounts.slices;
  console.log(
    `slices: core ${twd(s.core)}, bond ${twd(s.bond)}, dividend ${twd(s.dividend)}, satellite ${twd(s.satellite)}, cash ${twd(s.cash)}`,
  );
  if (plan.kind !== "plan") {
    console.log(`result: ${plan.kind}`);
  } else {
    for (const i of plan.instruments) {
      console.log(
        `instrument ${i.category}: ${i.symbol} ${i.name} (alternate ${i.alternate ?? "none"})`,
      );
    }
    console.log(`rhythm: ${plan.rhythm.trancheMonths} tranche month(s)`);
    console.log(
      `window: ${plan.window.from}..${plan.window.to} (${plan.window.years} years) from ${plan.window.symbols.join(", ")}`,
    );
    for (const name of ["lump", "dca", "plan"] as const) printScenario(name, plan.scenarios[name]);
    if (plan.equityOnly) {
      console.log(`\nequity only, from ${plan.equityOnly.from} (${plan.equityOnly.years} years)`);
      for (const name of ["lump", "dca", "plan"] as const) {
        printScenario(name, plan.equityOnly[name]);
      }
    } else {
      console.log("\nequity only: none");
    }
  }
  for (const warning of plan.warnings) console.log(`warning: ${warning}`);
  for (const assumption of plan.assumptions) console.log(`assumption: ${assumption}`);
}

function printScenario(name: string, r: PlanBacktest) {
  console.log(
    `\n[${name}] ${r.from}..${r.to}: invested ${twd(r.invested)}, final ${twd(r.finalValue)}, xirr ${pct(r.xirr)}, cagr ${pct(r.cagr)}, max drawdown ${pct(r.maxDrawdown)}, worst year ${pct(r.worstYear)}, volatility ${pct(r.volatility)}, ${r.valueSeries.length} month-end points`,
  );
}
