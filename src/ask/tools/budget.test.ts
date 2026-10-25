import { type ToolSet, tool } from "ai";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { canonicalJson, createBudget, terminationOf } from "./budget";

const LIMITS = { maxCalls: 10, concurrency: 4, timeoutMs: 1000, maxResultBytes: 100_000 };

const echo = (run: (input: { q: string }) => unknown) =>
  ({
    echo: tool({
      description: "echo",
      inputSchema: z.object({ q: z.string() }),
      execute: async (input: { q: string }) => run(input),
    }),
  }) satisfies ToolSet;

type Execute = (input: unknown, options: { abortSignal?: AbortSignal }) => Promise<unknown>;

const call = (tools: ToolSet, input: unknown, abortSignal?: AbortSignal) => {
  const execute = tools.echo?.execute as Execute;
  return execute(input, { abortSignal });
};

describe("canonicalJson", () => {
  it("ignores key order and undefined fields", () => {
    expect(canonicalJson({ a: 1, b: { d: 2, c: [1, { y: 1, x: 2 }] } })).toBe(
      canonicalJson({ b: { c: [1, { x: 2, y: 1 }], d: 2 }, a: 1, z: undefined }),
    );
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: "1" }));
  });
});

describe("createBudget", () => {
  it("refuses calls past the total limit with a structured result", async () => {
    const run = vi.fn(() => ({ ok: true }));
    const budget = createBudget({ ...LIMITS, maxCalls: 2 });
    const tools = budget.wrap(echo(run));
    expect(await call(tools, { q: "a" })).toEqual({ ok: true });
    expect(await call(tools, { q: "b" })).toEqual({ ok: true });
    expect(await call(tools, { q: "c" })).toEqual({ error: "tool_limit_reached", tool: "echo" });
    expect(run).toHaveBeenCalledTimes(2);
    expect(budget.stats()).toMatchObject({ executed: 2, refused: { tool_limit_reached: 1 } });
    expect(budget.firstRefusal()).toBe("tool_limit_reached");
    expect(terminationOf(budget.stats())).toBe("tool_limit");
  });

  it("shares one allowance across every plan that wraps its tools", async () => {
    const run = vi.fn(() => ({ ok: true }));
    const budget = createBudget({ ...LIMITS, maxCalls: 2 });
    const first = budget.wrap(echo(run));
    const second = budget.wrap(echo(run));
    await call(first, { q: "a" });
    await call(second, { q: "b" });
    expect(await call(first, { q: "c" })).toMatchObject({ error: "tool_limit_reached" });
    expect(await call(second, { q: "d" })).toMatchObject({ error: "tool_limit_reached" });
  });

  it("answers an identical call from the first result, then calls it a loop", async () => {
    const run = vi.fn(() => ({ n: 1 }));
    const budget = createBudget({ ...LIMITS, maxRepeats: 3 });
    const tools = budget.wrap(echo(run));
    for (let i = 0; i < 3; i++) expect(await call(tools, { q: "same" })).toEqual({ n: 1 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(budget.stats()).toMatchObject({ executed: 1, reused: 2, looping: false });
    expect(await call(tools, { q: "same" })).toEqual({ error: "repeated_call", tool: "echo" });
    expect(budget.stats().looping).toBe(true);
    expect(terminationOf(budget.stats())).toBe("loop");
    // A different argument is a new call.
    expect(await call(tools, { q: "other" })).toEqual({ n: 1 });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not count reused calls against the call limit", async () => {
    const budget = createBudget({ ...LIMITS, maxCalls: 1, maxRepeats: 10 });
    const tools = budget.wrap(echo(() => ({ ok: true })));
    for (let i = 0; i < 5; i++) expect(await call(tools, { q: "same" })).toEqual({ ok: true });
    expect(budget.stats().refused).toEqual({});
  });

  it("never runs more calls at once than the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    const budget = createBudget({ ...LIMITS, concurrency: 3, maxCalls: 50 });
    const tools = budget.wrap(
      echo(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { ok: true };
      }),
    );
    await Promise.all(Array.from({ length: 20 }, (_, i) => call(tools, { q: `q${i}` })));
    expect(peak).toBe(3);
    expect(budget.stats().executed).toBe(20);
  });

  it("abandons a tool that hangs and ignores its signal", async () => {
    const budget = createBudget({ ...LIMITS, timeoutMs: 30 });
    const tools = budget.wrap(echo(() => new Promise(() => {})));
    const started = performance.now();
    expect(await call(tools, { q: "slow" })).toEqual({ error: "tool_timeout", tool: "echo" });
    expect(performance.now() - started).toBeLessThan(500);
    expect(budget.stats().refused).toEqual({ tool_timeout: 1 });
  });

  it("ends a running call when the request is aborted, whatever the tool does", async () => {
    const controller = new AbortController();
    const budget = createBudget({ ...LIMITS, signal: controller.signal });
    const tools = budget.wrap(echo(() => new Promise(() => {})));
    const pending = call(tools, { q: "slow" });
    controller.abort();
    expect(await pending).toEqual({ error: "tool_aborted", tool: "echo" });
  });

  it("stops a call that is still waiting for a slot when the request is aborted", async () => {
    const controller = new AbortController();
    const budget = createBudget({ ...LIMITS, concurrency: 1, signal: controller.signal });
    const tools = budget.wrap(echo(() => new Promise(() => {})));
    const holder = call(tools, { q: "holds the slot" });
    const waiting = call(tools, { q: "waits" });
    controller.abort();
    expect(await waiting).toMatchObject({ error: "tool_aborted" });
    expect(await holder).toMatchObject({ error: "tool_aborted" });
  });

  it("returns a code-only error when a tool throws, never its message", async () => {
    const budget = createBudget(LIMITS);
    const tools = budget.wrap(
      echo(() => {
        throw new Error("select * from secrets");
      }),
    );
    const result = await call(tools, { q: "x" });
    expect(result).toEqual({ error: "tool_failed", tool: "echo" });
    expect(JSON.stringify(result)).not.toContain("secrets");
  });

  it("stops handing out results once the result budget is spent", async () => {
    const budget = createBudget({ ...LIMITS, maxResultBytes: 300 });
    const tools = budget.wrap(echo(() => ({ text: "x".repeat(200) })));
    await call(tools, { q: "a" });
    await call(tools, { q: "b" });
    expect(await call(tools, { q: "c" })).toEqual({
      error: "context_budget_exhausted",
      tool: "echo",
    });
    expect(terminationOf(budget.stats())).toBe("context_budget");
  });

  it("checks and counts a call in one step, so a burst cannot all pass the limit", async () => {
    const budget = createBudget({ ...LIMITS, maxCalls: 3, concurrency: 1 });
    const tools = budget.wrap(echo(async () => ({ ok: true })));
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => call(tools, { q: `q${i}` })),
    );
    expect(
      results.filter((r) => (r as { error?: string }).error === "tool_limit_reached"),
    ).toHaveLength(7);
    expect(budget.stats().executed).toBe(3);
  });

  it("reports each refusal so the evidence ledger can record it", async () => {
    const onRefusal = vi.fn();
    const budget = createBudget({ ...LIMITS, maxCalls: 1, onRefusal });
    const tools = budget.wrap(echo(() => ({ ok: true })));
    await call(tools, { q: "a" });
    await call(tools, { q: "b" });
    expect(onRefusal).toHaveBeenCalledWith("echo", "tool_limit_reached");
  });

  it("leaves tools without an execute function alone", () => {
    const budget = createBudget(LIMITS);
    const bare = { noop: { description: "x", inputSchema: z.object({}) } } as unknown as ToolSet;
    expect(budget.wrap(bare).noop).toBe(bare.noop);
  });
});
