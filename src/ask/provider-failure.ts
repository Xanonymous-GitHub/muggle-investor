// What can be logged about a failed model call without logging anything the request put in it.
// A provider's message and body can quote the prompt, so neither is logged; what is kept is the
// endpoint (from our own config), the media type, the <title> of an HTML error page, short
// code-shaped fields of a JSON error, and fixed hint sentences of ours.
import { APICallError } from "ai";
import { SAFE_CODE } from "./safe-code";

const MAX_TITLE_CHARS = 80;
const MAX_HEADER_CHARS = 64;

/** The endpoint as `origin + path`: no credentials, query or fragment. */
export function describeEndpoint(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

/** A hint when `LLM_BASE_URL` looks like a website rather than an API root. */
export function baseUrlHint(raw: string): string | undefined {
  try {
    const { pathname } = new URL(raw);
    return pathname === "/" || pathname === ""
      ? "LLM_BASE_URL has no path; OpenAI-compatible APIs usually live under /v1"
      : undefined;
  } catch {
    return undefined;
  }
}

function header(headers: Record<string, string> | undefined, name: string): string | undefined {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()];
  return value === undefined ? undefined : value.slice(0, MAX_HEADER_CHARS);
}

function htmlTitle(body: string): string | undefined {
  const match = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(body);
  const title = match?.[1]?.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
  return title || undefined;
}

/** `error.code` and `error.type` of an OpenAI-style JSON error, only when code-shaped. */
function jsonErrorFields(body: string): { errorCode?: string; errorType?: string } {
  try {
    const parsed: unknown = JSON.parse(body);
    const error = (parsed as { error?: unknown } | null)?.error;
    const pick = (key: "code" | "type") => {
      const value = (error as Record<string, unknown> | null | undefined)?.[key];
      return typeof value === "string" && SAFE_CODE.test(value) ? value : undefined;
    };
    const errorCode = pick("code");
    const errorType = pick("type");
    return { ...(errorCode && { errorCode }), ...(errorType && { errorType }) };
  } catch {
    return {};
  }
}

/** A fixed sentence for the failures that have a usual cause; never built from the response. */
function hintFor(statusCode: number | undefined, isHtml: boolean): string | undefined {
  if (isHtml) {
    return "the endpoint answered with a web page, not an API reply (a CDN challenge or a site's error page); check the path of LLM_BASE_URL, which usually ends in /v1";
  }
  switch (statusCode) {
    case 401:
      return "the endpoint rejected the API key";
    case 403:
      return "the endpoint refused the request (the key may lack access to the model, or the network is blocked)";
    case 404:
      return "no such path or model at the endpoint; check LLM_BASE_URL (usually ends in /v1) and LLM_MODEL";
    case 429:
      return "the endpoint rate-limited or ran out of quota";
    default:
      return undefined;
  }
}

export type ProviderFailure = {
  endpoint?: string;
  contentType?: string;
  /** Debug detail: the `server` and `cf-ray` headers, an HTML page's title, a JSON error's codes. */
  server?: string;
  cfRay?: string;
  htmlTitle?: string;
  errorCode?: string;
  errorType?: string;
  bodyBytes?: number;
  hint?: string;
};

/** The loggable facts about a failed call; empty for anything that is not an HTTP-level failure. */
export function describeProviderFailure(error: unknown): ProviderFailure {
  if (!APICallError.isInstance(error)) return {};
  const body = error.responseBody ?? "";
  const contentType = header(error.responseHeaders, "content-type")?.split(";")[0]?.trim();
  const isHtml = contentType === "text/html" || /^\s*<(?:!doctype|html)/i.test(body);
  const endpoint = describeEndpoint(error.url);
  const server = header(error.responseHeaders, "server");
  const cfRay = header(error.responseHeaders, "cf-ray");
  const title = isHtml ? htmlTitle(body) : undefined;
  const hint = hintFor(error.statusCode, isHtml);
  return {
    ...(endpoint && { endpoint }),
    ...(contentType && { contentType }),
    ...(server && { server }),
    ...(cfRay && { cfRay }),
    ...(title && { htmlTitle: title }),
    ...(!isHtml && jsonErrorFields(body)),
    ...(body.length > 0 && { bodyBytes: body.length }),
    ...(hint && { hint }),
  };
}

/** The part of the failure worth a warning even at the default level: where, what kind, why. */
export function summarizeProviderFailure(
  failure: ProviderFailure,
): Pick<ProviderFailure, "endpoint" | "contentType" | "hint"> {
  const { endpoint, contentType, hint } = failure;
  return {
    ...(endpoint && { endpoint }),
    ...(contentType && { contentType }),
    ...(hint && { hint }),
  };
}
