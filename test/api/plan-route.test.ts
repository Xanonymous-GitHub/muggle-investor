import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db/client";
import { planResponseSchema } from "@/planner/schema";
import { PLAN_NOW, seedPlanMarket } from "../helpers/plan-fixtures";
import { createTestDb } from "../helpers/test-db";

let db: Db;
vi.mock("@/server/services", () => ({ getDb: () => db }));
const log = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: log }));

const { POST } = await import("../../app/api/plan/route");

const VALID = {
  answers: {
    age: "age-40-49",
    horizon: "horizon-5-10y",
    income: "income-stable",
    reserve: "reserve-3-6m",
    loss: "loss-hold",
  },
  lump: 654_321,
  monthly: 12_345,
  monthlyExpenses: 31_234,
  existingReserve: 987_654,
};
const AMOUNTS = ["654321", "12345", "31234", "987654"];

const post = (body: string) =>
  POST(
    new Request("http://x/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    }),
  );
const postJson = (body: unknown) => post(JSON.stringify(body));

function expectNoAmountsLogged(): void {
  const logged = JSON.stringify(Object.values(log).flatMap((fn) => fn.mock.calls));
  for (const amount of AMOUNTS) expect(logged).not.toContain(amount);
}

async function expectInvalid(res: Response): Promise<void> {
  expect(res.status).toBe(400);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ error: "invalid_request" });
}

describe("POST /api/plan", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(PLAN_NOW);
    for (const fn of Object.values(log)) fn.mockClear();
    db = await createTestDb();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["a negative lump", { ...VALID, lump: -1 }],
    ["zero lump and monthly", { ...VALID, lump: 0, monthly: 0 }],
    ["a non-integer amount", { ...VALID, monthly: 100.5 }],
    ["an unknown option id", { ...VALID, answers: { ...VALID.answers, loss: "loss-???" } }],
    ["a missing answer", { ...VALID, answers: { ...VALID.answers, age: undefined } }],
    ["an amount of 10**12", { ...VALID, lump: 10 ** 12 }],
    ["a string amount", { ...VALID, lump: "1000" }],
  ])("rejects %s with 400 invalid_request", async (_label, body) => {
    await expectInvalid(await postJson(body));
  });

  it("rejects a non-JSON body with 400 invalid_request", async () => {
    await expectInvalid(await post("{not json"));
  });

  it("returns a plan that parses with the response schema", async () => {
    await seedPlanMarket(db);
    const res = await postJson(VALID);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = planResponseSchema.parse(await res.json());
    expect(body.kind).toBe("plan");
    expectNoAmountsLogged();
  });

  it("returns 503 data_unavailable when no core ETF qualifies", async () => {
    const res = await postJson(VALID);
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "data_unavailable" });
    expectNoAmountsLogged();
  });

  it("returns 500 internal_error and logs no amounts when the database fails", async () => {
    db = {
      select: () => {
        // An engine error may quote a rejected amount; it must not reach the log.
        throw new RangeError(`lump must be whole, got ${VALID.lump}`);
      },
    } as unknown as Db;
    const res = await postJson(VALID);
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "internal_error" });
    expect(log.error).toHaveBeenCalledTimes(1);
    expectNoAmountsLogged();
  });
});
