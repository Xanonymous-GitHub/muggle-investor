import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  clearedSessionCookie,
  requireSession,
  SESSION_COOKIE,
  sessionCookie,
  signSession,
  subjectFor,
  verifySession,
} from "./session";

const SECRET = "s".repeat(32);
const OTHER_SECRET = "o".repeat(32);
const NOW = new Date("2026-10-17T00:00:00Z");
const DAY = 24 * 60 * 60;

const getEnv = vi.hoisted(() => vi.fn());
vi.mock("@/config/env", () => ({ getEnv: () => getEnv() }));

const tokenFor = (code: string, now = NOW, ttlSeconds?: number) =>
  signSession({ subject: subjectFor(code, SECRET), now, ttlSeconds }, SECRET);

/** Replaces the character at `index` with a different valid base64url character. */
const flip = (text: string, index: number) =>
  text.slice(0, index) + (text[index] === "A" ? "B" : "A") + text.slice(index + 1);

describe("subjectFor", () => {
  it("is 32 hex characters, stable per code and secret", () => {
    const subject = subjectFor("friend-code", SECRET);
    expect(subject).toMatch(/^[0-9a-f]{32}$/);
    expect(subject).toBe(
      createHmac("sha256", SECRET).update("subject:friend-code").digest("hex").slice(0, 32),
    );
    expect(subjectFor("friend-code", SECRET)).toBe(subject);
    expect(subjectFor("friend-code", OTHER_SECRET)).not.toBe(subject);
  });

  it("gives two codes two different subjects that reveal nothing of the code", () => {
    const a = subjectFor("alpha-code", SECRET);
    const b = subjectFor("beta-code", SECRET);
    expect(a).not.toBe(b);
    for (const part of ["alpha", "code", "alpha-code"]) expect(a).not.toContain(part);
  });
});

describe("signSession / verifySession", () => {
  const codes = ["alpha-code", "beta-code"];
  const verify = (
    token: string | null,
    over: { now?: Date; codes?: string[]; secret?: string } = {},
  ) => verifySession(token, { secret: SECRET, codes, now: NOW, ...over });

  it("round-trips to the subject", () => {
    expect(verify(tokenFor("alpha-code"))).toEqual({ subject: subjectFor("alpha-code", SECRET) });
    expect(verify(tokenFor("beta-code"))).toEqual({ subject: subjectFor("beta-code", SECRET) });
  });

  it("has the shape base64url(payload).base64url(hmac) and no code in it", () => {
    const token = tokenFor("alpha-code");
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(token).not.toContain("alpha");
  });

  it("defaults to a 30 day lifetime and honours an explicit ttl", () => {
    const token = tokenFor("alpha-code");
    expect(verify(token, { now: new Date(NOW.getTime() + (30 * DAY - 1) * 1000) })).not.toBeNull();
    expect(verify(token, { now: new Date(NOW.getTime() + (30 * DAY + 1) * 1000) })).toBeNull();
    const short = tokenFor("alpha-code", NOW, 60);
    expect(verify(short, { now: new Date(NOW.getTime() + 30_000) })).not.toBeNull();
    expect(verify(short, { now: new Date(NOW.getTime() + 61_000) })).toBeNull();
  });

  it("rejects an expired token one second past its expiry", () => {
    const token = tokenFor("alpha-code", NOW, 100);
    expect(verify(token, { now: new Date(NOW.getTime() + 101_000) })).toBeNull();
  });

  it("rejects a flipped payload byte", () => {
    const token = tokenFor("alpha-code");
    expect(verify(flip(token, 3))).toBeNull();
  });

  it("rejects a flipped signature byte, including the last (partly padding) character", () => {
    const token = tokenFor("alpha-code");
    const dot = token.indexOf(".");
    expect(verify(flip(token, dot + 1))).toBeNull();
    const last = token.length - 1;
    for (const swap of ["A", "B", "C", "Q"]) {
      if (swap === token[last]) continue;
      expect(verify(token.slice(0, last) + swap)).toBeNull();
    }
  });

  it("rejects truncated, empty, null and malformed tokens", () => {
    const token = tokenFor("alpha-code");
    expect(verify(token.slice(0, -5))).toBeNull();
    expect(verify(token.slice(0, token.indexOf(".")))).toBeNull();
    expect(verify("")).toBeNull();
    expect(verify(null)).toBeNull();
    expect(verify(".")).toBeNull();
    expect(verify("a.b.c")).toBeNull();
    expect(verify(`${token}.extra`)).toBeNull();
    expect(verify("not a token")).toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    const forged = signSession(
      { subject: subjectFor("alpha-code", OTHER_SECRET), now: NOW },
      OTHER_SECRET,
    );
    expect(verify(forged)).toBeNull();
  });

  it("rejects a correctly signed token whose payload is not {s, e}", () => {
    const payload = Buffer.from(JSON.stringify({ s: 1, e: "x" })).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(`session:${payload}`).digest("base64url");
    expect(verify(`${payload}.${sig}`)).toBeNull();
  });

  it("keeps the two uses of the secret apart: a bare-payload signature or a bare-code subject is rejected", () => {
    const payload = Buffer.from(
      JSON.stringify({
        s: subjectFor("alpha-code", SECRET),
        e: Math.floor(NOW.getTime() / 1000) + 600,
      }),
    ).toString("base64url");
    const bare = createHmac("sha256", SECRET).update(payload).digest("base64url");
    expect(verify(`${payload}.${bare}`)).toBeNull();
    const good = createHmac("sha256", SECRET).update(`session:${payload}`).digest("base64url");
    expect(verify(`${payload}.${good}`)).not.toBeNull();
    const bareSubject = createHmac("sha256", SECRET)
      .update("alpha-code")
      .digest("hex")
      .slice(0, 32);
    expect(bareSubject).not.toBe(subjectFor("alpha-code", SECRET));
    expect(verify(signSession({ subject: bareSubject, now: NOW }, SECRET))).toBeNull();
  });

  it("revokes a token whose code was removed from the configured codes", () => {
    const token = tokenFor("beta-code");
    expect(verify(token, { codes: ["alpha-code"] })).toBeNull();
    expect(verify(token, { codes: [] })).toBeNull();
  });

  it("rejects a token whose subject was made up rather than derived from a code", () => {
    const made = signSession({ subject: "a".repeat(32), now: NOW }, SECRET);
    expect(verify(made)).toBeNull();
  });
});

describe("cookies", () => {
  it("sets an HttpOnly, SameSite=Lax, Path=/ cookie with the max age", () => {
    const cookie = sessionCookie("tok.sig", { secure: false, maxAgeSeconds: 2592000 });
    expect(cookie).toContain(`${SESSION_COOKIE}=tok.sig`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=2592000");
    expect(cookie).not.toContain("Secure");
  });

  it("adds Secure when asked", () => {
    expect(sessionCookie("t", { secure: true, maxAgeSeconds: 1 })).toContain("Secure");
    expect(clearedSessionCookie(true)).toContain("Secure");
  });

  it("clears with an empty value and Max-Age=0", () => {
    const cookie = clearedSessionCookie(false);
    expect(cookie).toContain(`${SESSION_COOKIE}=;`);
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
  });
});

describe("requireSession", () => {
  getEnv.mockReturnValue({ AUTH_SECRET: SECRET, INVITE_CODES: ["alpha-code", "beta-code"] });
  const requestWith = (cookie?: string) =>
    new Request("http://x/api/ask", { headers: cookie ? { cookie } : {} });

  it("reads the session cookie among others", () => {
    const token = tokenFor("alpha-code", new Date());
    const result = requireSession(requestWith(`theme=dark; ${SESSION_COOKIE}=${token}; other=1`));
    expect(result).toEqual({ subject: subjectFor("alpha-code", SECRET) });
  });

  it("is null without the cookie, with a bad one, or after the code was revoked", () => {
    expect(requireSession(requestWith())).toBeNull();
    expect(requireSession(requestWith("theme=dark"))).toBeNull();
    expect(requireSession(requestWith(`${SESSION_COOKIE}=garbage`))).toBeNull();
    const token = tokenFor("gamma-code", new Date());
    expect(requireSession(requestWith(`${SESSION_COOKIE}=${token}`))).toBeNull();
  });

  it("takes an explicit clock", () => {
    const token = tokenFor("alpha-code", NOW, 60);
    const cookie = `${SESSION_COOKIE}=${token}`;
    expect(requireSession(requestWith(cookie), new Date(NOW.getTime() + 30_000))).not.toBeNull();
    expect(requireSession(requestWith(cookie), new Date(NOW.getTime() + 90_000))).toBeNull();
  });
});
