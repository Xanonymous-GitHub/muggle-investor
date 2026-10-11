import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limiter";

/** Fake clock: `sleep` advances time instead of waiting. */
const fakeClock = () => {
  let time = 0;
  const sleeps: number[] = [];
  return {
    now: () => time,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      time = Math.max(time, time + ms);
    },
    advance: (ms: number) => {
      time += ms;
    },
    sleeps,
  };
};

describe("createRateLimiter", () => {
  it("lets up to capacity acquires through without waiting", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ capacity: 2, refillEveryMs: 1000, ...clock });
    await limiter.acquire();
    await limiter.acquire();
    expect(clock.sleeps).toEqual([]);
  });

  it("makes the third acquire wait until the window refills", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ capacity: 2, refillEveryMs: 1000, ...clock });
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(clock.sleeps).toEqual([1000]);
    expect(clock.now()).toBe(1000);
  });

  it("waits only for the remainder of the window", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ capacity: 1, refillEveryMs: 1000, ...clock });
    await limiter.acquire();
    clock.advance(400);
    await limiter.acquire();
    expect(clock.sleeps).toEqual([600]);
  });

  it("refills to full without sleeping once the window has passed", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ capacity: 2, refillEveryMs: 1000, ...clock });
    await limiter.acquire();
    await limiter.acquire();
    clock.advance(1000);
    await limiter.acquire();
    await limiter.acquire();
    expect(clock.sleeps).toEqual([]);
  });

  it("never lets more than capacity through per window under concurrency", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ capacity: 2, refillEveryMs: 1000, ...clock });
    const grantedAt: number[] = [];
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        await limiter.acquire();
        grantedAt.push(clock.now());
      }),
    );
    const perWindow = (start: number) =>
      grantedAt.filter((t) => t >= start && t < start + 1000).length;
    expect(perWindow(0)).toBeLessThanOrEqual(2);
    expect(perWindow(1000)).toBeLessThanOrEqual(2);
    expect(grantedAt).toHaveLength(5);
  });

  it("rejects a non-positive capacity or window", () => {
    expect(() => createRateLimiter({ capacity: 0, refillEveryMs: 1000 })).toThrow(RangeError);
    expect(() => createRateLimiter({ capacity: 1, refillEveryMs: 0 })).toThrow(RangeError);
  });
});
