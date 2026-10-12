import { describe, expect, it } from "vitest";
import { extractJsonObject } from "./json-extract";
import { LlmOutputError } from "./llm";

describe("extractJsonObject", () => {
  it("parses plain JSON", () => {
    expect(extractJsonObject('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
  });

  it("parses a fenced ```json block", () => {
    const text = '這是結果：\n```json\n{\n  "title": "台積電"\n}\n```\n';
    expect(extractJsonObject(text)).toEqual({ title: "台積電" });
  });

  it("ignores trailing prose after the object", () => {
    expect(extractJsonObject('{"ok":true}\n以上是結果')).toEqual({ ok: true });
  });

  it("handles nested braces and braces inside strings", () => {
    const text = 'prefix {"outer":{"inner":[1,{"x":2}]},"s":"a } b { \\" c"} suffix';
    expect(extractJsonObject(text)).toEqual({ outer: { inner: [1, { x: 2 }] }, s: 'a } b { " c' });
  });

  it("returns the first of two objects", () => {
    expect(extractJsonObject('{"n":1}\n{"n":2}')).toEqual({ n: 1 });
  });

  it("throws LlmOutputError when there is no JSON object", () => {
    expect(() => extractJsonObject("抱歉，我無法回答")).toThrow(LlmOutputError);
  });

  it("throws LlmOutputError on truncated JSON", () => {
    expect(() => extractJsonObject('{"a":{"b":1}')).toThrow(LlmOutputError);
  });

  it("throws LlmOutputError on balanced but invalid JSON", () => {
    expect(() => extractJsonObject("{a:1}")).toThrow(LlmOutputError);
  });
});
