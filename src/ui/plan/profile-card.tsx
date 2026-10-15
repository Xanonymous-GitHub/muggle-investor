import { useId } from "react";
import type { Lens } from "@/insight/lens";
import { LEVEL_NAMES } from "@/planner/rules/levels";
import type { PlanJson } from "@/ui/data/api";
import { PROFILE_COPY } from "@/ui/plan/copy";
import { NoticeList } from "@/ui/plan/notices";
import type { Notice } from "@/ui/plan/view-model";

const SEGMENTS = [1, 2, 3, 4, 5] as const;

/** The risk level, how it came about, and any note that bears on the level itself. */
export function ProfileCard({
  profile,
  lens,
  notices = [],
}: {
  profile: PlanJson["profile"];
  lens: Lens;
  notices?: Notice[];
}) {
  const id = useId();
  const { level, capacity, willingness } = profile;
  const label = PROFILE_COPY.levelLabel(level, LEVEL_NAMES[level]);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <h2 id={id} className="text-sm font-bold">
        {PROFILE_COPY.heading}
      </h2>
      <p className="text-3xl font-bold">{label}</p>
      <div role="img" aria-label={PROFILE_COPY.meterLabel(level)} className="flex gap-1">
        {SEGMENTS.map((n) => (
          <span
            key={n}
            data-filled={n <= level}
            className="h-2 flex-1 rounded-full bg-muted data-[filled=true]:bg-foreground"
          />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        {PROFILE_COPY.explain[lens]({ capacity, willingness, level: label })}
      </p>
      <NoticeList notices={notices} />
    </section>
  );
}
