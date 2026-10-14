import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSectorDetail, type SectorDetail as SectorDetailData } from "@/sources/darkfanxing";
import { sectorDetailUrl } from "@/ui/data/api";
import { SectorDetail } from "@/ui/sectors/sector-detail";

const detail = parseSectorDetail(
  readFileSync(
    join(import.meta.dirname, "../../../test/fixtures/darkfanxing/group-quartz-2026-10-08.html"),
    "utf8",
  ),
);

type Route = () => Response | Promise<Response>;
let routes: Record<string, Route>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  routes = {};
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const route = routes[String(input)];
    return route ? route() : Response.json({ error: "not_found" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

async function renderDetail(
  group: string,
  onClose: () => void = () => {},
  boardTradeDate: string | null = detail.tradeDate,
) {
  const view = render(
    <SectorDetail group={group} onClose={onClose} boardTradeDate={boardTradeDate} />,
  );
  await settle();
  return view;
}

/** Lets the request, its body read and the resulting render finish. */
async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => {});
}

const serve = (group: string, body: SectorDetailData = detail) => {
  routes[sectorDetailUrl(group)] = () =>
    Response.json(body, { headers: { "x-data-trade-date": body.tradeDate } });
};
const bodyText = () => document.body.textContent ?? "";
const dataLine = () =>
  [...document.querySelectorAll("p")].find((p) => p.textContent?.startsWith("資料日期"))
    ?.textContent;

describe("SectorDetail", () => {
  it("shows the sector, its data line, rank, change, month change and every stock", async () => {
    serve("石英元件");
    await renderDetail("石英元件");

    expect(screen.getByRole("heading", { name: "石英元件" })).toBeTruthy();
    expect(dataLine()).toBe("資料日期 2026-10-08（四） 13:34");
    expect(screen.getByText("第 2 / 175")).toBeTruthy();
    expect(screen.getByText("+3.93%")).toBeTruthy();
    expect(screen.getByText("近一月 +31.70%")).toBeTruthy();

    const items = within(screen.getByRole("list", { name: "成分股" })).getAllByRole("listitem");
    expect(items).toHaveLength(detail.stocks.length);
    for (const stock of detail.stocks) {
      const item = items.find((el) => el.textContent?.includes(stock.code));
      expect(item?.textContent).toContain(stock.name);
    }
    expect(bodyText()).not.toMatch(/NaN|undefined/);
  });

  it("shows the date alone when the detail carries no time", async () => {
    serve("石英元件", { ...detail, asOf: null });
    await renderDetail("石英元件");
    expect(dataLine()).toBe("資料日期 2026-10-08（四）");
  });

  it("marks a detail newer than the board beside it as live", async () => {
    serve("石英元件", { ...detail, tradeDate: "2026-10-14", asOf: "13:25" });
    await renderDetail("石英元件", () => {}, "2026-10-08");
    expect(dataLine()).toBe("資料日期 2026-10-14（三） 13:25（即時）");
    expect(screen.getByText("（即時）").className).toContain("text-muted-foreground");
  });

  it("adds no live mark when the detail and the board share a date, or the board is unknown", async () => {
    serve("石英元件");
    const view = await renderDetail("石英元件", () => {}, detail.tradeDate);
    expect(screen.queryByText("（即時）")).toBeNull();
    view.unmount();
    await renderDetail("石英元件", () => {}, null);
    expect(screen.queryByText("（即時）")).toBeNull();
  });

  it("says a stock that did not trade today instead of printing a change", async () => {
    const first = detail.stocks[0];
    if (!first) throw new Error("fixture has no stocks");
    serve("石英元件", {
      ...detail,
      stocks: [{ ...first, changePct: 0, noTrade: true }, ...detail.stocks.slice(1)],
    });
    await renderDetail("石英元件");
    const item = screen.getByText(first.code).closest("li");
    expect(item?.textContent).toContain("今天沒成交");
    expect(item?.textContent).not.toContain("0.00%");
    expect(screen.getAllByText("今天沒成交")).toHaveLength(1);
  });

  it("renders as many stocks as arrive", async () => {
    const template = detail.stocks[0];
    if (!template) throw new Error("fixture has no stocks");
    const stocks = Array.from({ length: 40 }, (_, i) => ({
      ...template,
      code: String(1000 + i),
      name: `股票${i}`,
    }));
    serve("石英元件", { ...detail, stocks });
    await renderDetail("石英元件");
    expect(
      within(screen.getByRole("list", { name: "成分股" })).getAllByRole("listitem"),
    ).toHaveLength(40);
  });

  it("explains a sector without stocks", async () => {
    serve("石英元件", { ...detail, stocks: [] });
    await renderDetail("石英元件");
    expect(screen.getByText("這個族群目前沒有成分股資料。")).toBeTruthy();
  });

  it("shows a skeleton while loading", () => {
    // Its own group: a request that never settles stays shared under its url for the whole file.
    routes[sectorDetailUrl("慢慢載入")] = () => new Promise<Response>(() => {});
    render(<SectorDetail group="慢慢載入" boardTradeDate={null} onClose={() => {}} />);
    expect(screen.getByRole("status", { name: "載入中" })).toBeTruthy();
  });

  it("says when the group is not on the board", async () => {
    await renderDetail("不存在");
    expect(screen.getByText("找不到這個族群。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重試" })).toBeNull();
  });

  it("asks for the group with its name encoded", async () => {
    serve("軸承／滑軌", { ...detail, group: "軸承／滑軌" });
    await renderDetail("軸承／滑軌");
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContain(
      "/api/market/sectors/%E8%BB%B8%E6%89%BF%EF%BC%8F%E6%BB%91%E8%BB%8C",
    );
    expect(screen.getByRole("heading", { name: "軸承／滑軌" })).toBeTruthy();
  });

  it("tells a busy upstream's wait and retries on request", async () => {
    let calls = 0;
    routes[sectorDetailUrl("石英元件")] = () => {
      calls += 1;
      return calls === 1
        ? Response.json({ error: "busy" }, { status: 503, headers: { "retry-after": "12" } })
        : Response.json(detail, { headers: { "x-data-trade-date": detail.tradeDate } });
    };
    await renderDetail("石英元件");
    expect(screen.getByText(/12 秒/)).toBeTruthy();
    expect(screen.getByText("暫時查不到，約 12 秒後再試。")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "重試" }));
    await settle();
    expect(calls).toBe(2);
    expect(screen.getByRole("heading", { name: "石英元件" })).toBeTruthy();
    expect(screen.queryByText(/暫時查不到/)).toBeNull();
  });

  it("falls back to 60 seconds when busy names no wait", async () => {
    routes[sectorDetailUrl("石英元件")] = () => Response.json({ error: "busy" }, { status: 503 });
    await renderDetail("石英元件");
    expect(screen.getByText("暫時查不到，約 60 秒後再試。")).toBeTruthy();
  });

  it("explains a failure and retries on request", async () => {
    routes[sectorDetailUrl("石英元件")] = () =>
      Response.json({ error: "internal_error" }, { status: 500 });
    await renderDetail("石英元件");
    expect(screen.getByText("暫時讀不到成分股。")).toBeTruthy();

    serve("石英元件");
    await userEvent.click(screen.getByRole("button", { name: "重試" }));
    await settle();
    expect(screen.getByRole("heading", { name: "石英元件" })).toBeTruthy();
  });

  it("keeps the saved stocks with a stale notice when the refresh fails", async () => {
    serve("石英元件");
    const { unmount } = await renderDetail("石英元件");
    unmount();
    routes[sectorDetailUrl("石英元件")] = () =>
      Response.json({ error: "internal_error" }, { status: 500 });
    await renderDetail("石英元件");
    expect(screen.getByText("無法更新，顯示的是 2026-10-08（四） 的資料。")).toBeTruthy();
    expect(screen.getByRole("list", { name: "成分股" })).toBeTruthy();
  });

  it("calls onClose from the back button", async () => {
    serve("石英元件");
    const onClose = vi.fn();
    await renderDetail("石英元件", onClose);
    await userEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("offers the back button while loading and on errors too", async () => {
    const onClose = vi.fn();
    await renderDetail("不存在", onClose);
    await userEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
