import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";
import type { RateLimiter } from "@/lib/rate-limiter";
import { createDarkfanxingClient } from "./client";

const KEY = "sekret-key-123";
const BASE = "https://upstream.test";
const fixture = (name: string) => readFileSync(`test/fixtures/darkfanxing/${name}`, "utf8");

const html = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html" } });

const setup = (respond: (url: string) => Response) => {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return respond(url);
  }) as unknown as typeof fetch;
  const acquire = vi.fn(async () => {});
  const limiter: RateLimiter = { acquire };
  const client = createDarkfanxingClient({
    baseUrl: BASE,
    key: KEY,
    limiter,
    fetchImpl,
    sleep: async () => {},
  });
  return { client, urls, acquire, fetchImpl };
};

describe("darkfanxing client", () => {
  it("fetches and parses the sector board", async () => {
    const { client, urls, acquire } = setup(() => html(fixture("now-2026-10-08.html")));
    const result = await client.fetchSectorBoard();
    expect(urls).toEqual([`${BASE}/api/now/${KEY}`]);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(result.parsed?.sectors).toHaveLength(175);
    expect(result.parseError).toBeNull();
    expect(result.meta?.tradeDate).toBe("2026-10-08");
    expect(result.raw).toBe(fixture("now-2026-10-08.html"));
    expect(result.fetchedAt).toBeInstanceOf(Date);
  });

  it("fetches and parses the digest", async () => {
    const { client, urls } = setup(() => html(fixture("digest-2026-10-08.html")));
    const result = await client.fetchDigest();
    expect(urls).toEqual([`${BASE}/api/digest/${KEY}`]);
    expect(result.parseError).toBeNull();
    expect(result.parsed?.tradeDate).toBe("2026-10-08");
  });

  it("requests sector detail with the group URL-encoded", async () => {
    const { client, urls } = setup(() => html(fixture("group-quartz-2026-10-08.html")));
    const result = await client.fetchSectorDetail("石英元件");
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/\?group=%E7%9F%B3%E8%8B%B1%E5%85%83%E4%BB%B6$/);
    expect(urls[0]).toContain(`/api/now/${KEY}?group=`);
    expect(result.parseError).toBeNull();
    expect(result.parsed).not.toBeNull();
  });

  it("returns raw with parseError and null meta for an unparseable body", async () => {
    const body = "<html>garbage</html>";
    const { client } = setup(() => html(body));
    const result = await client.fetchSectorBoard();
    expect(result.raw).toBe(body);
    expect(result.parsed).toBeNull();
    expect(result.parseError).toBeTruthy();
    expect(result.meta).toBeNull();
  });

  it("keeps meta when the title is fine but the body fails to parse", async () => {
    const broken = fixture("now-2026-10-08.html").replace(
      /<table[\s\S]*?<\/table>/g,
      "<table></table>",
    );
    expect(broken).not.toBe(fixture("now-2026-10-08.html"));
    const { client } = setup(() => html(broken));
    const result = await client.fetchSectorBoard();
    expect(result.parsed).toBeNull();
    expect(result.parseError).toBeTruthy();
    expect(result.meta?.tradeDate).toBe("2026-10-08");
  });

  it("never leaks the key into parseError", async () => {
    const body = `<html><body><h1>x ${KEY}</h1><p>${KEY}</p></body></html>`;
    const { client } = setup(() => html(body));
    const result = await client.fetchSectorBoard();
    expect(result.parseError).toBeTruthy();
    expect(result.parseError).not.toContain(KEY);
  });

  it("throws a redacted HttpError after retrying a persistent 500", async () => {
    const { client, fetchImpl, acquire } = setup(() => new Response("boom", { status: 500 }));
    const error = await client.fetchSectorBoard().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HttpError);
    const httpError = error as HttpError;
    expect(httpError.status).toBe(500);
    expect(httpError.message).not.toContain(KEY);
    expect(httpError.url).not.toContain(KEY);
    expect(httpError.message).toContain("/api/now/***");
    expect(httpError.url).toContain("/api/now/***");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  it("redacts the key in digest errors too", async () => {
    const { client } = setup(() => new Response("nope", { status: 404 }));
    const error = (await client.fetchDigest().catch((e: unknown) => e)) as HttpError;
    expect(error.url).toContain("/api/digest/***");
    expect(error.message).not.toContain(KEY);
  });
});
