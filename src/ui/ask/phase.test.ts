import { describe, expect, it } from "vitest";
import { countTools, evidenceStatusOf, isComplete, isIncomplete, phaseOf } from "./phase";
import { makeRecord, makeTurn, makeVerification } from "./turn-fixture";

describe("phaseOf", () => {
  it.each([
    ["no text yet", { streaming: true, text: "" }, "waiting"],
    ["text arriving", { streaming: true, text: "答" }, "generating"],
    [
      "a call running",
      { streaming: true, text: "", tools: [{ callId: "c", name: "a", state: "running" as const }] },
      "tools",
    ],
    [
      "calls done and text arriving",
      {
        streaming: true,
        text: "答",
        tools: [{ callId: "c", name: "a", state: "failed" as const }],
      },
      "generating",
    ],
    ["a plain finish", {}, "complete"],
    ["a broken answer", { failed: true }, "failed"],
    ["a stop", { stopped: true }, "stopped"],
    [
      "a timeout, even though a finish followed",
      { timedOut: true, finishReason: "stop" },
      "timeout",
    ],
    [
      "an answer held back by the output guard",
      { notices: [{ kind: "withheld" as const, text: "x" }] },
      "withheld",
    ],
    ["a restored answer with no recorded ending", { statusUnknown: true as const }, "unknown"],
  ])("%s is %s", (_name, patch, phase) => {
    expect(phaseOf(makeTurn(patch))).toBe(phase);
  });

  it("lets a failure win over a stop and a timeout", () => {
    expect(phaseOf(makeTurn({ failed: true, stopped: true, timedOut: true }))).toBe("failed");
  });
});

describe("isComplete and isIncomplete", () => {
  it("counts only a plainly finished answer with text as complete", () => {
    expect(isComplete(makeTurn())).toBe(true);
    expect(isComplete(makeTurn({ text: "" }))).toBe(false);
    for (const patch of [
      { failed: true },
      { stopped: true },
      { timedOut: true },
      { statusUnknown: true as const },
    ]) {
      expect(isComplete(makeTurn(patch))).toBe(false);
    }
  });

  it("calls an answer cut short incomplete, and an unknown one neither", () => {
    expect(isIncomplete(makeTurn({ stopped: true }))).toBe(true);
    expect(isIncomplete(makeTurn({ timedOut: true }))).toBe(true);
    expect(isIncomplete(makeTurn({ failed: true }))).toBe(true);
    expect(isIncomplete(makeTurn())).toBe(false);
    expect(isIncomplete(makeTurn({ statusUnknown: true as const }))).toBe(false);
  });
});

describe("evidenceStatusOf", () => {
  it("is pending while the answer runs and unavailable when it ended with no check", () => {
    expect(evidenceStatusOf(makeTurn({ streaming: true }))).toBe("pending");
    expect(evidenceStatusOf(makeTurn({ stopped: true }))).toBe("unavailable");
  });

  it("is unchecked when the check could not run", () => {
    expect(evidenceStatusOf(makeTurn({ verification: { unsupported: [], checked: false } }))).toBe(
      "unchecked",
    );
  });

  it("is unknown when the check ran but no source details came", () => {
    expect(evidenceStatusOf(makeTurn({ verification: { unsupported: [], checked: true } }))).toBe(
      "unknown",
    );
  });

  it("is none when no tool returned data", () => {
    const verification = makeVerification([makeRecord({ failed: true })]);
    expect(evidenceStatusOf(makeTurn({ verification }))).toBe("none");
  });

  it("is sources when tools returned current data, and partial when anything limits it", () => {
    expect(evidenceStatusOf(makeTurn({ verification: makeVerification([makeRecord()]) }))).toBe(
      "sources",
    );
    for (const records of [
      [makeRecord(), makeRecord({ id: "s2", failed: true })],
      [makeRecord({ truncated: true })],
      [makeRecord({ warnings: ["stale"] })],
      [makeRecord({ warnings: ["provisional"] })],
      [makeRecord({ warnings: ["mixed_session"] })],
    ]) {
      expect(evidenceStatusOf(makeTurn({ verification: makeVerification(records) }))).toBe(
        "partial",
      );
    }
  });

  it("is independent of how the request ended: a timeout can have sources", () => {
    const turn = makeTurn({ timedOut: true, verification: makeVerification([makeRecord()]) });
    expect(phaseOf(turn)).toBe("timeout");
    expect(evidenceStatusOf(turn)).toBe("sources");
  });
});

describe("countTools", () => {
  it("sorts the calls by how they ended and keeps the running ones", () => {
    const running = { callId: "r", name: "x", state: "running" as const };
    const counts = countTools([
      running,
      { callId: "a", name: "x", state: "succeeded" },
      { callId: "b", name: "x", state: "succeeded" },
      { callId: "c", name: "x", state: "failed" },
      { callId: "d", name: "x", state: "denied" },
    ]);
    expect(counts).toEqual({ running: [running], succeeded: 2, failed: 1, denied: 1 });
  });
});
