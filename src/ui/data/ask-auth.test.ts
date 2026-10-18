import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteAskSession, getAskSession, postInvite } from "@/ui/data/ask-auth";

function stubFetch(impl: () => Promise<Response>) {
  const spy = vi.fn<typeof fetch>(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}
const status = (code: number) => async () =>
  new Response(code === 204 ? null : "{}", { status: code });
const offline = async () => {
  throw new TypeError("Failed to fetch");
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getAskSession", () => {
  it("GETs /api/auth/session uncached", async () => {
    const spy = stubFetch(status(200));
    await getAskSession();
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(url).toBe("/api/auth/session");
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.cache).toBe("no-store");
  });

  it.each([
    [200, "signed_in"],
    [401, "signed_out"],
    [500, "error"],
    [429, "error"],
  ] as const)("maps %i to %s", async (code, expected) => {
    stubFetch(status(code));
    expect(await getAskSession()).toBe(expected);
  });

  it("maps a network failure to error", async () => {
    stubFetch(offline);
    expect(await getAskSession()).toBe("error");
  });

  it("rejects when the caller aborts", async () => {
    const controller = new AbortController();
    stubFetch(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    await expect(getAskSession(controller.signal)).rejects.toThrow();
  });
});

describe("postInvite", () => {
  it("POSTs the code as JSON, uncached", async () => {
    const spy = stubFetch(status(204));
    await postInvite("abc-123");
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(url).toBe("/api/auth/invite");
    expect(init?.method).toBe("POST");
    expect(init?.cache).toBe("no-store");
    expect(JSON.parse(String(init?.body))).toEqual({ code: "abc-123" });
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it.each([
    [204, "ok"],
    [401, "invalid"],
    [429, "throttled"],
    [400, "error"],
    [500, "error"],
  ] as const)("maps %i to %s", async (code, expected) => {
    stubFetch(status(code));
    expect(await postInvite("x")).toBe(expected);
  });

  it("maps a network failure to error", async () => {
    stubFetch(offline);
    expect(await postInvite("x")).toBe("error");
  });

  it("never logs the code", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    stubFetch(status(401));
    await postInvite("secret-code");
    stubFetch(offline);
    await postInvite("secret-code");
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe("deleteAskSession", () => {
  it("DELETEs /api/auth/session and is true on 204", async () => {
    const spy = stubFetch(status(204));
    expect(await deleteAskSession()).toBe(true);
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(url).toBe("/api/auth/session");
    expect(init?.method).toBe("DELETE");
    expect(init?.cache).toBe("no-store");
  });

  it("is false on any other status or a network failure", async () => {
    stubFetch(status(500));
    expect(await deleteAskSession()).toBe(false);
    stubFetch(offline);
    expect(await deleteAskSession()).toBe(false);
  });
});
