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
 * Composes the result cards for each kind of response. The DOM holds a left and a right column;
 * below `md` both dissolve (`contents`) and the `order-*` classes give the phone order: profile,
 * reserve, allocation, rhythm, explanation, history, assumptions.
 */
export function ResultView({ plan, request, lens, explanation, history }: Props) {
  const all = notices(plan, request.lump, lens);
  const capNotices = all.filter((n) => n.id === "capped-by-horizon");
  const otherNotices = all.filter((n) => n.id !== "capped-by-horizon");
  const reserveOnly = plan.kind === "reserve_only";
  const showHistory = plan.kind === "plan" && history != null;
  return (
    <div className="flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] md:items-start">
      <div data-testid="result-left" className="contents md:flex md:flex-col md:gap-4">
        <div className="order-2 flex flex-col gap-2">
          <ReserveCard view={reserveView(plan, request.lump)} detail={!reserveOnly} />
          {reserveOnly ? <NoticeList notices={otherNotices} /> : null}
        </div>
        {reserveOnly ? null : (
          <>
            <div className="order-3 flex flex-col gap-2">
              <NoticeList notices={otherNotices} />
              <AllocationCard plan={plan} lens={lens} />
            </div>
            <div className="order-4 flex flex-col">
              <RhythmCard plan={plan} monthly={request.monthly} lens={lens} />
            </div>
          </>
        )}
        {showHistory ? <div className="order-6">{history}</div> : null}
      </div>
      <div
        data-testid="result-right"
        className="contents md:sticky md:top-4 md:flex md:max-h-[calc(100dvh-2rem)] md:flex-col md:gap-4 md:overflow-y-auto"
      >
        <div className="order-1">
          <ProfileCard profile={plan.profile} lens={lens} notices={capNotices} />
        </div>
        {explanation != null ? <div className="order-5">{explanation}</div> : null}
        <div className="order-7">
          <AssumptionsCard assumptions={plan.assumptions} />
        </div>
      </div>
    </div>
  );
}
