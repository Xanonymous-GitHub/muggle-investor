import { cn } from "@/lib/utils";
import { trendClass } from "@/ui/format";
import type { Tile } from "@/ui/today/view-model";

/** Small number tiles: the value large, its label under it. */
export function TileGrid({ tiles }: { tiles: Tile[] }) {
  if (tiles.length === 0) return null;
  return (
    <dl
      className={cn(
        "grid grid-cols-2 gap-2",
        tiles.length % 3 === 0 ? "sm:grid-cols-3" : "sm:grid-cols-4",
      )}
    >
      {tiles.map((tile) => (
        <div key={tile.id} className="flex min-w-0 flex-col-reverse rounded-lg bg-muted px-3 py-2">
          <dt className="text-xs text-muted-foreground">{tile.label}</dt>
          <dd className={cn("text-base font-semibold tabular-nums", trendClass(tile.trend))}>
            {tile.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
