import { describe, expect, it } from "vitest";
import { createInviteThrottle } from "./invite-throttle";

const WINDOW = 10 * 60 * 1000;

function setup(over: { maxEntries?: number } = {}) {
  let clock = 1_000_000;
  const throttle = createInviteThrottle({ now: () => clock, ...over });
  return {
    throttle,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe("createInviteThrottle", () => {
  it("lets an address through until it has 5 failures in the window", () => {
    const { throttle } = setup();
    for (let i = 0; i < 5; i += 1) {
      expect(throttle.check("a")).toEqual({ blocked: false });
      throttle.recordFailure("a");
    }
    const verdict = throttle.check("a");
    expect(verdict.blocked).toBe(true);
    expect(verdict).toMatchObject({ retryAfterSeconds: 600 });
  });

  it("checking never consumes anything", () => {
    const { throttle } = setup();
    for (let i = 0; i < 50; i += 1) expect(throttle.check("a")).toEqual({ blocked: false });
  });

  it("does not affect other addresses", () => {
    const { throttle } = setup();
    for (let i = 0; i < 5; i += 1) throttle.recordFailure("a");
    expect(throttle.check("a").blocked).toBe(true);
    expect(throttle.check("b")).toEqual({ blocked: false });
  });

  it("reports the time left and reopens when the fixed window ends", () => {
    const { throttle, advance } = setup();
    for (let i = 0; i < 5; i += 1) throttle.recordFailure("a");
    advance(WINDOW - 30_000);
    expect(throttle.check("a")).toMatchObject({ blocked: true, retryAfterSeconds: 30 });
    advance(30_000);
    expect(throttle.check("a")).toEqual({ blocked: false });
    // a new window starts clean
    for (let i = 0; i < 4; i += 1) throttle.recordFailure("a");
    expect(throttle.check("a")).toEqual({ blocked: false });
  });

  // Fixed window, not sliding: failures just before a boundary and just after can add up to 2x the limit.
  it("is a fixed window: failures do not slide the window forward", () => {
    const { throttle, advance } = setup();
    throttle.recordFailure("a");
    advance(WINDOW - 1);
    for (let i = 0; i < 4; i += 1) throttle.recordFailure("a");
    expect(throttle.check("a").blocked).toBe(true);
    advance(1);
    expect(throttle.check("a")).toEqual({ blocked: false });
  });

  it("never tracks more addresses than the cap, evicting the oldest first", () => {
    const { throttle } = setup({ maxEntries: 100 });
    for (let i = 0; i < 5; i += 1) throttle.recordFailure("victim");
    for (let i = 0; i < 10_000; i += 1) {
      throttle.recordFailure(`spoofed-${i}`);
      expect(throttle.size()).toBeLessThanOrEqual(100);
    }
    expect(throttle.size()).toBe(100);
    // the oldest entry (the victim's) was evicted; the newest is still tracked
    expect(throttle.check("victim")).toEqual({ blocked: false });
    for (let i = 0; i < 4; i += 1) throttle.recordFailure("spoofed-9999");
    expect(throttle.check("spoofed-9999").blocked).toBe(true);
  });

  it("defaults to a cap of 5000 addresses", () => {
    const { throttle } = setup();
    for (let i = 0; i < 6000; i += 1) throttle.recordFailure(`k-${i}`);
    expect(throttle.size()).toBe(5000);
  });
});
