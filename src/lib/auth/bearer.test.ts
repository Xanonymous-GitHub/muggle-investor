import { describe, expect, it } from "vitest";
import { verifyBearer } from "./bearer";

const SECRET = "a-cron-secret-that-is-at-least-32-chars";

describe("verifyBearer", () => {
  it("accepts the exact bearer token", () => {
    expect(verifyBearer(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a wrong token of the same length", () => {
    const wrong = `${SECRET.slice(0, -1)}X`;
    expect(wrong).toHaveLength(SECRET.length);
    expect(verifyBearer(`Bearer ${wrong}`, SECRET)).toBe(false);
  });

  it("rejects a token of a different length", () => {
    expect(verifyBearer(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(verifyBearer(`Bearer ${SECRET.slice(1)}`, SECRET)).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyBearer(null, SECRET)).toBe(false);
    expect(verifyBearer("", SECRET)).toBe(false);
    expect(verifyBearer(SECRET, SECRET)).toBe(false);
    expect(verifyBearer(`Basic ${SECRET}`, SECRET)).toBe(false);
    expect(verifyBearer("Bearer ", SECRET)).toBe(false);
  });

  it("never accepts anything when the secret is empty", () => {
    expect(verifyBearer("Bearer ", "")).toBe(false);
    expect(verifyBearer(null, "")).toBe(false);
  });
});
