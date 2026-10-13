// Pure shaping of the sector board and the digest's quadrant section for the 族群 screen.
import type { DigestSnapshot, Quadrant, SectorRow } from "@/sources/darkfanxing/schemas";

export type SectorView = "change" | "flow" | "quadrant";
export type SortKey = "name" | "changePct" | "advancers" | "turnover" | "change1mPct";
export type SortDir = "asc" | "desc";

/** Case-insensitive substring match on the sector name; a blank query keeps every row. */
export function filterSectors(rows: SectorRow[], query: string): SectorRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return rows;
  return rows.filter((r) => r.name.toLowerCase().includes(needle));
}

/** Stable sort into a new array. A missing `change1mPct` goes last in either direction. */
export function sortSectors(rows: SectorRow[], key: SortKey, dir: SortDir): SectorRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "name") return sign * a.name.localeCompare(b.name, "zh-Hant");
    if (key === "change1mPct") {
      const x = a.change1mPct;
      const y = b.change1mPct;
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      return sign * (x - y);
    }
    return sign * (a[key] - b[key]);
  });
}

const QUADRANT_ORDER: Quadrant[] = ["強勢", "轉強", "轉弱", "弱勢"];

export type QuadrantSummary = {
  counts: { label: Quadrant; today: number; prev: number | null }[];
  transitions: { name: string; from: Quadrant; to: Quadrant }[];
  leaders: { label: string; names: string[] }[];
};

export function quadrantSummary(q: NonNullable<DigestSnapshot["quadrant"]>): QuadrantSummary {
  return {
    counts: QUADRANT_ORDER.map((label) => ({
      label,
      today: q.counts.today[label],
      prev: q.counts.prev === null ? null : q.counts.prev[label],
    })),
    transitions: q.transitions.map(({ name, from, to }) => ({ name, from, to })),
    leaders: q.leaders.map((l) => ({ label: l.label, names: l.entries.map((e) => e.name) })),
  };
}
