import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssumptionsCard } from "@/ui/plan/assumptions-card";
import { DISCLAIMER } from "@/ui/today/view-model";

describe("AssumptionsCard", () => {
  it("lists the API strings, then the two fixed sentences once each", () => {
    render(
      <AssumptionsCard
        assumptions={["含配息再投入，不計手續費與稅", "年化報酬含投入時點（資金加權）"]}
      />,
    );
    expect(screen.getByRole("heading", { name: "試算前提" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("含配息再投入，不計手續費與稅")).toBeTruthy();
    expect(screen.getAllByText("過去表現不代表未來。")).toHaveLength(1);
    expect(screen.getAllByText(DISCLAIMER)).toHaveLength(1);
  });

  it("skips an API string that repeats a fixed sentence, with or without the full stop", () => {
    render(
      <AssumptionsCard
        assumptions={["過去表現不代表未來", "含配息再投入，不計手續費與稅", "過去表現不代表未來。"]}
      />,
    );
    expect(screen.getAllByText(/過去表現不代表未來/)).toHaveLength(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("過去表現不代表未來。")).toBeTruthy();
  });

  it("keeps two equal API strings apart instead of colliding on a key", () => {
    render(<AssumptionsCard assumptions={["一樣的前提", "一樣的前提"]} />);
    expect(screen.getAllByText("一樣的前提")).toHaveLength(2);
  });

  it("has no heading when the only API string was a fixed sentence", () => {
    render(<AssumptionsCard assumptions={["過去表現不代表未來"]} />);
    expect(screen.queryByRole("heading", { name: "試算前提" })).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getAllByText(/過去表現不代表未來/)).toHaveLength(1);
  });

  it("still prints the fixed sentences, without a heading, when there are no assumptions", () => {
    render(<AssumptionsCard assumptions={[]} />);
    expect(screen.queryByRole("heading", { name: "試算前提" })).toBeNull();
    expect(screen.getByText("過去表現不代表未來。")).toBeTruthy();
    expect(screen.getByText(DISCLAIMER)).toBeTruthy();
  });
});
