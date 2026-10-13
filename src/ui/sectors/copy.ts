// DRAFT beginner wording for the 族群 screen, awaiting the user's review. All of this screen's
// plain-language copy lives here so the review is a single-file diff; change the strings, not
// the callers. The flow sentence follows the glossary's 內外盤金額差 entry (active buyers vs
// active sellers), so the two never disagree.
import type { Lens } from "@/insight/lens";
import type { SectorRow } from "@/sources/darkfanxing/schemas";
import type { SectorView } from "@/ui/sectors/view-model";

export const VIEW_LABELS: Record<Lens, Record<SectorView, string>> = {
  beginner: { change: "今天誰漲誰跌", flow: "錢跑去哪裡", quadrant: "誰在變強變弱" },
  pro: { change: "漲跌幅", flow: "內外盤金額差", quadrant: "四象限" },
};

export const SECTOR_HELP_TITLE = "什麼是族群？";
export const SECTOR_HELP_BODY =
  "把做同一類生意的公司放在一起看，例如「被動元件」就是做電子零件的那一群。看族群比看單一股票更容易知道錢流向哪裡。";
export const FLOW_NOTE = "只列出前十名流入與前十名流出";
export const QUADRANT_TRANSITIONS_TITLE = "今天換象限";

export function plainChangeLine(row: SectorRow): string {
  const { changePct, constituents, advancers, decliners, limitUp, limitDown } = row;
  const direction = changePct > 0 ? "今天上漲" : changePct < 0 ? "今天下跌" : "今天持平";
  const up = limitUp > 0 ? `，${limitUp} 家漲停` : "";
  const down = limitDown > 0 ? `，${limitDown} 家跌停` : "";
  return `${direction}，${constituents} 家公司裡有 ${advancers} 家上漲、${decliners} 家下跌${up}${down}。`;
}

export function plainFlowLine(netFlow: number): string {
  const shown = Math.abs(netFlow).toFixed(2);
  // A figure that prints as 0.00 reads as "about equal", never as a direction.
  if (Number(shown) === 0) return "今天急著買與急著賣的金額差不多。";
  return netFlow > 0
    ? `今天急著買的金額比急著賣的多約 ${shown} 億元。`
    : `今天急著賣的金額比急著買的多約 ${shown} 億元。`;
}
