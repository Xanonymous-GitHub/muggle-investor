// The screen with its real result container: only the network is faked.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLOSSARY } from "@/glossary";
import { glossaryUrl, planExplanationUrl, planUrl } from "@/ui/data/api";
import { SETTINGS_KEY } from "@/ui/device/settings";
import { SettingsProvider, useSettings } from "@/ui/device/settings-provider";
import { FORM_COPY, QUESTION_COPY } from "@/ui/plan/copy";
import { DRAFT_KEY, serializeDraft } from "@/ui/plan/draft";
import { PlannerScreen } from "@/ui/plan/planner-screen";
import { giveChartsASize } from "@/ui/test/chart-size";
import { EXPLANATION_FIXTURE, LEVEL3_PLAN } from "@/ui/test/plan-fixture";

const FULL = {
  answers: {
    age: "age-40-49",
    horizon: "horizon-5-10y",
    income: "income-stable",
    reserve: "reserve-3-6m",
    loss: "loss-hold",
  },
  amounts: {
    lump: "600,000",
    monthly: "15,000",
    monthlyExpenses: "30,000",
    existingReserve: "90,000",
  },
};

type Route = () => Response | Promise<Response>;
let routes: Record<string, Route>;
let fetchMock: ReturnType<typeof vi.fn>;
let restoreSize: () => void;

const callsTo = (url: string) => fetchMock.mock.calls.filter(([u]) => String(u) === url);

beforeEach(() => {
  restoreSize = giveChartsASize();
  window.localStorage.setItem(DRAFT_KEY, serializeDraft(FULL));
  routes = {
    [planUrl()]: () => Response.json(LEVEL3_PLAN),
    [glossaryUrl()]: () => Response.json({ terms: GLOSSARY }),
    [planExplanationUrl(3, "beginner")]: () => Response.json(EXPLANATION_FIXTURE),
    [planExplanationUrl(3, "pro")]: () =>
      Response.json({
        ...EXPLANATION_FIXTURE,
        explanation: { ...EXPLANATION_FIXTURE.explanation, lens: "pro" },
      }),
  };
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const route = routes[String(input)];
    return route ? route() : Response.json({ error: "not_found" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  restoreSize();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

function LensSwitch() {
  const { setLens } = useSettings();
  return (
    <button type="button" onClick={() => setLens("pro")}>
      切到專業
    </button>
  );
}

function renderScreen() {
  return render(
    <SettingsProvider>
      <LensSwitch />
      <PlannerScreen />
    </SettingsProvider>,
  );
}

describe("PlannerScreen with the live result", () => {
  it("renders the plan, the allocation rows, the explanation and the history table", async () => {
    renderScreen();
    expect(await screen.findByText("3 平衡")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "600,000 元怎麼分" })).toBeTruthy();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(5);
    expect(await screen.findByRole("heading", { level: 2, name: /偏平衡/ })).toBeTruthy();
    expect(await screen.findByRole("table")).toBeTruthy();
    const [, init] = callsTo(planUrl())[0] ?? [];
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      lump: 600_000,
      monthly: 15_000,
      existingReserve: 90_000,
    });
  });

  it("keeps the rest of the result when the explanation is not there yet", async () => {
    routes[planExplanationUrl(3, "beginner")] = () =>
      Response.json({ error: "not_found" }, { status: 404 });
    renderScreen();
    expect(await screen.findByText("說明還在準備中")).toBeTruthy();
    expect(screen.getByText("3 平衡")).toBeTruthy();
    expect(await screen.findByRole("table")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("relabels for the pro lens without asking for the plan again", async () => {
    renderScreen();
    expect(await screen.findByRole("region", { name: "過去這樣做會怎樣" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "切到專業" }));
    expect(await screen.findByRole("region", { name: "歷史試算" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "過去這樣做會怎樣" })).toBeNull();
    expect(callsTo(planUrl())).toHaveLength(1);
    expect(callsTo(planExplanationUrl(3, "pro")).length).toBeGreaterThan(0);
  });

  it("asks only for the stored lens's explanation", async () => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ lens: "pro" }));
    renderScreen();
    await screen.findByRole("region", { name: "歷史試算" });
    expect(callsTo(planExplanationUrl(3, "beginner"))).toHaveLength(0);
    expect(callsTo(planExplanationUrl(3, "pro")).length).toBeGreaterThan(0);
  });

  it("returns to the questionnaire with the answers filled in", async () => {
    renderScreen();
    await screen.findByText("3 平衡");
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.editAnswers }));
    expect(screen.getByText(QUESTION_COPY.age.prompt)).toBeTruthy();
    expect(screen.getByRole("radio", { name: "40–49" }).getAttribute("aria-checked")).toBe("true");
    expect(window.localStorage.getItem(DRAFT_KEY)).toBe(serializeDraft(FULL));
  });

  it("shows a retry for a 503 and the plan after retrying", async () => {
    let first = true;
    routes[planUrl()] = () => {
      if (first) {
        first = false;
        return Response.json({ error: "unavailable" }, { status: 503 });
      }
      return Response.json(LEVEL3_PLAN);
    };
    renderScreen();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("最新的價格資料還沒準備好");
    // The saved answers are untouched.
    expect(window.localStorage.getItem(DRAFT_KEY)).toBe(serializeDraft(FULL));
    await userEvent.click(within(document.body).getByRole("button", { name: "再試一次" }));
    expect(await screen.findByText("3 平衡")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
