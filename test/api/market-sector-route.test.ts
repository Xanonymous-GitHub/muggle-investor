import { beforeEach, describe, expect, it, vi } from "vitest";

const getSectorDetail = vi.fn();
vi.mock("@/market/market-service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/market/market-service")>()),
  getSectorDetail: (...args: unknown[]) => getSectorDetail(...args),
}));
vi.mock("@/server/services", () => ({ getDb: () => ({}), getDarkfanxingClient: () => ({}) }));
vi.mock("@/config/env", () => ({ getEnv: () => ({ DARKFANXING_KEY: "k" }) }));
vi.mock("@/db/repositories/calendar", () => ({ getHolidays: async () => [] }));
vi.mock("@/lib/logger", async () => {
  const { default: pino } = await import("pino");
  return { logger: pino({ level: "silent" }) };
});

const { SectorDetailBusyError } = await import("@/market/market-service");
const { GET } = await import("../../app/api/market/sectors/[group]/route");

const call = (group: string) =>
  GET(new Request("http://x/api/market/sectors/x"), { params: Promise.resolve({ group }) });

describe("GET /api/market/sectors/[group]", () => {
  beforeEach(() => {
    getSectorDetail.mockReset();
  });

  it("maps a busy budget to 503 with Retry-After and no caching", async () => {
    getSectorDetail.mockRejectedValue(new SectorDetailBusyError(42));
    const res = await call("石英元件");
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "busy" });
  });

  it("maps null to 404 and other failures to 500", async () => {
    getSectorDetail.mockResolvedValue(null);
    expect((await call("不存在")).status).toBe(404);
    getSectorDetail.mockRejectedValue(new Error("boom"));
    const res = await call("石英元件");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
  });

  it("returns the detail with its data-date headers", async () => {
    getSectorDetail.mockResolvedValue({
      group: "石英元件",
      tradeDate: "2026-10-08",
      asOf: "13:34",
    });
    const res = await call("石英元件");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-data-as-of")).toBe("13:34");
  });
});
