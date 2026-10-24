// A scripted stand-in for the LLM endpoint, speaking both wire formats the app can use: the
// Responses API (`LLM_API=responses`) and chat completions (`LLM_API=chat`). It is a `fetch`
// replacement, so the real AI SDK request builders and stream parsers run; only the network is
// faked. Every request it receives is kept (parsed) for assertions about what leaves the app.
export type ProviderTurn =
  | { text: string }
  | { calls: { name: string; args: unknown; id?: string }[]; lead?: string }
  | { status: number; body: string };

export type ProviderRequest = {
  path: string;
  headers: Record<string, string>;
  // biome-ignore lint/suspicious/noExplicitAny: a request body is arbitrary JSON the tests probe
  body: any;
};

type Script = ProviderTurn[] | ((index: number, request: ProviderRequest) => ProviderTurn);

const sse = (events: unknown[], done = false): string =>
  events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") +
  (done ? "data: [DONE]\n\n" : "");

const USAGE = { input_tokens: 120, output_tokens: 30 };

function responsesStream(index: number, turn: ProviderTurn): string {
  const id = `resp_${index + 1}`;
  const created = {
    type: "response.created",
    response: { id, created_at: 1, model: "model-x" },
  };
  const completed = { type: "response.completed", response: { usage: USAGE } };
  const events: unknown[] = [created];
  if ("text" in turn) {
    const item = `msg_${index + 1}`;
    events.push({
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "message", id: item },
    });
    events.push({
      type: "response.output_text.delta",
      item_id: item,
      output_index: 0,
      delta: turn.text,
    });
    events.push({
      type: "response.output_item.done",
      output_index: 0,
      item: { type: "message", id: item },
    });
  } else if ("calls" in turn) {
    let at = 0;
    if (turn.lead) {
      const item = `msg_${index + 1}`;
      events.push({
        type: "response.output_item.added",
        output_index: at,
        item: { type: "message", id: item },
      });
      events.push({
        type: "response.output_text.delta",
        item_id: item,
        output_index: at,
        delta: turn.lead,
      });
      events.push({
        type: "response.output_item.done",
        output_index: at,
        item: { type: "message", id: item },
      });
      at += 1;
    }
    turn.calls.forEach((call, i) => {
      const item = `fc_${index + 1}_${i + 1}`;
      const callId = call.id ?? `call_${index + 1}_${i + 1}`;
      const args = JSON.stringify(call.args);
      const base = { id: item, call_id: callId, name: call.name };
      events.push({
        type: "response.output_item.added",
        output_index: at + i,
        item: { type: "function_call", ...base, arguments: "" },
      });
      events.push({
        type: "response.function_call_arguments.delta",
        item_id: item,
        output_index: at + i,
        delta: args,
      });
      events.push({
        type: "response.output_item.done",
        output_index: at + i,
        item: { type: "function_call", ...base, arguments: args, status: "completed" },
      });
    });
  }
  events.push(completed);
  return sse(events);
}

function chatStream(index: number, turn: ProviderTurn): string {
  const chunk = (delta: unknown, finish: string | null = null) => ({
    id: `chatcmpl-${index + 1}`,
    object: "chat.completion.chunk",
    created: 1,
    model: "model-x",
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
  const usage = {
    id: `chatcmpl-${index + 1}`,
    object: "chat.completion.chunk",
    created: 1,
    model: "model-x",
    choices: [],
    usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
  };
  const events: unknown[] = [];
  if ("text" in turn) {
    events.push(chunk({ role: "assistant", content: turn.text }));
    events.push(chunk({}, "stop"));
  } else if ("calls" in turn) {
    if (turn.lead) events.push(chunk({ role: "assistant", content: turn.lead }));
    events.push(
      chunk({
        role: "assistant",
        tool_calls: turn.calls.map((call, i) => ({
          index: i,
          id: call.id ?? `call_${index + 1}_${i + 1}`,
          type: "function",
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        })),
      }),
    );
    events.push(chunk({}, "tool_calls"));
  }
  events.push(usage);
  return sse(events, true);
}

/** `api` picks the wire format; `script` gives the n-th request's reply (0-based). */
export function fakeProvider(api: "responses" | "chat", script: Script) {
  const requests: ProviderRequest[] = [];
  const fetch = async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const request: ProviderRequest = { path: url.pathname, headers, body };
    const index = requests.length;
    requests.push(request);
    const turn = typeof script === "function" ? script(index, request) : script[index];
    if (!turn) return new Response("script exhausted", { status: 500 });
    if ("status" in turn) {
      return new Response(turn.body, {
        status: turn.status,
        headers: { "content-type": "application/json" },
      });
    }
    const text = api === "responses" ? responsesStream(index, turn) : chatStream(index, turn);
    return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}
