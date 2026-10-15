import type { ReactNode } from "react";
import type { Lens } from "@/insight/lens";
import type { PlanRequest } from "@/planner/schema";
import type { PlanJson } from "@/ui/data/api";
import { AllocationCard } from "@/ui/plan/allocation-card";
import { AssumptionsCard } from "@/ui/plan/assumptions-card";
import { NoticeList } from "@/ui/plan/notices";
import { ProfileCard } from "@/ui/plan/profile-card";
import { ReserveCard } from "@/ui/plan/reserve-card";
import { RhythmCard } from "@/ui/plan/rhythm-card";
import { notices, reserveView } from "@/ui/plan/view-model";

type Props = {
  plan: PlanJson;
  /** The request the plan answers: its amounts are not echoed in the response. */
  request: PlanRequest;
  lens: Lens;
  /** The LLM explanation (placed with the profile on a wide screen). */
  explanation?: ReactNode;
  /** The history section; never shown for a plan without history. */
  history?: ReactNode;
};

/**
 * Composes the result cards for each kind of response. DOM order is reading order is visual
 * order: profile, then a left group (reserve, notices, allocation, rhythm, history), then a right
 * group (explanation, assumptions). On a phone the groups stack; from `md` the grid puts the
 * profile at the top of the right column, the left group beside both, the right group under the
 * profile. Both columns scroll with the page.
 */
export function ResultView({ plan, request, lens, explanation, history }: Props) {
  const all = notices(plan, request.lump, lens);
  const capNotices = all.filter((n) => n.id === "capped-by-horizon");
  const otherNotices = all.filter((n) => n.id !== "capped-by-horizon");
  const reserveOnly = plan.kind === "reserve_only";
  const showHistory = plan.kind === "plan" && history != null;
  return (
    <div className="flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] md:grid-rows-[auto_1fr] md:items-start">
      <div className="md:col-start-2 md:row-start-1">
        <ProfileCard profile={plan.profile} lens={lens} notices={capNotices} />
      </div>
      <div className="flex flex-col gap-4 md:col-start-1 md:row-span-2 md:row-start-1">
        <div className="flex flex-col gap-2">
          <ReserveCard view={reserveView(plan, request.lump)} detail={!reserveOnly} />
          {reserveOnly ? <NoticeList notices={otherNotices} /> : null}
        </div>
        {reserveOnly ? null : (
          <>
            <div className="flex flex-col gap-2">
              <NoticeList notices={otherNotices} />
              <AllocationCard plan={plan} lens={lens} />
            </div>
            <RhythmCard plan={plan} monthly={request.monthly} lens={lens} />
          </>
        )}
        {showHistory ? history : null}
      </div>
      <div className="flex flex-col gap-4 md:col-start-2 md:row-start-2">
        {explanation != null ? explanation : null}
        <AssumptionsCard assumptions={plan.assumptions} />
      </div>
    </div>
  );
}
