import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnvError } from "@/config/env";

const getEnv = vi.fn();
vi.mock("@/config/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/env")>()),
  getEnv: () => getEnv(),
}));

const { GET } = await import("../../app/api/health/route");

describe("GET /api/health", () => {
  beforeEach(() => {
    getEnv.mockReset();
  });

  it("is 200 ok when the environment is valid", async () => {
    getEnv.mockReturnValue({ DARKFANXING_KEY: "secret-value-should-not-leak" });
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", app: "muggle-investor" });
  });

  it("is 503 unhealthy, with no details, when the environment is invalid", async () => {
    getEnv.mockImplementation(() => {
      throw new EnvError(["DATABASE_URL", "CRON_SECRET"]);
    });
    const res = GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: "unhealthy" });
    expect(text).not.toContain("DATABASE_URL");
  });
});
