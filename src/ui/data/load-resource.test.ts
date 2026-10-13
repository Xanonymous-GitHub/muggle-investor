import { describe, expect, it } from "vitest";
import { loadResource } from "@/ui/data/load-resource";

const respond =
  (response: Response): typeof fetch =>
  async () =>
    response;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  Response.json(body, { status, headers });

describe("loadResource", () => {
  it("returns the body and the data date on 200", async () => {
    const result = await loadResource(
      "/api/x",
      respond(json({ a: 1 }, 200, { "x-data-trade-date": "2026-10-08" })),
    );
    expect(result).toEqual({ ok: true, body: { a: 1 }, dataDate: "2026-10-08" });
  });

  it("has a null data date when the header is absent", async () => {
    const result = await loadResource("/api/x", respond(json({ a: 1 })));
    expect(result).toEqual({ ok: true, body: { a: 1 }, dataDate: null });
  });

  it("maps 404 to not_found", async () => {
    const result = await loadResource("/api/x", respond(json({ error: "not_found" }, 404)));
    expect(result).toEqual({ ok: false, kind: "not_found", retryAfterSeconds: null });
  });

  it("maps 503 busy to busy with retry-after", async () => {
    const result = await loadResource(
      "/api/x",
      respond(json({ error: "busy" }, 503, { "retry-after": "12" })),
    );
    expect(result).toEqual({ ok: false, kind: "busy", retryAfterSeconds: 12 });
  });

  it("maps any other 503 to unavailable with retry-after", async () => {
    const result = await loadResource(
      "/api/x",
      respond(json({ error: "unavailable" }, 503, { "retry-after": "300" })),
    );
    expect(result).toEqual({ ok: false, kind: "unavailable", retryAfterSeconds: 300 });
    const noBody = await loadResource("/api/x", respond(new Response("down", { status: 503 })));
    expect(noBody).toEqual({ ok: false, kind: "unavailable", retryAfterSeconds: null });
  });

  it("ignores a retry-after that is not whole seconds", async () => {
    const result = await loadResource(
      "/api/x",
      respond(json({ error: "busy" }, 503, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" })),
    );
    expect(result).toEqual({ ok: false, kind: "busy", retryAfterSeconds: null });
  });

  it("maps other non-2xx to failed", async () => {
    const result = await loadResource("/api/x", respond(json({ error: "internal_error" }, 500)));
    expect(result).toEqual({ ok: false, kind: "failed", retryAfterSeconds: null });
  });

  it("maps a rejected fetch to failed", async () => {
    const result = await loadResource("/api/x", async () => {
      throw new TypeError("network down");
    });
    expect(result).toEqual({ ok: false, kind: "failed", retryAfterSeconds: null });
  });

  it("maps a non-JSON body to failed", async () => {
    const result = await loadResource("/api/x", respond(new Response("<html>oops</html>")));
    expect(result).toEqual({ ok: false, kind: "failed", retryAfterSeconds: null });
  });

  it("requests the url it was given", async () => {
    const seen: string[] = [];
    await loadResource("/api/market/today", async (input) => {
      seen.push(String(input));
      return json({});
    });
    expect(seen).toEqual(["/api/market/today"]);
  });
});
