import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AskScreen } from "@/ui/ask/ask-screen";
import { getAskSession, postInvite } from "@/ui/data/ask-auth";

// The chat has its own tests; here it only has to appear and be able to hand back to the gate.
vi.mock("@/ui/ask/ask-chat", () => ({
  AskChat: ({
    onSignedOut,
    initialDraft,
  }: {
    onSignedOut(question?: string): void;
    initialDraft?: string;
  }) => (
    <button type="button" data-testid="ask-chat" onClick={() => onSignedOut("沒問完的問題")}>
      {initialDraft === undefined ? "chat" : `draft:${initialDraft}`}
    </button>
  ),
}));
vi.mock("@/ui/data/ask-auth", () => ({ getAskSession: vi.fn(), postInvite: vi.fn() }));
const session = vi.mocked(getAskSession);
const invite = vi.mocked(postInvite);

afterEach(() => {
  session.mockReset();
  invite.mockReset();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

const renderScreen = () => render(<AskScreen />);

describe("AskScreen", () => {
  it("shows a loading skeleton while the session is checked", () => {
    session.mockReturnValue(new Promise(() => {}));
    renderScreen();
    expect(screen.getByRole("status").textContent).toContain("載入中");
    expect(screen.queryByLabelText("邀請碼")).toBeNull();
  });

  it("shows the invite screen on signed_out", async () => {
    session.mockResolvedValue("signed_out");
    renderScreen();
    expect(await screen.findByLabelText("邀請碼")).toBeTruthy();
  });

  it("shows the chat on signed_in", async () => {
    session.mockResolvedValue("signed_in");
    renderScreen();
    expect(await screen.findByTestId("ask-chat")).toBeTruthy();
    expect(screen.queryByLabelText("邀請碼")).toBeNull();
  });

  it("returns to the invite screen when the chat reports a signed-out session", async () => {
    session.mockResolvedValue("signed_in");
    renderScreen();
    await userEvent.click(await screen.findByTestId("ask-chat"));
    expect(await screen.findByLabelText("邀請碼")).toBeTruthy();
    expect(screen.queryByTestId("ask-chat")).toBeNull();
  });

  it("shows an error with a retry button, and retry re-checks the session", async () => {
    session.mockResolvedValueOnce("error").mockResolvedValueOnce("signed_in");
    renderScreen();
    expect((await screen.findByRole("alert")).textContent).toContain("連不上伺服器");
    await userEvent.click(screen.getByRole("button", { name: "重試" }));
    expect(await screen.findByTestId("ask-chat")).toBeTruthy();
    expect(session).toHaveBeenCalledTimes(2);
  });

  it("opened offline, shows the saved chat instead of a server error", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    session.mockResolvedValue("error");
    renderScreen();
    expect(await screen.findByTestId("ask-chat")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("gives the question left by a sign-out back to the chat after signing in again", async () => {
    session.mockResolvedValue("signed_in");
    invite.mockResolvedValue("ok");
    renderScreen();
    expect((await screen.findByTestId("ask-chat")).textContent).toBe("chat");
    await userEvent.click(screen.getByTestId("ask-chat"));
    await userEvent.type(await screen.findByLabelText("邀請碼"), "good");
    await userEvent.click(screen.getByRole("button", { name: "進入" }));
    expect((await screen.findByTestId("ask-chat")).textContent).toBe("draft:沒問完的問題");
  });

  it("moves from the invite screen to the chat after a good code", async () => {
    session.mockResolvedValue("signed_out");
    invite.mockResolvedValue("ok");
    renderScreen();
    await userEvent.type(await screen.findByLabelText("邀請碼"), "good");
    await userEvent.click(screen.getByRole("button", { name: "進入" }));
    expect(await screen.findByTestId("ask-chat")).toBeTruthy();
    // The session was checked once; success is trusted, not re-fetched.
    expect(session).toHaveBeenCalledTimes(1);
  });

  it("aborts the session check on unmount and swallows the AbortError", async () => {
    let signal: AbortSignal | undefined;
    session.mockImplementation(
      (given) =>
        new Promise((_resolve, reject) => {
          signal = given;
          given?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const view = renderScreen();
      expect(signal?.aborted).toBe(false);
      view.unmount();
      expect(signal?.aborted).toBe(true);
      // Let the rejection settle: nothing may be thrown, logged or left unhandled.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await waitFor(() => expect(errors).not.toHaveBeenCalled());
      expect(unhandled).not.toHaveBeenCalled();
      expect(document.body.textContent).toBe("");
    } finally {
      process.off("unhandledRejection", unhandled);
      errors.mockRestore();
    }
  });

  it("aborts the previous check when retry starts a new one", async () => {
    const signals: AbortSignal[] = [];
    session.mockImplementation((given) => {
      if (given) signals.push(given);
      return signals.length === 1 ? Promise.resolve("error") : new Promise(() => {});
    });
    renderScreen();
    await userEvent.click(await screen.findByRole("button", { name: "重試" }));
    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
  });
});
