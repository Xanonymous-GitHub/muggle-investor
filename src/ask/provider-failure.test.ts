import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import {
  baseUrlHint,
  describeEndpoint,
  describeProviderFailure,
  summarizeProviderFailure,
} from "./provider-failure";

const CHALLENGE_PAGE =
  "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>SENTINEL_BODY</body></html>";

const apiError = (over: Partial<ConstructorParameters<typeof APICallError>[0]> = {}) =>
  new APICallError({
    message: "SENTINEL_MESSAGE",
    url: "https://user:SENTINEL_PASS@llm.example.com/chat/completions?key=SENTINEL_QUERY",
    requestBodyValues: { prompt: "SENTINEL_PROMPT" },
    isRetryable: false,
    ...over,
  });

describe("describeEndpoint", () => {
  it("keeps origin and path only", () => {
    expect(describeEndpoint("https://user:pw@llm.example.com/v1/chat?key=1#x")).toBe(
      "https://llm.example.com/v1/chat",
    );
  });

  it("returns undefined for a non-URL", () => {
    expect(describeEndpoint("not a url")).toBeUndefined();
  });
});

describe("baseUrlHint", () => {
  it("flags a base URL with no path", () => {
    expect(baseUrlHint("https://llm.example.com")).toContain("/v1");
    expect(baseUrlHint("https://llm.example.com/")).toContain("/v1");
  });

  it("is quiet when there is a path", () => {
    expect(baseUrlHint("https://llm.example.com/v1")).toBeUndefined();
  });
});

describe("describeProviderFailure", () => {
  it("recognises an HTML challenge page by its media type and title", () => {
    const failure = describeProviderFailure(
      apiError({
        statusCode: 403,
        responseBody: CHALLENGE_PAGE,
        responseHeaders: { "content-type": "text/html; charset=UTF-8", server: "cloudflare" },
      }),
    );
    expect(failure).toMatchObject({
      endpoint: "https://llm.example.com/chat/completions",
      contentType: "text/html",
      server: "cloudflare",
      htmlTitle: "Just a moment...",
      bodyBytes: CHALLENGE_PAGE.length,
    });
    expect(failure.hint).toContain("/v1");
  });

  it("detects HTML from the body when the media type is missing", () => {
    const failure = describeProviderFailure(
      apiError({ statusCode: 403, responseBody: CHALLENGE_PAGE }),
    );
    expect(failure.htmlTitle).toBe("Just a moment...");
  });

  it("reads code-shaped fields of a JSON error and ignores free text", () => {
    const failure = describeProviderFailure(
      apiError({
        statusCode: 401,
        responseBody: JSON.stringify({
          error: { message: "SENTINEL_MESSAGE", type: "invalid_request_error", code: "has spaces" },
        }),
        responseHeaders: { "content-type": "application/json" },
      }),
    );
    expect(failure.errorType).toBe("invalid_request_error");
    expect(failure.errorCode).toBeUndefined();
    expect(failure.hint).toContain("API key");
  });

  it("never carries the provider message, body text, request values or URL secrets", () => {
    const failure = describeProviderFailure(
      apiError({ statusCode: 500, responseBody: CHALLENGE_PAGE.replace("moment...", "moment") }),
    );
    expect(JSON.stringify(failure)).not.toMatch(/SENTINEL/);
  });

  it("is empty for an error that is not an HTTP failure", () => {
    expect(describeProviderFailure(new TypeError("fetch failed"))).toEqual({});
  });
});

describe("summarizeProviderFailure", () => {
  it("keeps endpoint, media type and hint only", () => {
    const failure = describeProviderFailure(
      apiError({
        statusCode: 403,
        responseBody: CHALLENGE_PAGE,
        responseHeaders: { "content-type": "text/html", server: "cloudflare", "cf-ray": "abc" },
      }),
    );
    expect(Object.keys(summarizeProviderFailure(failure)).sort()).toEqual([
      "contentType",
      "endpoint",
      "hint",
    ]);
  });
});
