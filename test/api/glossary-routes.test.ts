import { describe, expect, it, vi } from "vitest";
import { GLOSSARY } from "@/glossary";

vi.mock("@/lib/logger", async () => {
  const { default: pino } = await import("pino");
  return { logger: pino({ level: "silent" }) };
});

const list = await import("../../app/api/glossary/route");
const one = await import("../../app/api/glossary/[id]/route");

const callOne = (id: string) =>
  one.GET(new Request(`http://x/api/glossary/${id}`), { params: Promise.resolve({ id }) });

describe("GET /api/glossary", () => {
  it("lists every glossary term, cacheable for an hour", async () => {
    const res = await list.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    const body = await res.json();
    expect(body.terms).toHaveLength(GLOSSARY.length);
    expect(body.terms[0]).toEqual(GLOSSARY[0]);
  });
});

describe("GET /api/glossary/[id]", () => {
  it("returns one term", async () => {
    const res = await callOne("force");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await res.json()).toEqual(GLOSSARY.find((term) => term.id === "force"));
  });

  it("answers 404 for an unknown id", async () => {
    const res = await callOne("nope");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it.each(["../x", "Force", "", "a".repeat(49), "a b", "%2e%2e"])(
    "rejects the id %j with 400",
    async (id) => {
      const res = await callOne(id);
      expect(res.status).toBe(400);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ error: "invalid id" });
    },
  );
});
