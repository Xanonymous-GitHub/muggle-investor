import type { FlowRow } from "@/sources/darkfanxing/schemas";
import { RankedCard } from "@/ui/today/movers-card";
import { flowRows } from "@/ui/today/view-model";

/** Where the day's money went: the groups with the largest net inflow and outflow. */
export function FlowCard({
  netBuy,
  netSell,
}: {
  netBuy: FlowRow[] | null;
  netSell: FlowRow[] | null;
}) {
  return (
    <RankedCard
      title="資金流向"
      groups={[
        { title: "流入最多", rows: flowRows(netBuy) },
        { title: "流出最多", rows: flowRows(netSell) },
      ]}
    />
  );
}
