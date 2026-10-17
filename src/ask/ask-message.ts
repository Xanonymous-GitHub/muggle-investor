// Wire types of the POST /api/ask response stream (AI SDK UI message stream). Type-only and free
// of server imports, so the chat screen can share them.
import type { UIMessage } from "ai";

/**
 * Why the answer had fewer tools than usual. `no_web`: no external (web, MCP) tools this turn;
 * `tool_failed`: some external tool servers could not be reached; `no_tools`: the endpoint
 * rejects tool calls, so the answer uses no tools at all.
 */
export type AskNotice = { kind: "no_web" | "no_tools" | "tool_failed"; text: string };

/**
 * The number check, sent as the last data part. `checked: false` means the check could not run,
 * so an empty `unsupported` list then says nothing about the numbers.
 */
export type AskVerification = { unsupported: string[]; checked: boolean };

export type AskDataParts = { notice: AskNotice; verification: AskVerification };

export type AskUIMessage = UIMessage<never, AskDataParts>;
