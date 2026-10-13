import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLOSSARY } from "@/glossary";
import { type DigestSnapshot, parseDigest } from "@/sources/darkfanxing";
import { type BriefingJson, briefingLatestUrl, type TodayResponse, todayUrl } from "@/ui/data/api";
import { CACHE_VERSION, writeCache } from "@/ui/data/resource-cache";
import { SETTINGS_KEY } from "@/ui/device/settings";
import { SettingsProvider } from "@/ui/device/settings-provider";
import { TodayScreen } from "@/ui/today/today-screen";
import { AI_NOTE, DISCLAIMER } from "@/ui/today/view-model";

const fixtures = join(import.meta.dirname, "../../../test/fixtures/darkfanxing");
const digest = parseDigest(readFileSync(join(fixtures, "digest-2026-10-08.html"), "utf8"));

const termId = "force";
const term = GLOSSARY.find((t) => t.id === termId);
if (!term) throw new Error("fixture term missing");

const briefing = (periodKey: string, headline: string): BriefingJson => ({
  briefing: {
    kind: "daily",
    periodKey,
    lens: "beginner",
    promptVersion: 1,
    model: "test",
    createdAt: `${periodKey}T10:00:00.000Z`,
    content: {
      headline,
      summary: "上漲和下跌的族群差不多一樣多。",
      sections: [
        { title: "大盤發生什麼事", body: "台指期收在 49,349。" },
        { title: "錢往哪裡去", body: "被動元件的買盤比賣盤多。" },
      ],
      takeaway: "漲跌各半的一天。",
      termIds: [termId],
    },
  },
  terms: { [termId]: term },
});

const TODAY_HEADLINE = "大盤今天跌了一些，但不是每個族群都在跌";

type Route = () => Response;
let routes: Record<string, Route>;

beforeEach(() => {
  routes = {
    [todayUrl()]: () =>
      Response.json({ digest, board: null, stale: false } satisfies TodayResponse, {
        headers: { "x-data-trade-date": digest.tradeDate },
      }),
    [briefingLatestUrl("beginner")]: () => Response.json(briefing("2026-10-08", TODAY_HEADLINE)),
    [briefingLatestUrl("pro")]: () => Response.json(briefing("2026-10-08", TODAY_HEADLINE)),
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
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

async function renderScreen() {
  const view = render(
    <SettingsProvider>
      <TodayScreen />
    </SettingsProvider>,
  );
  // Let both requests settle.
  await act(async () => {});
  await act(async () => {});
  return view;
}

const bodyText = () => document.body.textContent ?? "";

describe("TodayScreen", () => {
  it("shows a skeleton while loading", () => {
    const { container } = render(
      <SettingsProvider>
        <TodayScreen />
      </SettingsProvider>,
    );
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull();
  });

  it("shows the whole 今天 tab when every piece is there", async () => {
    await renderScreen();
    expect(await screen.findByRole("heading", { name: TODAY_HEADLINE })).toBeTruthy();
    expect(screen.getByText("資料日期 2026-10-08（四）盤後")).toBeTruthy();
    expect(screen.getByText("上漲族群 87")).toBeTruthy();
    expect(screen.getByText("下跌族群 88")).toBeTruthy();
    expect(screen.getByText("49,349")).toBeTruthy();
    expect(screen.getByText("-619 點")).toBeTruthy();
    expect(screen.getByText("上漲和下跌的族群差不多一樣多。")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "錢往哪裡去" })).toBeTruthy();
    expect(screen.getByText("不織布")).toBeTruthy();
    expect(screen.getByText("+5.97%")).toBeTruthy();
    expect(screen.getByText("+57.44 億")).toBeTruthy();
    expect(screen.getByText("-104.13 億")).toBeTruthy();
    expect(screen.getByText(AI_NOTE)).toBeTruthy();
    expect(bodyText().trim().endsWith(DISCLAIMER)).toBe(true);
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it("opens the term panel from a briefing chip", async () => {
    await renderScreen();
    await userEvent.click(await screen.findByRole("button", { name: term.term }));
    expect(screen.getByRole("dialog", { name: term.term })).toBeTruthy();
  });

  it("never passes an older briefing off as today's", async () => {
    const old = "前一天的標題";
    routes[briefingLatestUrl("beginner")] = () => Response.json(briefing("2026-10-07", old));
    await renderScreen();
    expect(await screen.findByRole("heading", { name: "今天的解讀還在整理中" })).toBeTruthy();
    expect(screen.getByText(`2026-10-07 的解讀：${old}`)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: old })).toBeNull();
    expect(screen.queryByText("上漲和下跌的族群差不多一樣多。")).toBeNull();
    expect(screen.getByText("上漲族群 87")).toBeTruthy();
  });

  it("says the briefing is pending and still shows the numbers when there is none", async () => {
    delete routes[briefingLatestUrl("beginner")];
    await renderScreen();
    expect(await screen.findByRole("heading", { name: "今天的解讀還在整理中" })).toBeTruthy();
    expect(screen.getByText("台指期收盤")).toBeTruthy();
    expect(screen.getByText("87 / 88")).toBeTruthy();
    expect(bodyText().trim().endsWith(DISCLAIMER)).toBe(true);
  });

  it("shows the cached copy with a stale notice when the refresh fails", async () => {
    writeCache(todayUrl(), {
      v: CACHE_VERSION,
      savedAt: "2026-10-08T10:00:00.000Z",
      dataDate: digest.tradeDate,
      body: { digest, board: null, stale: false } satisfies TodayResponse,
    });
    routes[todayUrl()] = () => Response.json({ error: "internal_error" }, { status: 500 });
    await renderScreen();
    expect(await screen.findByText("無法更新，顯示的是 2026-10-08（四） 的資料。")).toBeTruthy();
    expect(screen.getByText("上漲族群 87")).toBeTruthy();
  });

  it("adds force and breadth in the pro lens", async () => {
    window.localStorage.setItem(SETTINGS_KEY, '{"lens":"pro","theme":"system"}');
    await renderScreen();
    expect(await screen.findByText("力度", { selector: "dt" })).toBeTruthy();
    expect(screen.getByText("-0.63%")).toBeTruthy();
    expect(screen.getByText("面積", { selector: "dt" })).toBeTruthy();
    expect(screen.getByText("+0.20%")).toBeTruthy();
  });

  it("renders nothing broken when the optional digest parts are missing", async () => {
    const sparse: DigestSnapshot = {
      ...digest,
      market: { ...digest.market, futures: null },
      quadrant: null,
      netBuy: null,
      netSell: null,
      topGainers: null,
      topLosers: null,
    };
    routes[todayUrl()] = () =>
      Response.json({ digest: sparse, board: null, stale: false } satisfies TodayResponse);
    await renderScreen();
    expect(await screen.findByText("87 / 88")).toBeTruthy();
    expect(screen.queryByText("台指期收盤")).toBeNull();
    expect(screen.queryByRole("heading", { name: /領漲/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /資金流向/ })).toBeNull();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
    expect(bodyText().trim().endsWith(DISCLAIMER)).toBe(true);
  });

  it("explains an empty store", async () => {
    routes[todayUrl()] = () =>
      Response.json({ digest: null, board: null, stale: false } satisfies TodayResponse);
    await renderScreen();
    expect(
      await screen.findByText("還沒有收盤資料。排程跑過之後這裡會出現今天的市場。"),
    ).toBeTruthy();
  });
});
