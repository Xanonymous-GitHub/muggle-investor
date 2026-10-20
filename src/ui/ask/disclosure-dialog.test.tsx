import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DisclosureDialog } from "./disclosure-dialog";

describe("DisclosureDialog", () => {
  it("renders nothing while closed", () => {
    render(<DisclosureDialog open={false} onAgree={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("states what is sent and that the server keeps nothing", () => {
    render(<DisclosureDialog open onAgree={() => {}} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain(
      "你的問題、（若開啟）規劃答案、持股與記住的事會送到伺服器和 AI 模型服務；伺服器不保存對話。AI 的回答是觀點，不是保證。",
    );
  });

  it("agrees with 我知道了", async () => {
    const onAgree = vi.fn();
    const onClose = vi.fn();
    render(<DisclosureDialog open onAgree={onAgree} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "我知道了" }));
    expect(onAgree).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes with the cancel button or Escape without agreeing", async () => {
    const onAgree = vi.fn();
    const onClose = vi.fn();
    render(<DisclosureDialog open onAgree={onAgree} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "先不要" }));
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onAgree).not.toHaveBeenCalled();
  });
});
