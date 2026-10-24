import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { fakeModel, textReply, toolCallReply } from "../../../test/helpers/ask-harness";
import { runProbe } from "./probe-run";

const apiError = (statusCode: number, body = "SECRET BODY") =>
  new APICallError({
    message: "SECRET https://llm.example/v1?key=abc",
    url: "https://llm.example/v1",
    requestBodyValues: {},
    statusCode,
    responseBody: body,
    isRetryable: false,
  });

/** Plain probe call first (call 0), then the tool cycle (calls 1, 2). */
const script = (cycle: Parameters<typeof fakeModel>[0]) =>
  fakeModel((call, options) => (call === 0 ? textReply("ok") : cycle(call - 1, options)));

describe("runProbe", () => {
  it("passes all three checks when the tool is called, run, and answered from", async () => {
    const model = script((call) =>
      call === 0 ? toolCallReply("ping", {}, "p1") : textReply("done"),
    );
    expect(await runProbe(model, 5000)).toEqual({
      streaming: { ok: true, statusClass: "2xx" },
      tools: { ok: true, statusClass: "2xx" },
      roundTrip: { ok: true, statusClass: "2xx", called: true },
    });
    // The second cycle request carried the tool result.
    const carried = JSON.stringify(model.doStreamCalls[2]?.prompt);
    expect(carried).toContain("pong");
  });

  it("does not learn anything about continuation when the model never calls the tool", async () => {
    const model = script(() => textReply("done"));
    expect(await runProbe(model, 5000)).toMatchObject({
      tools: { ok: true },
      roundTrip: { ok: false, called: false },
    });
  });

  it("fails the round trip, not the tools, when the result is refused", async () => {
    const model = script((call) => {
      if (call === 0) return toolCallReply("ping", {}, "p1");
      throw apiError(400, '{"error":{"code":"invalid_tool_continuation"}}');
    });
    expect(await runProbe(model, 5000)).toEqual({
      streaming: { ok: true, statusClass: "2xx" },
      tools: { ok: true, statusClass: "2xx" },
      roundTrip: { ok: false, statusClass: "4xx", called: true },
    });
  });

  it("fails the round trip when the continuation ends without an answer", async () => {
    const model = script((call) =>
      call === 0 ? toolCallReply("ping", {}, "p1") : textReply("   "),
    );
    expect(await runProbe(model, 5000)).toMatchObject({
      tools: { ok: true },
      roundTrip: { ok: false, called: true },
    });
  });

  it("fails the tools check when the first request with a tool is refused", async () => {
    const model = script(() => {
      throw apiError(400, "This model does not support tools");
    });
    const result = await runProbe(model, 5000);
    expect(result.streaming.ok).toBe(true);
    expect(result.tools).toEqual({ ok: false, statusClass: "4xx" });
    expect(result.roundTrip).toMatchObject({ ok: false, called: false });
  });

  it("reduces every failure to a status class: nothing else leaves", async () => {
    const model = fakeModel(() => {
      throw apiError(503);
    });
    const result = await runProbe(model, 5000);
    expect(JSON.stringify(result)).not.toMatch(/SECRET|llm\.example/);
    expect(result.streaming).toEqual({ ok: false, statusClass: "5xx" });
  });
});
