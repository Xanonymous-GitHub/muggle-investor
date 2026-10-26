import { afterEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter, createSharedRateLimiter } from "./rate-limiter";

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

  it("tryAcquire takes a token only when one is left, never sleeping", () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ capacity: 2, refillEveryMs: 1000, ...clock });
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
    expect(limiter.tryAcquire()).toBe(false);
    clock.advance(1000);
    expect(limiter.tryAcquire()).toBe(true);
    expect(clock.sleeps).toEqual([]);
  });

  it("tryAcquire and acquire share one bucket", async () => {
    const clock = fakeClock();
    const limiter = createRateLimiter({ capacity: 2, refillEveryMs: 1000, ...clock });
    await limiter.acquire();
    expect(limiter.tryAcquire()).toBe(true);
    await limiter.acquire(); // drained: waits for the refill
    expect(clock.sleeps).toEqual([1000]);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  describe("default clock", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("is monotonic: a wall-clock jump does not refill the bucket", async () => {
      vi.spyOn(performance, "now").mockReturnValue(5_000);
      const wall = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
      const sleeps: number[] = [];
      const stop = new Error("stop");
      const limiter = createRateLimiter({
        capacity: 1,
        refillEveryMs: 60_000,
        sleep: async (ms) => {
          sleeps.push(ms);
          throw stop;
        },
      });

      await limiter.acquire();
      wall.mockReturnValue(1_000_000 + 3_600_000); // wall clock jumps an hour ahead
      expect(limiter.tryAcquire()).toBe(false);
      await expect(limiter.acquire()).rejects.toBe(stop);
      expect(sleeps).toEqual([60_000]);
    });
  });

  it("rejects a non-positive capacity or window", () => {
    expect(() => createRateLimiter({ capacity: 0, refillEveryMs: 1000 })).toThrow(RangeError);
    expect(() => createRateLimiter({ capacity: 1, refillEveryMs: 0 })).toThrow(RangeError);
  });
});

describe("createSharedRateLimiter", () => {
  it("tryAcquire is one take and never sleeps", async () => {
    const take = vi
      .fn<() => Promise<{ ok: true } | { ok: false; retryAfterMs: number }>>()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, retryAfterMs: 500 });
    const sleep = vi.fn(async () => {});
    const limiter = createSharedRateLimiter({ take, sleep });

    expect(await limiter.tryAcquire()).toBe(true);
    expect(await limiter.tryAcquire()).toBe(false);
    expect(take).toHaveBeenCalledTimes(2);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("acquire sleeps for the time it was told, then takes again", async () => {
    const take = vi
      .fn<() => Promise<{ ok: true } | { ok: false; retryAfterMs: number }>>()
      .mockResolvedValueOnce({ ok: false, retryAfterMs: 700 })
      .mockResolvedValueOnce({ ok: false, retryAfterMs: 20 })
      .mockResolvedValueOnce({ ok: true });
    const sleeps: number[] = [];
    const limiter = createSharedRateLimiter({
      take,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await limiter.acquire();
    expect(sleeps).toEqual([700, 20]);
    expect(take).toHaveBeenCalledTimes(3);
  });

  it("lets a failing take reject instead of granting a token", async () => {
    const limiter = createSharedRateLimiter({
      take: async () => {
        throw new Error("database down");
      },
    });
    await expect(limiter.acquire()).rejects.toThrow("database down");
    await expect(limiter.tryAcquire()).rejects.toThrow("database down");
  });
});
