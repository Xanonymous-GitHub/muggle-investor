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

  it("grants exactly capacity per window under concurrency", async () => {
    // Scheduler clock: sleep registers a waiter; the driver advances time to the earliest wake.
    let time = 0;
    const waiters: Array<{ wake: number; resolve: () => void }> = [];
    const limiter = createRateLimiter({
      capacity: 2,
      refillEveryMs: 1000,
      now: () => time,
      sleep: (ms) => new Promise<void>((resolve) => waiters.push({ wake: time + ms, resolve })),
    });

    const grantedAt: number[] = [];
    let finished = false;
    const callers = Promise.all(
      Array.from({ length: 5 }, () => limiter.acquire().then(() => grantedAt.push(time))),
    ).then(() => {
      finished = true;
    });

    const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    while (!finished) {
      await flush();
      if (finished) break;
      const next = Math.min(...waiters.map((w) => w.wake));
      expect(next).toBeLessThan(Number.POSITIVE_INFINITY); // a stuck limiter fails, not hangs
      time = Math.max(time, next);
      const due = waiters.filter((w) => w.wake <= time);
      for (const w of due) waiters.splice(waiters.indexOf(w), 1);
      for (const w of due) w.resolve();
    }
    await callers;

    expect(grantedAt).toEqual([0, 0, 1000, 1000, 2000]);
  });

  it("rejects a non-positive capacity or window", () => {
    expect(() => createRateLimiter({ capacity: 0, refillEveryMs: 1000 })).toThrow(RangeError);
    expect(() => createRateLimiter({ capacity: 1, refillEveryMs: 0 })).toThrow(RangeError);
  });
});
