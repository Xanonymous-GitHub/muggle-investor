import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseDigest,
  parseSectorBoard,
  parseSectorDetail,
  type SectorBoard,
} from "@/sources/darkfanxing";
import { sectorDetailUrl, sectorsUrl, type TodayResponse, todayUrl } from "@/ui/data/api";
import { CACHE_VERSION, writeCache } from "@/ui/data/resource-cache";
import { SETTINGS_KEY } from "@/ui/device/settings";
import { SettingsProvider } from "@/ui/device/settings-provider";
import { FLOW_NOTE, SECTOR_HELP_TITLE } from "@/ui/sectors/copy";
import { SectorsScreen } from "@/ui/sectors/sectors-screen";
import { matchEveryQuery } from "@/ui/test/match-media";

const fixtures = join(import.meta.dirname, "../../../test/fixtures/darkfanxing");
const board = parseSectorBoard(readFileSync(join(fixtures, "now-2026-10-08.html"), "utf8"));
const digest = parseDigest(readFileSync(join(fixtures, "digest-2026-10-08.html"), "utf8"));

const quartz = parseSectorDetail(
  readFileSync(join(fixtures, "group-quartz-2026-10-08.html"), "utf8"),
);

const byChange = [...board.sectors].sort((a, b) => b.changePct - a.changePct);
const topGainer = byChange[0]?.name;
const topLoser = byChange.at(-1)?.name;

type Route = () => Response | Promise<Response>;
let routes: Record<string, Route>;

beforeEach(() => {
  routes = {
    [sectorsUrl()]: () =>
      Response.json(board, { headers: { "x-data-trade-date": board.tradeDate } }),
    [todayUrl()]: () =>
      Response.json({ digest, board, stale: false } satisfies TodayResponse, {
        headers: { "x-data-trade-date": digest.tradeDate },
      }),
    [sectorDetailUrl("石英元件")]: () =>
      Response.json(quartz, { headers: { "x-data-trade-date": quartz.tradeDate } }),
    [sectorDetailUrl("被動元件")]: () =>
      Response.json(
        { ...quartz, group: "被動元件" },
        { headers: { "x-data-trade-date": quartz.tradeDate } },
      ),
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
  window.history.replaceState(null, "", "/sectors");
});

async function renderScreen() {
  const view = render(
    <SettingsProvider>
      <SectorsScreen />
    </SettingsProvider>,
  );
  // Let both requests settle.
  await act(async () => {});
  await act(async () => {});
  return view;
}

const bodyText = () => document.body.textContent ?? "";
const usePro = () => window.localStorage.setItem(SETTINGS_KEY, '{"lens":"pro","theme":"system"}');

/** Sector names in the order the phone list shows them. */
function listedNames(): string[] {
  const list = screen.getByRole("list", { name: "族群排行" });
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.querySelector('[data-slot="sector-name"]')?.textContent ?? "");
}

function sectionNames(heading: string): string[] {
  const section = screen.getByRole("region", { name: heading });
  return within(section)
    .getAllByRole("listitem")
    .map((item) => item.querySelector('[data-slot="sector-name"]')?.textContent ?? "");
}

describe("SectorsScreen", () => {
  it("lists every sector by change, top gainer first, under the board's data line", async () => {
    await renderScreen();
    const names = listedNames();
    expect(names).toEqual(byChange.map((s) => s.name));
    expect(names[0]).toBe(topGainer);
    expect(screen.getByText("資料日期 2026-10-08（四）盤後")).toBeTruthy();
    expect(screen.getByText("+5.97%")).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it("labels an intraday board with its own session and time", async () => {
    const intraday: SectorBoard = { ...board, session: "intraday", asOf: "10:15" };
    routes[sectorsUrl()] = () => Response.json(intraday);
    await renderScreen();
    expect(screen.getByText("資料日期 2026-10-08（四）盤中 10:15")).toBeTruthy();
  });

  it("filters by name as the user types", async () => {
    await renderScreen();
    await userEvent.type(screen.getByRole("searchbox", { name: "搜尋族群" }), "被動");
    expect(listedNames()).toEqual(["被動元件"]);
  });

  it("says so when the search matches nothing", async () => {
    await renderScreen();
    await userEvent.type(screen.getByRole("searchbox", { name: "搜尋族群" }), "不存在的族群");
    expect(screen.getByText("找不到符合的族群。")).toBeTruthy();
  });

  it("reverses the order with the sort toggle", async () => {
    await renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "由高到低" }));
    expect(listedNames()[0]).toBe(topLoser);
    expect(screen.getByRole("button", { name: "由低到高" })).toBeTruthy();
  });

  it("writes the chosen sector into the url", async () => {
    await renderScreen();
    await userEvent.click(screen.getByRole("button", { name: /^被動元件/ }));
    expect(new URLSearchParams(window.location.search).get("group")).toBe("被動元件");
  });

  it("replaces the list with the sector's stocks, and 返回 brings the list back", async () => {
    await renderScreen();
    await userEvent.click(screen.getByRole("button", { name: /^石英元件/ }));
    await act(async () => {});
    expect(screen.getByRole("heading", { name: "石英元件" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "成分股" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "族群排行" })).toBeNull();
    expect(screen.queryByRole("searchbox", { name: "搜尋族群" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "返回" }));
    await waitFor(() => expect(screen.getByRole("list", { name: "族群排行" })).toBeTruthy());
    expect(new URLSearchParams(window.location.search).has("group")).toBe(false);
    expect(screen.queryByRole("list", { name: "成分股" })).toBeNull();
  });

  it("returns from the detail to the list on the browser's Back, and keeps the search", async () => {
    await renderScreen();
    await userEvent.type(screen.getByRole("searchbox", { name: "搜尋族群" }), "石英");
    await userEvent.click(screen.getByRole("button", { name: /^石英元件/ }));
    await act(async () => {});
    expect(screen.getByRole("list", { name: "成分股" })).toBeTruthy();

    act(() => window.history.back());
    await waitFor(() => expect(screen.getByRole("list", { name: "族群排行" })).toBeTruthy());
    expect(listedNames()).toEqual(["石英元件"]);
  });

  it("opens the detail named by a shared link", async () => {
    window.history.replaceState(null, "", "/sectors?group=%E7%9F%B3%E8%8B%B1%E5%85%83%E4%BB%B6");
    await renderScreen();
    expect(screen.getByRole("heading", { name: "石英元件" })).toBeTruthy();

    // A link has no list entry behind it, so 返回 rewrites the url instead of going back.
    const back = vi.spyOn(window.history, "back");
    const replace = vi.spyOn(window.history, "replaceState");
    const length = window.history.length;
    await userEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(back).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(window.history.length).toBe(length);
    expect(screen.getByRole("list", { name: "族群排行" })).toBeTruthy();
    expect(window.location.search).toBe("");
  });

  it("says so when the linked group is not on the board", async () => {
    window.history.replaceState(null, "", "/sectors?group=%E4%B8%8D%E5%AD%98%E5%9C%A8");
    await renderScreen();
    expect(screen.getByText("找不到這個族群。")).toBeTruthy();
  });

  it("shows the plain-language line in the beginner lens", async () => {
    await renderScreen();
    expect(
      screen.getAllByText("今天上漲，5 家公司裡有 4 家上漲、1 家下跌。").length,
    ).toBeGreaterThan(0);
  });

  it("shows advancers, decliners and the month change in the pro lens", async () => {
    usePro();
    await renderScreen();
    expect(screen.getAllByText("漲 4／跌 1").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^近一月 /).length).toBeGreaterThan(0);
    expect(screen.queryByText("今天上漲，5 家公司裡有 4 家上漲、1 家下跌。")).toBeNull();
  });

  it("shows the help box and question tabs in the beginner lens", async () => {
    await renderScreen();
    expect(screen.getByText(SECTOR_HELP_TITLE)).toBeTruthy();
    expect(screen.getByRole("tab", { name: "今天誰漲誰跌" })).toBeTruthy();
  });

  it("keeps the original terms and drops the help box in the pro lens", async () => {
    usePro();
    await renderScreen();
    expect(screen.getByRole("tab", { name: "漲跌幅" })).toBeTruthy();
    expect(screen.queryByText(SECTOR_HELP_TITLE)).toBeNull();
  });

  it("shows exactly the digest's top inflows and outflows in the flow view", async () => {
    await renderScreen();
    await userEvent.click(screen.getByRole("tab", { name: "錢跑去哪裡" }));
    expect(sectionNames("買的人比賣的人多（錢流進來）")).toEqual(
      (digest.netBuy ?? []).map((r) => r.name),
    );
    expect(sectionNames("賣的人比買的人多（錢流出去）")).toEqual(
      (digest.netSell ?? []).map((r) => r.name),
    );
    expect(screen.getByText(FLOW_NOTE)).toBeTruthy();
    expect(screen.getByText("今天急著買的金額比急著賣的多約 57.44 億元。")).toBeTruthy();
    expect(screen.getByText("資料日期 2026-10-08（四）盤後")).toBeTruthy();
    expect(screen.queryByRole("searchbox", { name: "搜尋族群" })).toBeNull();
  });

  it("uses the pro headings and figures in the pro flow view", async () => {
    usePro();
    await renderScreen();
    await userEvent.click(screen.getByRole("tab", { name: "內外盤金額差" }));
    expect(sectionNames("淨流入前十")[0]).toBe("被動元件");
    expect(sectionNames("淨流出前十")[0]).toBe("軸承／滑軌");
    expect(screen.getByText("+57.44 億")).toBeTruthy();
    expect(screen.getByText("-104.13 億")).toBeTruthy();
  });

  it("explains a digest with no flow lists", async () => {
    routes[todayUrl()] = () =>
      Response.json({
        digest: { ...digest, netBuy: null, netSell: null },
        board,
        stale: false,
      } satisfies TodayResponse);
    await renderScreen();
    await userEvent.click(screen.getByRole("tab", { name: "錢跑去哪裡" }));
    expect(screen.getByText("這一天沒有資金流向資料。")).toBeTruthy();
  });

  it("shows quadrant counts, glossary chips and today's transitions", async () => {
    await renderScreen();
    await userEvent.click(screen.getByRole("tab", { name: "誰在變強變弱" }));
    for (const label of ["強勢", "轉強", "轉弱", "弱勢"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByText("43")).toBeTruthy();
    expect(screen.getByText("前一天 45")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "今天換象限" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^車用電子/ }).length).toBeGreaterThan(0);
    expect(screen.getByText("近 5 日流入最強")).toBeTruthy();
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it("explains a digest with no quadrant section", async () => {
    routes[todayUrl()] = () =>
      Response.json({
        digest: { ...digest, quadrant: null },
        board,
        stale: false,
      } satisfies TodayResponse);
    await renderScreen();
    await userEvent.click(screen.getByRole("tab", { name: "誰在變強變弱" }));
    expect(screen.getByText("這一天沒有四象限資料。")).toBeTruthy();
  });

  it("explains a store with no board yet", async () => {
    routes[sectorsUrl()] = () => Response.json({ error: "not_found" }, { status: 404 });
    await renderScreen();
    expect(screen.getByText("還沒有族群資料。")).toBeTruthy();
  });

  it("shows the cached board with a stale notice when the refresh fails", async () => {
    writeCache(sectorsUrl(), {
      v: CACHE_VERSION,
      savedAt: "2026-10-08T10:00:00.000Z",
      dataDate: board.tradeDate,
      body: board,
    });
    routes[sectorsUrl()] = () => Response.json({ error: "internal_error" }, { status: 500 });
    await renderScreen();
    expect(screen.getByText("無法更新，顯示的是 2026-10-08（四） 的資料。")).toBeTruthy();
    expect(listedNames()[0]).toBe(topGainer);
  });

  describe("from md up", () => {
    let restore: () => void;
    beforeEach(() => {
      restore = matchEveryQuery();
    });
    afterEach(() => restore());

    it("renders a table sortable by its headers", async () => {
      usePro();
      await renderScreen();
      const table = screen.getByRole("table");
      const headers = within(table).getAllByRole("columnheader");
      expect(headers.map((h) => h.textContent)).toEqual([
        "名稱",
        "漲跌幅",
        "上漲／下跌家數",
        "成交值",
        "近一月",
      ]);
      const change = within(table).getByRole("columnheader", { name: "漲跌幅" });
      expect(change.getAttribute("aria-sort")).toBe("descending");
      const rows = () => within(table).getAllByRole("row").slice(1);
      expect(rows()[0]?.textContent).toContain(topGainer);

      await userEvent.click(within(change).getByRole("button"));
      expect(change.getAttribute("aria-sort")).toBe("ascending");
      expect(rows()[0]?.textContent).toContain(topLoser);

      const turnover = within(table).getByRole("columnheader", { name: "成交值" });
      await userEvent.click(within(turnover).getByRole("button"));
      expect(turnover.getAttribute("aria-sort")).toBe("descending");
      expect(change.getAttribute("aria-sort")).toBe("none");
      expect(screen.queryByRole("list", { name: "族群排行" })).toBeNull();
    });

    it("keeps the table and shows the stocks in a pane beside it, with the row highlighted", async () => {
      await renderScreen();
      expect(screen.queryByRole("list", { name: "成分股" })).toBeNull();
      expect(screen.getByText("點選左邊的族群，看它裡面有哪些股票。")).toBeTruthy();

      await userEvent.click(
        within(screen.getByRole("table")).getByRole("button", { name: "石英元件" }),
      );
      await act(async () => {});
      expect(screen.getByRole("list", { name: "成分股" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "石英元件" })).toBeTruthy();
      expect(
        within(screen.getByRole("table"))
          .getByRole("button", { name: "石英元件" })
          .getAttribute("aria-current"),
      ).toBe("true");
      expect(screen.queryByText("點選左邊的族群，看它裡面有哪些股票。")).toBeNull();
      expect(bodyText()).not.toMatch(/NaN|undefined/);
      // Same day as the board: no live mark.
      expect(screen.queryByText("（即時）")).toBeNull();

      // jsdom has no layout, so this only pins the classes that keep a long list reachable: the
      // sticky pane is capped to the viewport and scrolls by itself.
      const pane = screen.getByRole("heading", { name: "石英元件" }).closest(".sticky");
      expect(pane?.className).toContain("max-h-[calc(100dvh-2rem)]");
      expect(pane?.className).toContain("overflow-y-auto");

      // Choosing another sector swaps the pane without leaving the table.
      await userEvent.click(
        within(screen.getByRole("table")).getByRole("button", { name: "被動元件" }),
      );
      await act(async () => {});
      expect(screen.getByRole("table")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "被動元件" })).toBeTruthy();
      expect(screen.queryByRole("heading", { name: "石英元件" })).toBeNull();
    });

    it("marks a pane fetched live as newer than the board beside it", async () => {
      routes[sectorDetailUrl("石英元件")] = () =>
        Response.json(
          { ...quartz, tradeDate: "2026-10-14", asOf: "13:25" },
          { headers: { "x-data-trade-date": "2026-10-14" } },
        );
      await renderScreen();
      await userEvent.click(
        within(screen.getByRole("table")).getByRole("button", { name: "石英元件" }),
      );
      await act(async () => {});
      const pane = screen.getByRole("region", { name: "石英元件成分股" });
      expect(pane.textContent).toContain("資料日期 2026-10-14（三） 13:25（即時）");
    });

    it("swaps 成交值 for the plain-language line in the beginner lens", async () => {
      await renderScreen();
      const headers = within(screen.getByRole("table")).getAllByRole("columnheader");
      expect(headers.map((h) => h.textContent)).toEqual([
        "名稱",
        "漲跌幅",
        "上漲／下跌家數",
        "說明",
        "近一月",
      ]);
    });
  });
});
