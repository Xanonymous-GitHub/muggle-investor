import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE, subjectFor, verifySession } from "@/ask/auth/session";

const SECRET = "s".repeat(32);
const CODES = ["alpha-code", "beta-code"];

const getEnv = vi.hoisted(() => vi.fn());
vi.mock("@/config/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/env")>()),
  getEnv: () => getEnv(),
}));
const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: log }));

const invite = await import("../../app/api/auth/invite/route");
const session = await import("../../app/api/auth/session/route");

let ipCounter = 0;
/** Each test gets its own client address so the per-IP limiter never carries over. */
let ip: string;

const postInvite = (body: string, url = "http://x/api/auth/invite", address = ip) =>
  invite.POST(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": address },
      body,
    }),
  );
const login = (code: string, address = ip) =>
  postInvite(JSON.stringify({ code }), undefined, address);

const cookieOf = (res: Response) => res.headers.get("set-cookie") ?? "";
const tokenOf = (res: Response) =>
  cookieOf(res)
    .split(";")[0]
    ?.slice(SESSION_COOKIE.length + 1) ?? "";

beforeEach(() => {
  ipCounter += 1;
  ip = `203.0.113.${ipCounter}`;
  getEnv.mockReset();
  getEnv.mockReturnValue({ AUTH_SECRET: SECRET, INVITE_CODES: CODES });
});

describe("POST /api/auth/invite", () => {
  it("accepts a configured code with 204 and a cookie that verifies", async () => {
    const res = await login("beta-code");
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const cookie = cookieOf(res);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).not.toContain("Secure");
    expect(cookie).not.toContain("beta-code");
    expect(verifySession(tokenOf(res), { secret: SECRET, codes: CODES, now: new Date() })).toEqual({
      subject: subjectFor("beta-code", SECRET),
    });
  });

  it("sets Secure over https", async () => {
    const res = await postInvite(
      JSON.stringify({ code: "alpha-code" }),
      "https://x/api/auth/invite",
    );
    expect(res.status).toBe(204);
    expect(cookieOf(res)).toContain("Secure");
  });

  it("sets Secure in production even over http", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const res = await login("alpha-code");
      expect(cookieOf(res)).toContain("Secure");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects a wrong code with 401 invalid_code and no cookie", async () => {
    const res = await login("nope");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_code" });
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("does not accept a prefix or a padded version of a code", async () => {
    expect((await login("alpha")).status).toBe(401);
    expect((await login("alpha-code ")).status).toBe(401);
  });

  it.each([
    ["not json", "{oops"],
    ["a missing code", "{}"],
    ["a non-string code", '{"code":5}'],
    ["an empty code", '{"code":""}'],
    ["an array", "[]"],
    ["an empty body", ""],
  ])("answers 400 invalid_request for %s", async (_label, body) => {
    const res = await postInvite(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("answers 400 for a body over 256 bytes, declared or streamed", async () => {
    const big = JSON.stringify({ code: "x".repeat(300) });
    expect((await postInvite(big)).status).toBe(400);
    const streamed = new Request("http://x/api/auth/invite", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(big));
          controller.close();
        },
      }),
      // @ts-expect-error duplex is required by Node for stream bodies
      duplex: "half",
    });
    expect((await invite.POST(streamed)).status).toBe(400);
  });

  it("blocks the 6th wrong attempt from one address with 429 and a retry-after", async () => {
    for (let i = 0; i < 5; i += 1) expect((await login(`wrong-${i}`)).status).toBe(401);
    const blocked = await login("wrong-5");
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(blocked.headers.get("set-cookie")).toBeNull();
  });

  it("does not let parallel wrong codes from one address past the limit", async () => {
    const statuses = (
      await Promise.all(Array.from({ length: 20 }, (_, i) => login(`parallel-wrong-${i}`)))
    ).map((res) => res.status);
    expect(statuses.filter((status) => status === 401).length).toBeLessThanOrEqual(5);
    expect(statuses.filter((status) => status !== 401).every((status) => status === 429)).toBe(
      true,
    );
    expect(statuses.filter((status) => status === 429).length).toBeGreaterThanOrEqual(15);
  });

  it("keeps blocking an address even for the right code once it is locked out", async () => {
    for (let i = 0; i < 6; i += 1) await login(`wrong-${i}`);
    expect((await login("alpha-code")).status).toBe(429);
  });

  it("does not lock out other addresses", async () => {
    for (let i = 0; i < 6; i += 1) await login(`wrong-${i}`);
    expect((await login("alpha-code", "198.51.100.77")).status).toBe(204);
  });

  it("counts a missing forwarded address as one shared client", async () => {
    const bare = () =>
      invite.POST(
        new Request("http://x/api/auth/invite", { method: "POST", body: '{"code":"nope"}' }),
      );
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await bare()).status);
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });
});

describe("failed-attempt throttle", () => {
  const attemptsFrom = async (address: string, codes: string[]) => {
    const statuses: number[] = [];
    for (const code of codes) statuses.push((await login(code, address)).status);
    return statuses;
  };

  it("does not spend an attempt on a successful login", async () => {
    for (let i = 0; i < 10; i += 1) expect((await login("alpha-code")).status).toBe(204);
    expect(await attemptsFrom(ip, ["w1", "w2", "w3", "w4", "w5"])).toEqual([
      401, 401, 401, 401, 401,
    ]);
  });

  it("does not spend an attempt on junk bodies (400)", async () => {
    for (let i = 0; i < 10; i += 1) expect((await postInvite("{oops")).status).toBe(400);
    expect((await postInvite('{"code":5}')).status).toBe(400);
    expect(await attemptsFrom(ip, ["w1", "w2", "w3", "w4"])).toEqual([401, 401, 401, 401]);
    expect((await login("alpha-code")).status).toBe(204);
  });

  it("keeps answering 429 after 5 failures even for the right code, until the window ends (intended)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-17T00:00:00Z"));
      await attemptsFrom(ip, ["w1", "w2", "w3", "w4", "w5"]);
      expect((await login("alpha-code")).status).toBe(429);
      vi.setSystemTime(new Date("2026-10-17T00:09:59Z"));
      expect((await login("alpha-code")).status).toBe(429);
      vi.setSystemTime(new Date("2026-10-17T00:10:01Z"));
      expect((await login("alpha-code")).status).toBe(204);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not block another address, even one sharing the first forwarded hop", async () => {
    await attemptsFrom(ip, ["w1", "w2", "w3", "w4", "w5"]);
    expect((await login("alpha-code", "198.51.100.200")).status).toBe(204);
  });

  it("uses x-real-ip when present, ahead of x-forwarded-for", async () => {
    const withHeaders = (headers: Record<string, string>, code: string) =>
      invite.POST(
        new Request("http://x/api/auth/invite", {
          method: "POST",
          headers,
          body: JSON.stringify({ code }),
        }),
      );
    const real = `192.0.2.${ipCounter}`;
    for (let i = 0; i < 5; i += 1) {
      await withHeaders({ "x-real-ip": real, "x-forwarded-for": `10.9.9.${i}` }, `w${i}`);
    }
    expect(
      (await withHeaders({ "x-real-ip": real, "x-forwarded-for": "10.8.8.8" }, "alpha-code"))
        .status,
    ).toBe(429);
  });

  it("keys on the right-most forwarded hop, so rotating the first hop does not evade the limit", async () => {
    const hop = (spoof: number, code: string) =>
      invite.POST(
        new Request("http://x/api/auth/invite", {
          method: "POST",
          headers: { "x-forwarded-for": `10.77.${spoof}.1, ${ip}` },
          body: JSON.stringify({ code }),
        }),
      );
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await hop(i, `w${i}`)).status);
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });
});

describe("logging", () => {
  it("never logs the code, the cookie or the address", async () => {
    await login("secret-wrong-guess");
    await login("alpha-code");
    const logged = JSON.stringify(Object.values(log).flatMap((fn) => fn.mock.calls));
    expect(logged).not.toContain("secret-wrong-guess");
    expect(logged).not.toContain("alpha-code");
    expect(logged).not.toContain(ip);
  });
});

describe("/api/auth/session", () => {
  const withCookie = async (method: "GET" | "DELETE", token?: string) =>
    (method === "GET" ? session.GET : session.DELETE)(
      new Request("http://x/api/auth/session", {
        method,
        headers: token === undefined ? {} : { cookie: `${SESSION_COOKIE}=${token}` },
      }),
    );

  it("GET is 200 { ok: true } with a valid cookie", async () => {
    const token = tokenOf(await login("alpha-code"));
    const res = await withCookie("GET", token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("GET is 401 without a cookie or with a bad one", async () => {
    const none = await withCookie("GET");
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: "unauthorized" });
    expect(none.headers.get("cache-control")).toBe("no-store");
    expect((await withCookie("GET", "garbage")).status).toBe(401);
  });

  it("GET is 401 once the code is removed from INVITE_CODES", async () => {
    const token = tokenOf(await login("beta-code"));
    getEnv.mockReturnValue({ AUTH_SECRET: SECRET, INVITE_CODES: ["alpha-code"] });
    expect((await withCookie("GET", token)).status).toBe(401);
  });

  it("DELETE answers 204 and clears the cookie, signed in or not", async () => {
    for (const token of [tokenOf(await login("alpha-code")), undefined]) {
      const res = await withCookie("DELETE", token);
      expect(res.status).toBe(204);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const cookie = cookieOf(res);
      expect(cookie).toContain(`${SESSION_COOKIE}=;`);
      expect(cookie).toContain("Max-Age=0");
      expect(cookie).toContain("HttpOnly");
    }
  });
});
