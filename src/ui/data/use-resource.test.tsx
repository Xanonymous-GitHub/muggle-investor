import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_VERSION, readCache, writeCache } from "@/ui/data/resource-cache";
import { useResource } from "@/ui/data/use-resource";

type Pending = { url: string; resolve: (response: Response) => void; reject: (e: Error) => void };

let pending: Pending[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

/** A fake fetch whose responses the test releases by hand, in any order. */
beforeEach(() => {
  pending = [];
  fetchMock = vi.fn(
    (input: RequestInfo | URL) =>
      new Promise<Response>((resolve, reject) => {
        pending.push({ url: String(input), resolve, reject });
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  // Settle anything left so no request stays in flight into the next test.
  await act(async () => {
    for (const p of pending) p.reject(new Error("test over"));
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

async function respond(url: string, body: unknown, init: ResponseInit = {}): Promise<void> {
  const index = pending.findIndex((p) => p.url === url);
  if (index < 0) throw new Error(`no pending request for ${url}`);
  const [p] = pending.splice(index, 1);
  await act(async () => {
    p?.resolve(Response.json(body, init));
  });
}

let urlSeq = 0;
/** Unique per test, so an in-flight request can never leak between tests. */
const freshUrl = (name: string): string => `/api/test/${name}/${++urlSeq}`;

function Probe({ url, log }: { url: string | null; log?: string[] }) {
  const r = useResource<{ n: number }>(url);
  let text: string = r.status;
  if (r.status === "ready")
    text = `ready|${r.data.n}|${r.dataDate}|${r.fromCache ? "cache" : "fresh"}|${r.savedAt}`;
  if (r.status === "error") text = `error|${r.kind}|${r.retryAfterSeconds}`;
  log?.push(`${url} ${text}`);
  return (
    <div>
      <span data-testid="state">{text}</span>
      <button type="button" onClick={r.reload}>
        reload
      </button>
    </div>
  );
}

const state = () => screen.getByTestId("state").textContent;

const seed = (url: string, n: number, savedAt = "2026-10-12T08:00:00.000Z") =>
  writeCache(url, { v: CACHE_VERSION, savedAt, dataDate: "2026-10-07", body: { n } });

describe("useResource", () => {
  it("is idle for a null url and does not fetch", () => {
    render(<Probe url={null} />);
    expect(state()).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("goes loading → ready fresh and writes the cache", async () => {
    const url = freshUrl("fresh");
    render(<Probe url={url} />);
    expect(state()).toBe("loading");
    await respond(url, { n: 1 }, { headers: { "x-data-trade-date": "2026-10-08" } });
    expect(state()).toMatch(/^ready\|1\|2026-10-08\|fresh\|\d{4}-\d\d-\d\dT/);
    expect(readCache<{ n: number }>(url)).toMatchObject({ dataDate: "2026-10-08", body: { n: 1 } });
  });

  it("renders the cached entry first, then the fresh one", async () => {
    const url = freshUrl("cached");
    seed(url, 1);
    render(<Probe url={url} />);
    expect(state()).toBe("ready|1|2026-10-07|cache|2026-10-12T08:00:00.000Z");
    await respond(url, { n: 2 }, { headers: { "x-data-trade-date": "2026-10-08" } });
    expect(state()).toMatch(/^ready\|2\|2026-10-08\|fresh\|/);
  });

  it("keeps the cached data when the fetch fails", async () => {
    const url = freshUrl("cached-fail");
    seed(url, 1);
    render(<Probe url={url} />);
    await respond(url, { error: "internal_error" }, { status: 500 });
    expect(state()).toBe("ready|1|2026-10-07|cache|2026-10-12T08:00:00.000Z");
  });

  it("shows an error when the fetch fails and nothing is cached", async () => {
    const url = freshUrl("fail");
    render(<Probe url={url} />);
    await respond(url, { error: "busy" }, { status: 503, headers: { "retry-after": "12" } });
    expect(state()).toBe("error|busy|12");
  });

  it("ignores a late response for a url that is no longer current", async () => {
    const a = freshUrl("a");
    const b = freshUrl("b");
    const { rerender } = render(<Probe url={a} />);
    rerender(<Probe url={b} />);
    expect(state()).toBe("loading");
    await respond(b, { n: 2 });
    expect(state()).toMatch(/^ready\|2\|/);
    await respond(a, { n: 1 });
    expect(state()).toMatch(/^ready\|2\|/);
    // The old response was still good data, so it is cached for its own url.
    expect(readCache<{ n: number }>(a)?.body).toEqual({ n: 1 });
  });

  it("never renders the old url's data for the new url, not even once", async () => {
    const a = freshUrl("a");
    const b = freshUrl("b");
    const log: string[] = [];
    const { rerender } = render(<Probe url={a} log={log} />);
    await respond(a, { n: 1 });
    rerender(<Probe url={b} log={log} />);
    expect(state()).toBe("loading");
    expect(log.filter((line) => line.startsWith(`${b} ready`))).toEqual([]);
    await respond(b, { error: "not_found" }, { status: 404 });
    expect(state()).toBe("error|not_found|null");
  });

  it("ignores a late failure for an old url", async () => {
    const a = freshUrl("a");
    const b = freshUrl("b");
    const { rerender } = render(<Probe url={a} />);
    rerender(<Probe url={b} />);
    await respond(b, { n: 2 });
    await respond(a, { error: "x" }, { status: 500 });
    expect(state()).toMatch(/^ready\|2\|/);
  });

  it("switching to null goes idle and drops the in-flight response", async () => {
    const a = freshUrl("a");
    const { rerender } = render(<Probe url={a} />);
    rerender(<Probe url={null} />);
    expect(state()).toBe("idle");
    await respond(a, { n: 1 });
    expect(state()).toBe("idle");
  });

  it("ignores a response that lands after unmount", async () => {
    const errors = vi.spyOn(console, "error");
    const url = freshUrl("unmount");
    const { unmount } = render(<Probe url={url} />);
    unmount();
    await respond(url, { n: 1 });
    expect(errors).not.toHaveBeenCalled();
    expect(readCache<{ n: number }>(url)?.body).toEqual({ n: 1 });
  });

  it("fetches once and settles once under StrictMode", async () => {
    const url = freshUrl("strict");
    seed(url, 1);
    render(
      <StrictMode>
        <Probe url={url} />
      </StrictMode>,
    );
    expect(state()).toBe("ready|1|2026-10-07|cache|2026-10-12T08:00:00.000Z");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await respond(url, { n: 2 });
    expect(state()).toMatch(/^ready\|2\|null\|fresh\|/);
    expect(pending).toHaveLength(0);
  });

  it("shares one request between two consumers of the same url", async () => {
    const url = freshUrl("shared");
    render(
      <>
        <Probe url={url} />
        <Probe url={url} />
      </>,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await respond(url, { n: 3 });
    for (const el of screen.getAllByTestId("state")) expect(el.textContent).toMatch(/^ready\|3\|/);
  });

  it("reload after an error fetches again", async () => {
    const url = freshUrl("reload");
    render(<Probe url={url} />);
    await respond(url, { error: "x" }, { status: 500 });
    expect(state()).toBe("error|failed|null");
    await act(async () => screen.getByRole("button", { name: "reload" }).click());
    expect(state()).toBe("loading");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await respond(url, { n: 4 });
    expect(state()).toMatch(/^ready\|4\|/);
  });

  it("reload keeps showing ready data while it refetches", async () => {
    const url = freshUrl("reload-ready");
    render(<Probe url={url} />);
    await respond(url, { n: 1 });
    await act(async () => screen.getByRole("button", { name: "reload" }).click());
    expect(state()).toMatch(/^ready\|1\|null\|fresh\|/);
    await respond(url, { error: "x" }, { status: 500 });
    expect(state()).toMatch(/^ready\|1\|null\|cache\|/);
  });
});
