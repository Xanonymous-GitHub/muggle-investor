import { describe, expect, it, vi } from "vitest";
import { BRIEFING_RUN_BUDGET_MS } from "@/ingestion/briefings";

vi.mock("@/server/services", () => ({}));

const route = await import("../../app/api/cron/ingest/route");

describe("/api/cron/ingest", () => {
  it("declares a 300 s maxDuration that leaves room after the briefing budget", () => {
    expect(route.maxDuration).toBe(300);
    expect(BRIEFING_RUN_BUDGET_MS).toBeLessThan(route.maxDuration * 1000);
  });
});
