// One GET against a same-origin JSON route, with every failure mapped to a kind the UI can explain.

export type FetchFailure = "not_found" | "unavailable" | "busy" | "failed";

export type LoadResult<T> =
  | { ok: true; body: T; dataDate: string | null }
  | { ok: false; kind: FetchFailure; retryAfterSeconds: number | null };

const failure = (
  kind: FetchFailure,
  retryAfterSeconds: number | null = null,
): LoadResult<never> => ({
  ok: false,
  kind,
  retryAfterSeconds,
});

/** Whole seconds only; the routes never send the HTTP-date form. */
function retryAfter(response: Response): number | null {
  const raw = response.headers.get("retry-after")?.trim();
  return raw && /^\d+$/.test(raw) ? Number(raw) : null;
}

async function errorCode(response: Response): Promise<unknown> {
  try {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && "error" in body ? body.error : null;
  } catch {
    return null;
  }
}

export async function loadResource<T>(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LoadResult<T>> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch {
    return failure("failed");
  }
  if (response.ok) {
    try {
      const body = (await response.json()) as T;
      return { ok: true, body, dataDate: response.headers.get("x-data-trade-date") };
    } catch {
      return failure("failed");
    }
  }
  if (response.status === 404) return failure("not_found");
  if (response.status === 503) {
    const kind = (await errorCode(response)) === "busy" ? "busy" : "unavailable";
    return failure(kind, retryAfter(response));
  }
  return failure("failed");
}
