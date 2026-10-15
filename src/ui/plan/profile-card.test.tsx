import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfileCard } from "@/ui/plan/profile-card";
import { LEVEL1_PLAN, LEVEL3_PLAN } from "@/ui/test/plan-fixture";

describe("ProfileCard", () => {
  it("shows the level number and name with a five-segment meter", () => {
    render(<ProfileCard profile={LEVEL3_PLAN.profile} lens="beginner" />);
    expect(screen.getByText("3 平衡")).toBeTruthy();
    const meter = screen.getByRole("img", { name: "風險等級 3，共 5 級" });
    expect(meter.children).toHaveLength(5);
    expect(
      [...meter.children].filter((c) => c.getAttribute("data-filled") === "true"),
    ).toHaveLength(3);
  });

  it("explains the level in plain words for a beginner", () => {
    render(<ProfileCard profile={LEVEL3_PLAN.profile} lens="beginner" />);
    expect(
      screen.getByText(
        "你的處境能承受的風險是 4，你自己面對虧損的感覺是 3。兩者取比較小的，所以是 3 平衡。",
      ),
    ).toBeTruthy();
  });

  it("explains the level with the scoring terms in the pro lens", () => {
    render(<ProfileCard profile={LEVEL3_PLAN.profile} lens="pro" />);
    expect(
      screen.getByText("承受能力 4（第 1–4 題平均），承受意願 3（第 5 題），取較小者。"),
    ).toBeTruthy();
    expect(screen.queryByText(/你的處境/)).toBeNull();
  });

  it("names level 1 as 保守", () => {
    render(<ProfileCard profile={LEVEL1_PLAN.profile} lens="beginner" />);
    expect(screen.getByText("1 保守")).toBeTruthy();
    expect(screen.getByRole("img", { name: "風險等級 1，共 5 級" })).toBeTruthy();
  });

  it("shows the notices it is given inside the card", () => {
    render(
      <ProfileCard
        profile={{ ...LEVEL3_PLAN.profile, cappedByHorizon: true }}
        lens="beginner"
        notices={[{ id: "capped-by-horizon", tone: "info", title: "標題", body: "內文" }]}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("內文");
  });
});
