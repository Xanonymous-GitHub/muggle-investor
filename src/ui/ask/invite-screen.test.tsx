import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InviteScreen } from "@/ui/ask/invite-screen";
import { postInvite } from "@/ui/data/ask-auth";

vi.mock("@/ui/data/ask-auth", () => ({ postInvite: vi.fn() }));
const post = vi.mocked(postInvite);

afterEach(() => {
  post.mockReset();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

const input = () => screen.getByLabelText("邀請碼") as HTMLInputElement;
const enter = () => screen.getByRole("button", { name: "進入" }) as HTMLButtonElement;

describe("InviteScreen", () => {
  it("has one labelled input with no autofill or capitalisation, and a disabled button while empty", () => {
    render(<InviteScreen onSignedIn={() => {}} />);
    expect(input().getAttribute("autocomplete")).toBe("off");
    expect(input().getAttribute("autocapitalize")).toBe("none");
    expect(input().type).not.toBe("password");
    expect(enter().disabled).toBe(true);
    expect(enter().className).toContain("min-h-11");
  });

  it("enables the button once something is typed", async () => {
    render(<InviteScreen onSignedIn={() => {}} />);
    await userEvent.type(input(), "a");
    expect(enter().disabled).toBe(false);
  });

  it("shows 邀請碼不正確 for a wrong code and keeps focus on the input", async () => {
    post.mockResolvedValue("invalid");
    const onSignedIn = vi.fn();
    render(<InviteScreen onSignedIn={onSignedIn} />);
    await userEvent.type(input(), "wrong");
    await userEvent.click(enter());
    expect((await screen.findByRole("alert")).textContent).toBe("邀請碼不正確");
    await waitFor(() => expect(document.activeElement).toBe(input()));
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("shows the throttle text on 429", async () => {
    post.mockResolvedValue("throttled");
    render(<InviteScreen onSignedIn={() => {}} />);
    await userEvent.type(input(), "x");
    await userEvent.click(enter());
    expect((await screen.findByRole("alert")).textContent).toBe("試太多次了，請稍後再試");
  });

  it("shows the connection text on an error", async () => {
    post.mockResolvedValue("error");
    render(<InviteScreen onSignedIn={() => {}} />);
    await userEvent.type(input(), "x");
    await userEvent.click(enter());
    expect((await screen.findByRole("alert")).textContent).toBe("連不上伺服器，請稍後再試");
  });

  it("sends the request once when the form is submitted twice before it re-renders", async () => {
    let finish: (value: "ok") => void = () => {};
    post.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const onSignedIn = vi.fn();
    render(<InviteScreen onSignedIn={onSignedIn} />);
    await userEvent.type(input(), "good-code");
    // Two synchronous submits: the busy ref, not the disabled button, has to stop the second.
    const form = input().closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(post).toHaveBeenCalledTimes(1);
    expect(enter().disabled).toBe(true);
    finish("ok");
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("good-code", expect.anything());
  });

  it("trims the code before sending it", async () => {
    post.mockResolvedValue("ok");
    const onSignedIn = vi.fn();
    render(<InviteScreen onSignedIn={onSignedIn} />);
    await userEvent.type(input(), "  good-code \t");
    await userEvent.click(enter());
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith("good-code", expect.anything());
  });

  it("keeps the button disabled while only whitespace is typed", async () => {
    render(<InviteScreen onSignedIn={() => {}} />);
    await userEvent.type(input(), "   ");
    expect(enter().disabled).toBe(true);
    fireEvent.submit(input().closest("form") as HTMLFormElement);
    expect(post).not.toHaveBeenCalled();
  });

  it("submits with Enter", async () => {
    post.mockResolvedValue("ok");
    const onSignedIn = vi.fn();
    render(<InviteScreen onSignedIn={onSignedIn} />);
    await userEvent.type(input(), "code{Enter}");
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
  });

  it("clears an old error when the person types again", async () => {
    post.mockResolvedValue("invalid");
    render(<InviteScreen onSignedIn={() => {}} />);
    await userEvent.type(input(), "x");
    await userEvent.click(enter());
    await screen.findByRole("alert");
    await userEvent.type(input(), "y");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("never stores the code on the device", async () => {
    post.mockResolvedValue("ok");
    render(<InviteScreen onSignedIn={() => {}} />);
    await userEvent.type(input(), "very-secret-code");
    await userEvent.click(enter());
    await waitFor(() => expect(post).toHaveBeenCalled());
    for (const store of [window.localStorage, window.sessionStorage]) {
      expect(JSON.stringify({ ...store })).not.toContain("very-secret-code");
    }
  });
});
