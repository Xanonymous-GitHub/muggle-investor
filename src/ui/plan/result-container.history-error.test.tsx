// The history code fails to load: its own file, because a module mock is per file.
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLOSSARY } from "@/glossary";
import { glossaryUrl, planExplanationUrl, planUrl } from "@/ui/data/api";
import { SettingsProvider } from "@/ui/device/settings-provider";
import { ResultContainer } from "@/ui/plan/result-container";
import { EXPLANATION_FIXTURE, LEVEL3_PLAN } from "@/ui/test/plan-fixture";

vi.mock("@/ui/plan/history-card", () => {
  throw new Error("chunk failed to load");
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const routes: Record<string, () => Response> = {
    [planUrl()]: () => Response.json(LEVEL3_PLAN),
    [glossaryUrl()]: () => Response.json({ terms: GLOSSARY }),
    [planExplanationUrl(3, "beginner")]: () => Response.json(EXPLANATION_FIXTURE),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const route = routes[String(input)];
      return route ? route() : Response.json({ error: "not_found" }, { status: 404 });
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("ResultContainer when the history code cannot load", () => {
  it("says so quietly and leaves the rest of the result alone", async () => {
    render(
      <SettingsProvider>
        <ResultContainer
          request={{
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
          }}
          lens="beginner"
          onEdit={() => {}}
        />
      </SettingsProvider>,
    );
    expect(await screen.findByText("歷史暫時讀不到")).toBeTruthy();
    expect(screen.getByText("3 平衡")).toBeTruthy();
    expect(await screen.findByRole("heading", { level: 2, name: /偏平衡/ })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /重新載入|再試/ })).toBeNull();
    expect(screen.queryByRole("status", { name: "歷史載入中" })).toBeNull();
  });
});
