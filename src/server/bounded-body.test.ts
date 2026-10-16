import { describe, expect, it } from "vitest";
import { readBoundedText } from "./bounded-body";

const encoder = new TextEncoder();

/** A POST whose body is streamed in the given chunks, with no content-length unless given. */
function streamed(chunks: string[], headers: Record<string, string> = {}): Request {
  return new Request("http://x/", {
    method: "POST",
    headers,
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    // Required by Node's fetch for a streamed request body.
    duplex: "half",
  } as RequestInit);
}

describe("readBoundedText", () => {
  it("returns the text of a body under the cap", async () => {
    const request = new Request("http://x/", { method: "POST", body: '{"a":1}' });
    expect(await readBoundedText(request, 100)).toBe('{"a":1}');
  });

  it("returns the text of a body exactly at the cap", async () => {
    const request = new Request("http://x/", { method: "POST", body: "abcde" });
    expect(await readBoundedText(request, 5)).toBe("abcde");
  });

  it("returns an empty string for an empty body", async () => {
    expect(await readBoundedText(new Request("http://x/", { method: "POST" }), 10)).toBe("");
  });

  it("returns null without reading when the declared length is over the cap", async () => {
    const request = new Request("http://x/", {
      method: "POST",
      headers: { "content-length": "11" },
      body: "tiny",
    });
    expect(await readBoundedText(request, 10)).toBeNull();
    expect(request.bodyUsed).toBe(false);
  });

  it("returns null for a non-numeric declared length", async () => {
    const request = new Request("http://x/", {
      method: "POST",
      headers: { "content-length": "lots" },
      body: "tiny",
    });
    expect(await readBoundedText(request, 10)).toBeNull();
  });

  it("returns null for a streamed body over the cap with no content-length", async () => {
    expect(await readBoundedText(streamed(["aaaaaa", "bbbbbb"]), 10)).toBeNull();
  });

  it("returns null for a streamed body over the cap behind a false content-length", async () => {
    const request = streamed(["aaaaaa", "bbbbbb"], { "content-length": "3" });
    expect(await readBoundedText(request, 10)).toBeNull();
  });

  it("joins chunks and decodes multi-byte text across them", async () => {
    const bytes = encoder.encode("股息");
    const request = new Request("http://x/", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, 2));
          controller.enqueue(bytes.slice(2));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    expect(await readBoundedText(request, 100)).toBe("股息");
  });
});
