import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AskScreen } from "@/ui/ask/ask-screen";
import { getAskSession, postInvite } from "@/ui/data/ask-auth";

vi.mock("@/ui/data/ask-auth", () => ({ getAskSession: vi.fn(), postInvite: vi.fn() }));
const session = vi.mocked(getAskSession);
const invite = vi.mocked(postInvite);

afterEach(() => {
  session.mockReset();
  invite.mockReset();
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

  it("shows the chat stub on signed_in", async () => {
    session.mockResolvedValue("signed_in");
    renderScreen();
    expect(await screen.findByTestId("ask-chat")).toBeTruthy();
    expect(screen.queryByLabelText("邀請碼")).toBeNull();
  });

  it("shows an error with a retry button, and retry re-checks the session", async () => {
    session.mockResolvedValueOnce("error").mockResolvedValueOnce("signed_in");
    renderScreen();
    expect((await screen.findByRole("alert")).textContent).toContain("連不上伺服器");
    await userEvent.click(screen.getByRole("button", { name: "重試" }));
    expect(await screen.findByTestId("ask-chat")).toBeTruthy();
    expect(session).toHaveBeenCalledTimes(2);
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
});
