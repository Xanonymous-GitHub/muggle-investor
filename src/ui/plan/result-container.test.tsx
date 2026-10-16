import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLOSSARY } from "@/glossary";
import type { PlanRequest } from "@/planner/schema";
import { glossaryUrl, planExplanationUrl, planUrl } from "@/ui/data/api";
import { SettingsProvider } from "@/ui/device/settings-provider";
import { FORM_COPY } from "@/ui/plan/copy";
import { ResultContainer } from "@/ui/plan/result-container";
import { giveChartsASize } from "@/ui/test/chart-size";
import {
  EXPLANATION_FIXTURE,
  INSUFFICIENT_HISTORY_PLAN,
  LEVEL3_PLAN,
  RESERVE_ONLY_PLAN,
} from "@/ui/test/plan-fixture";

const REQUEST: PlanRequest = {
  answers: {
    age: "age-40-49",
    horizon: "horizon-5-10y",
    income: "income-stable",
    reserve: "reserve-3-6m",
    loss: "loss-hold",
  },
  lump: 600_000,
  monthly: 15_000,
  monthlyExpenses: 30_000,
  existingReserve: 90_000,
};

type Route = (init?: RequestInit) => Response | Promise<Response>;
let routes: Record<string, Route>;
let fetchMock: ReturnType<typeof vi.fn>;
let restoreSize: () => void;

const planCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === planUrl());

beforeEach(() => {
  restoreSize = giveChartsASize();
  routes = {
    [planUrl()]: () => Response.json(LEVEL3_PLAN),
    [glossaryUrl()]: () => Response.json({ terms: GLOSSARY }),
    [planExplanationUrl(3, "beginner")]: () => Response.json(EXPLANATION_FIXTURE),
  };
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const route = routes[String(input)];
    return route ? route(init) : Response.json({ error: "not_found" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  restoreSize();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
});

function renderContainer(onEdit = () => {}, lens: "beginner" | "pro" = "beginner") {
  return render(
    <SettingsProvider>
      <ResultContainer request={REQUEST} lens={lens} onEdit={onEdit} />
    </SettingsProvider>,
  );
}

describe("ResultContainer", () => {
  // First on purpose: the history chunk is loaded once per file, so only the first render can
  // catch the skeleton that stands in for it.
  it("shows a history skeleton while the history code loads, then the history", async () => {
    renderContainer();
    expect(await screen.findByRole("status", { name: "歷史載入中" })).toBeTruthy();
    expect(await screen.findByRole("region", { name: "過去這樣做會怎樣" })).toBeTruthy();
    expect(screen.queryByRole("status", { name: "歷史載入中" })).toBeNull();
  });

  it("shows a result-shaped skeleton while the plan loads", () => {
    routes[planUrl()] = () => new Promise<Response>(() => {});
    renderContainer();
    expect(screen.getByRole("status", { name: "載入中" })).toBeTruthy();
    expect(screen.getByRole("button", { name: FORM_COPY.editAnswers })).toBeTruthy();
  });

  it("renders the plan with the profile, allocation and a 修改答案 button", async () => {
    const onEdit = vi.fn();
    renderContainer(onEdit);
    expect(await screen.findByText("3 平衡")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: FORM_COPY.editAnswers }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(planCalls()).toHaveLength(1);
  });

  it("opens the term panel from an explanation chip, using the response's terms", async () => {
    renderContainer();
    const chip = await screen.findByRole("button", { name: "最大回撤" });
    await userEvent.click(chip);
    expect(await screen.findByRole("dialog", { name: "最大回撤" })).toBeTruthy();
  });

  it("opens a term that only the explanation response carries, with the glossary unreadable", async () => {
    routes[glossaryUrl()] = () => Response.json({ error: "x" }, { status: 500 });
    renderContainer();
    await userEvent.click(await screen.findByRole("button", { name: "最大回撤" }));
    expect(await screen.findByRole("dialog", { name: "最大回撤" })).toBeTruthy();
  });

  it("opens a term from the glossary when the explanation response does not carry it", async () => {
    routes[planExplanationUrl(3, "beginner")] = () =>
      Response.json({ ...EXPLANATION_FIXTURE, terms: {} });
    renderContainer();
    await userEvent.click(await screen.findByRole("button", { name: "最大回撤" }));
    expect(await screen.findByRole("dialog", { name: "最大回撤" })).toBeTruthy();
  });

  it("sends the reader's amounts only to /api/plan", async () => {
    renderContainer();
    await screen.findByText("3 平衡");
    await screen.findByRole("heading", { level: 2, name: /偏平衡/ });
    const others = fetchMock.mock.calls.filter(([url]) => String(url) !== planUrl());
    expect(others.length).toBeGreaterThan(0);
    for (const [url, init] of others) {
      expect(String(url)).not.toMatch(/600000|15000|30000|90000/);
      expect((init as RequestInit | undefined)?.body).toBeUndefined();
    }
  });

  const explanationCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/plan/explanation"));

  it.each([
    ["a reserve-only plan", RESERVE_ONLY_PLAN, "先把緊急預備金補齊"],
    ["a plan with too little history", INSUFFICIENT_HISTORY_PLAN, "歷史資料還不夠"],
  ] as const)(
    "shows no explanation card and sends no explanation request for %s",
    async (_name, response, notice) => {
      routes[planUrl()] = () => Response.json(response);
      renderContainer();
      expect(await screen.findByText(notice)).toBeTruthy();
      await act(async () => {});
      expect(screen.queryByRole("region", { name: "過去這樣做會怎樣" })).toBeNull();
      expect(screen.queryByText(EXPLANATION_FIXTURE.explanation.content.headline)).toBeNull();
      expect(screen.queryByText("說明載入中")).toBeNull();
      expect(screen.queryByText("說明還在準備中")).toBeNull();
      expect(explanationCalls()).toHaveLength(0);
    },
  );

  it("leaves the rest intact when the explanation is missing", async () => {
    routes[planExplanationUrl(3, "beginner")] = () =>
      Response.json({ error: "not_found" }, { status: 404 });
    renderContainer();
    expect(await screen.findByText("說明還在準備中")).toBeTruthy();
    expect(screen.getByText("3 平衡")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not ask for the plan again when the lens changes", async () => {
    const view = renderContainer();
    await screen.findByText("3 平衡");
    view.rerender(
      <SettingsProvider>
        <ResultContainer request={{ ...REQUEST }} lens="pro" onEdit={() => {}} />
      </SettingsProvider>,
    );
    await screen.findByRole("region", { name: "歷史試算" });
    expect(planCalls()).toHaveLength(1);
  });

  describe.each([
    [400, "答案有誤，請修改後再試", null],
    [503, "最新的價格資料還沒準備好", "再試一次"],
    [500, "暫時算不出來", "再試一次"],
  ] as const)("HTTP %i", (status, message, retry) => {
    it(`says 「${message}」 as an alert and keeps 修改答案`, async () => {
      routes[planUrl()] = () => Response.json({ error: "x" }, { status });
      const onEdit = vi.fn();
      renderContainer(onEdit);
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe(message);
      expect(screen.getAllByRole("button", { name: FORM_COPY.editAnswers })).toHaveLength(1);
      if (retry === null) expect(screen.queryByRole("button", { name: "再試一次" })).toBeNull();
      else expect(screen.getByRole("button", { name: retry })).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: FORM_COPY.editAnswers }));
      expect(onEdit).toHaveBeenCalledTimes(1);
    });
  });

  it("recovers on 再試一次", async () => {
    let first = true;
    routes[planUrl()] = () => {
      if (first) {
        first = false;
        return Response.json({ error: "unavailable" }, { status: 503 });
      }
      return Response.json(LEVEL3_PLAN);
    };
    renderContainer();
    await userEvent.click(await screen.findByRole("button", { name: "再試一次" }));
    expect(await screen.findByText("3 平衡")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(planCalls()).toHaveLength(2);
  });

  it("says 需要連線才能試算 offline, without any request", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    renderContainer();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("需要連線才能試算");
    expect(within(document.body).getByRole("button", { name: "再試一次" })).toBeTruthy();
    expect(planCalls()).toHaveLength(0);
    await act(async () => {});
    expect(planCalls()).toHaveLength(0);
  });
});
