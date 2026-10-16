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

  it("never tracks more addresses than the cap while a flood of spoofed addresses arrives", () => {
    const { throttle } = setup({ maxEntries: 100 });
    for (let i = 0; i < 10_000; i += 1) {
      throttle.recordFailure(`spoofed-${i}`);
      expect(throttle.size()).toBeLessThanOrEqual(100);
    }
    expect(throttle.size()).toBe(100);
  });

  it("at the cap, a flood of new addresses never evicts a blocked address", () => {
    const { throttle } = setup({ maxEntries: 10 });
    // the blocked buckets are the OLDEST inserted, which plain oldest-first eviction would drop
    for (const victim of ["blocked-1", "blocked-2", "blocked-3"]) {
      for (let i = 0; i < 5; i += 1) throttle.recordFailure(victim);
    }
    for (let i = 0; i < 7; i += 1) throttle.recordFailure(`one-${i}`);
    expect(throttle.size()).toBe(10);
    for (let i = 0; i < 10_000; i += 1) {
      throttle.recordFailure(`flood-${i}`);
      expect(throttle.size()).toBeLessThanOrEqual(10);
    }
    for (const victim of ["blocked-1", "blocked-2", "blocked-3"]) {
      expect(throttle.check(victim).blocked).toBe(true);
    }
  });

  it("evicts the entry with the fewest failures, the oldest among ties", () => {
    const { throttle } = setup({ maxEntries: 3 });
    throttle.recordFailure("two"); // oldest, but has 2 failures
    throttle.recordFailure("two");
    throttle.recordFailure("one-old");
    throttle.recordFailure("one-new");
    throttle.recordFailure("incoming"); // evicts one-old
    // `two` kept its count: 3 more failures reach the limit of 5
    for (let i = 0; i < 3; i += 1) throttle.recordFailure("two");
    expect(throttle.check("two").blocked).toBe(true);
    // one-new kept its count: 4 more reach the limit; one-old restarted from 0
    for (let i = 0; i < 4; i += 1) throttle.recordFailure("one-new");
    expect(throttle.check("one-new").blocked).toBe(true);
  });

  it("evicts an expired entry before any live one, whatever its failure count", () => {
    const { throttle, advance } = setup({ maxEntries: 3 });
    for (let i = 0; i < 5; i += 1) throttle.recordFailure("expired-blocked");
    advance(WINDOW - 60_000);
    throttle.recordFailure("live-a");
    throttle.recordFailure("live-b");
    advance(90_000); // expired-blocked's window ended; live-a/b are still open
    expect(throttle.size()).toBe(3);
    throttle.recordFailure("incoming");
    expect(throttle.size()).toBe(3);
    for (let i = 0; i < 4; i += 1) {
      throttle.recordFailure("live-a");
      throttle.recordFailure("live-b");
    }
    // both live entries kept their first failure, so 4 more made 5 and they are blocked
    expect(throttle.check("live-a").blocked).toBe(true);
    expect(throttle.check("live-b").blocked).toBe(true);
  });

  it("defaults to a cap of 5000 addresses", () => {
    const { throttle } = setup();
    for (let i = 0; i < 6000; i += 1) throttle.recordFailure(`k-${i}`);
    expect(throttle.size()).toBe(5000);
  });
});
