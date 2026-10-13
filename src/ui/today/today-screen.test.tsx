import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Activity, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLOSSARY } from "@/glossary";
import { type DigestSnapshot, parseDigest } from "@/sources/darkfanxing";
import {
  type BriefingJson,
  briefingLatestUrl,
  type RecapJson,
  recapUrl,
  type TodayResponse,
  todayUrl,
} from "@/ui/data/api";
import { CACHE_VERSION, writeCache } from "@/ui/data/resource-cache";
import { LAST_SEEN_KEY, readLastSeen } from "@/ui/device/last-seen";
import { SETTINGS_KEY } from "@/ui/device/settings";
import { SettingsProvider } from "@/ui/device/settings-provider";
import { threeDayRecap, WEEK_HEADLINE_BEGINNER } from "@/ui/test/recap-fixture";
import { AWAY_NOTE, TRUNCATED_NOTE } from "@/ui/today/away";
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

type Route = () => Response | Promise<Response>;
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

  describe("away period", () => {
    const SINCE = "2026-10-02";
    const fetchedUrls = () =>
      vi.mocked(fetch).mock.calls.map(([input]) => String(input as RequestInfo | URL));

    // A cached recap is ready when the card first renders, so the card opens on 離開期間.
    const cacheRecap = (body: RecapJson = threeDayRecap()) => {
      writeCache(recapUrl(SINCE), {
        v: CACHE_VERSION,
        savedAt: "2026-10-08T10:00:00.000Z",
        dataDate: "2026-10-08",
        body,
      });
      routes[recapUrl(SINCE)] = () => Response.json(body);
    };
    const recapFetches = () => fetchedUrls().filter((url) => url === recapUrl(SINCE)).length;

    beforeEach(() => {
      window.localStorage.setItem(LAST_SEEN_KEY, SINCE);
      routes[recapUrl(SINCE)] = () => Response.json(threeDayRecap() satisfies RecapJson);
    });

    it("opens on the away tab with a dot on 今天", async () => {
      cacheRecap();
      await renderScreen();
      const away = await screen.findByRole("tab", { name: "離開期間（3 日）" });
      const today = screen.getByRole("tab", { name: /^今天/ });
      expect(away.getAttribute("aria-selected")).toBe("true");
      expect(today.getAttribute("aria-selected")).toBe("false");
      expect(screen.getByLabelText("有今天的新內容")).toBeTruthy();

      expect(screen.getByText("2026-10-06 → 2026-10-08 · 你離開的這幾天")).toBeTruthy();
      expect(screen.getByText("-1.91%")).toBeTruthy();
      expect(screen.getByText("台指期累計")).toBeTruthy();
      expect(screen.getByText("3 天")).toBeTruthy();
      expect(screen.getByText("40 → 32")).toBeTruthy();
      expect(screen.getByText("10/06")).toBeTruthy();
      expect(screen.getByText("大盤小跌，多數族群沒什麼動靜")).toBeTruthy();
      expect(screen.getByText(WEEK_HEADLINE_BEGINNER)).toBeTruthy();
      // A day without a summary shows only its futures change.
      expect(screen.getByText("10/07")).toBeTruthy();
      expect(screen.getByText("-0.26%")).toBeTruthy();
      expect(screen.getByText(AWAY_NOTE)).toBeTruthy();
      expect(screen.queryByText(TRUNCATED_NOTE)).toBeNull();
      expect(screen.queryByRole("heading", { name: TODAY_HEADLINE })).toBeNull();
      expect(bodyText()).not.toMatch(/NaN|undefined|null/);
      expect(bodyText().trim().endsWith(DISCLAIMER)).toBe(true);
    });

    it("clears the dot once 今天 is opened", async () => {
      cacheRecap();
      await renderScreen();
      await userEvent.click(await screen.findByRole("tab", { name: /^今天/ }));
      expect(screen.getByRole("heading", { name: TODAY_HEADLINE })).toBeTruthy();
      expect(screen.queryByLabelText("有今天的新內容")).toBeNull();
      await userEvent.click(screen.getByRole("tab", { name: "離開期間（3 日）" }));
      expect(screen.getByText("10/06")).toBeTruthy();
      expect(screen.queryByLabelText("有今天的新內容")).toBeNull();
    });

    it("switches tabs from the keyboard", async () => {
      cacheRecap();
      await renderScreen();
      const away = await screen.findByRole("tab", { name: "離開期間（3 日）" });
      act(() => away.focus());
      await userEvent.keyboard("{ArrowLeft}");
      expect(screen.getByRole("tab", { name: /^今天/ }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByRole("heading", { name: TODAY_HEADLINE })).toBeTruthy();
    });

    it("says when the recap was cut to 90 days", async () => {
      cacheRecap({ ...threeDayRecap(), truncated: true });
      await renderScreen();
      expect(await screen.findByText(TRUNCATED_NOTE)).toBeTruthy();
    });

    it("stays on 今天 with a retry hint when the recap is unavailable", async () => {
      routes[recapUrl(SINCE)] = () =>
        Response.json({ error: "unavailable" }, { status: 503, headers: { "retry-after": "300" } });
      await renderScreen();
      expect(await screen.findByRole("heading", { name: TODAY_HEADLINE })).toBeTruthy();
      expect(screen.queryByRole("tablist")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByText("回顧暫時讀不到")).toBeTruthy();
      expect(recapFetches()).toBe(1);

      await userEvent.click(screen.getByRole("button", { name: "重試" }));
      await act(async () => {});
      expect(recapFetches()).toBe(2);
    });

    it("adds the away tab after a successful retry, staying on 今天", async () => {
      routes[recapUrl(SINCE)] = () => Response.json({ error: "unavailable" }, { status: 503 });
      await renderScreen();
      routes[recapUrl(SINCE)] = () => Response.json(threeDayRecap());
      await userEvent.click(await screen.findByRole("button", { name: "重試" }));
      await act(async () => {});
      const away = await screen.findByRole("tab", { name: /^離開期間（3 日）/ });
      expect(away.getAttribute("aria-selected")).toBe("false");
      expect(screen.queryByText("回顧暫時讀不到")).toBeNull();
      expect(screen.getByRole("heading", { name: TODAY_HEADLINE })).toBeTruthy();
    });

    it("shows only 今天 when the recap request fails outright", async () => {
      routes[recapUrl(SINCE)] = () => {
        throw new TypeError("network down");
      };
      await renderScreen();
      expect(await screen.findByRole("heading", { name: TODAY_HEADLINE })).toBeTruthy();
      expect(screen.queryByRole("tablist")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByText("回顧暫時讀不到")).toBeNull();
      expect(screen.queryByRole("button", { name: "重試" })).toBeNull();
    });

    it("keeps 今天 selected when the recap lands after the card, and marks 離開期間", async () => {
      let land: (response: Response) => void = () => {};
      routes[recapUrl(SINCE)] = () =>
        new Promise<Response>((resolve) => {
          land = resolve;
        });
      await renderScreen();
      expect(await screen.findByRole("heading", { name: TODAY_HEADLINE })).toBeTruthy();
      expect(screen.queryByRole("tablist")).toBeNull();

      await act(async () => {
        land(Response.json(threeDayRecap()));
      });
      await act(async () => {});
      const away = await screen.findByRole("tab", { name: /^離開期間（3 日）/ });
      expect(away.getAttribute("aria-selected")).toBe("false");
      expect(screen.getByRole("tab", { name: "今天" }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByRole("heading", { name: TODAY_HEADLINE })).toBeTruthy();
      expect(screen.getByLabelText("有離開期間的回顧")).toBeTruthy();
      expect(screen.queryByLabelText("有今天的新內容")).toBeNull();

      await userEvent.click(away);
      expect(screen.getByText("10/06")).toBeTruthy();
      expect(screen.queryByLabelText("有離開期間的回顧")).toBeNull();
      await userEvent.click(screen.getByRole("tab", { name: "今天" }));
      expect(screen.queryByLabelText("有離開期間的回顧")).toBeNull();
      expect(screen.queryByLabelText("有今天的新內容")).toBeNull();
    });

    it("says a day had nothing to show rather than leaving its row empty", async () => {
      const recap = threeDayRecap();
      cacheRecap({
        ...recap,
        days: recap.days.map((d) =>
          d.tradeDate === "2026-10-07" ? { ...d, futuresChangePct: null } : d,
        ),
      });
      await renderScreen();
      const row = (await screen.findByText("10/07")).closest("li");
      expect(row?.textContent).toBe("10/07當天沒有可顯示的資料");
    });

    it("reads last-seen once under StrictMode, before the visit is recorded", async () => {
      writeCache(todayUrl(), {
        v: CACHE_VERSION,
        savedAt: "2026-10-08T10:00:00.000Z",
        dataDate: digest.tradeDate,
        body: { digest, board: null, stale: false } satisfies TodayResponse,
      });
      render(
        <StrictMode>
          <SettingsProvider>
            <TodayScreen />
          </SettingsProvider>
        </StrictMode>,
      );
      await act(async () => {});
      await act(async () => {});
      expect(await screen.findByRole("tab", { name: /^離開期間（3 日）/ })).toBeTruthy();
      const recapUrls = fetchedUrls().filter((url) => url.startsWith("/api/market/recap"));
      expect(new Set(recapUrls)).toEqual(new Set([recapUrl("2026-10-02")]));
    });

    it("keeps the arrival last-seen when a hidden screen is shown again", async () => {
      cacheRecap();
      const tree = (mode: "visible" | "hidden") => (
        <Activity mode={mode}>
          <SettingsProvider>
            <TodayScreen />
          </SettingsProvider>
        </Activity>
      );
      const { rerender } = render(tree("visible"));
      await act(async () => {});
      await act(async () => {});
      expect(await screen.findByRole("tab", { name: /^離開期間（3 日）/ })).toBeTruthy();
      // Hiding runs the effect cleanups, which record this visit's date.
      rerender(tree("hidden"));
      expect(readLastSeen()).toBe("2026-10-08");
      rerender(tree("visible"));
      await act(async () => {});
      await act(async () => {});
      expect(screen.getByRole("tab", { name: /^離開期間（3 日）/ })).toBeTruthy();
      const recapUrls = fetchedUrls().filter((url) => url.startsWith("/api/market/recap"));
      expect(new Set(recapUrls)).toEqual(new Set([recapUrl(SINCE)]));
    });

    it("shows only 今天 when just one trading day was missed", async () => {
      const recap = threeDayRecap();
      routes[recapUrl(SINCE)] = () =>
        Response.json({ ...recap, missedTradingDays: 1, days: recap.days.slice(-1) });
      await renderScreen();
      expect(await screen.findByRole("heading", { name: TODAY_HEADLINE })).toBeTruthy();
      expect(screen.queryByRole("tablist")).toBeNull();
    });

    it("keeps the away tab after the visit is recorded", async () => {
      cacheRecap();
      await renderScreen();
      await screen.findByRole("tab", { name: "離開期間（3 日）" });
      act(() => {
        window.dispatchEvent(new Event("pagehide"));
      });
      expect(readLastSeen()).toBe("2026-10-08");
      expect(screen.getByRole("tab", { name: "離開期間（3 日）" })).toBeTruthy();
    });

    it("records the trade date shown when the screen goes away", async () => {
      const { unmount } = await renderScreen();
      await screen.findByRole("tab", { name: "離開期間（3 日）" });
      expect(readLastSeen()).toBe(SINCE);
      unmount();
      expect(readLastSeen()).toBe("2026-10-08");
    });

    it("records nothing when there is no digest to show", async () => {
      window.localStorage.clear();
      routes[todayUrl()] = () =>
        Response.json({ digest: null, board: null, stale: false } satisfies TodayResponse);
      const { unmount } = await renderScreen();
      unmount();
      expect(window.localStorage.getItem(LAST_SEEN_KEY)).toBeNull();
    });

    it("asks for no recap on a first visit", async () => {
      window.localStorage.removeItem(LAST_SEEN_KEY);
      await renderScreen();
      expect(await screen.findByRole("heading", { name: TODAY_HEADLINE })).toBeTruthy();
      expect(fetchedUrls().some((url) => url.startsWith("/api/market/recap"))).toBe(false);
      expect(screen.queryByRole("tablist")).toBeNull();
    });
  });
});
