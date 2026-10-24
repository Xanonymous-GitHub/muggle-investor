import { describe, expect, it, vi } from "vitest";
import {
  chainResponsesFetch,
  chainToPreviousResponse,
  trimToPendingOutputs,
} from "./responses-chain";

const system = { role: "system", content: "規則 A" };
const user = { role: "user", content: [{ type: "input_text", text: "問題" }] };
const call = { type: "function_call", call_id: "c1", name: "loadSkill", arguments: "{}" };
const output = { type: "function_call_output", call_id: "c1", output: "{}" };

describe("trimToPendingOutputs", () => {
  it("leaves a request without previous_response_id alone", () => {
    const body = { model: "m", input: [system, user] };
    expect(trimToPendingOutputs(body)).toBe(body);
  });

  it("keeps only the tool results after the last function call, and moves the system text to instructions", () => {
    const body = {
      model: "m",
      previous_response_id: "resp_1",
      input: [system, user, call, output],
    };
    expect(trimToPendingOutputs(body)).toEqual({
      model: "m",
      previous_response_id: "resp_1",
      instructions: "規則 A",
      input: [output],
    });
  });

  it("keeps every result of a step that made several calls", () => {
    const second = { ...call, call_id: "c2" };
    const secondOut = { ...output, call_id: "c2" };
    const body = { previous_response_id: "r", input: [user, call, second, output, secondOut] };
    expect(trimToPendingOutputs(body).input).toEqual([output, secondOut]);
  });

  it("appends the system text to instructions already set, and reads content arrays", () => {
    const developer = { role: "developer", content: [{ type: "input_text", text: "規則 B" }] };
    const body = {
      previous_response_id: "r",
      instructions: "既有",
      input: [developer, user, call, output],
    };
    expect(trimToPendingOutputs(body).instructions).toBe("既有\n\n規則 B");
  });

  it("sets no instructions when there is no system text", () => {
    const body = { previous_response_id: "r", input: [user, call, output] };
    expect("instructions" in trimToPendingOutputs(body)).toBe(false);
  });

  it("leaves a chained request with no function call alone", () => {
    const body = { previous_response_id: "r", input: [user] };
    expect(trimToPendingOutputs(body)).toBe(body);
  });
});

describe("chainResponsesFetch", () => {
  const run = async (body: unknown) => {
    const base = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response("{}"));
    await chainResponsesFetch(base as unknown as typeof fetch)("https://x.test/responses", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    return base.mock.calls[0]?.[1]?.body;
  };

  it("sends the trimmed body of a chained request", async () => {
    const sent = await run({ previous_response_id: "r", input: [system, call, output] });
    expect(JSON.parse(sent as string)).toEqual({
      previous_response_id: "r",
      instructions: "規則 A",
      input: [output],
    });
  });

  it("passes any other body through untouched", async () => {
    const plain = JSON.stringify({ input: [system, user] });
    expect(await run(plain)).toBe(plain);
    expect(await run("not json")).toBe("not json");
  });
});

describe("chainToPreviousResponse", () => {
  it("chains to the last step's response id", () => {
    const steps = [
      { providerMetadata: { openai: { responseId: "resp_1" } } },
      { providerMetadata: { openai: { responseId: "resp_2" } } },
    ];
    expect(chainToPreviousResponse({ steps })).toEqual({
      providerOptions: { openai: { previousResponseId: "resp_2" } },
    });
  });

  it("does nothing on the first step or for a model that reports no response id", () => {
    expect(chainToPreviousResponse({ steps: [] })).toEqual({});
    expect(chainToPreviousResponse({ steps: [{}] })).toEqual({});
  });
});
