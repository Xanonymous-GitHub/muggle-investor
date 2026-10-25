import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RememberCard } from "./remember-card";

const base = {
  replaceOf: () => undefined,
  isFull: () => false,
  onAccept: () => {},
  onDismiss: () => {},
};

describe("RememberCard", () => {
  it("asks with the fact in quotes and offers 記住, 修改 and 不用", () => {
    render(<RememberCard {...base} fact="我每月定期定額一萬元" />);
    expect(screen.getByText("要記住嗎？『我每月定期定額一萬元』")).toBeTruthy();
    expect(screen.getByRole("button", { name: "記住" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "修改" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "不用" })).toBeTruthy();
  });

  it("renders the fact as plain text, never as Markdown or HTML", () => {
    const fact = "**粗體** [點](https://evil.example) <b>b</b> ![x](https://evil.example/i.png)";
    const { container } = render(<RememberCard {...base} fact={fact} />);
    expect(container.querySelector("strong, a, b, img")).toBeNull();
    expect(container.textContent).toContain(`『${fact}』`);
  });

  it("calls only the matching callback, and saves the fact as shown", async () => {
    const onAccept = vi.fn();
    const onDismiss = vi.fn();
    render(<RememberCard {...base} fact="事" onAccept={onAccept} onDismiss={onDismiss} />);
    expect(onAccept).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "不用" }));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onAccept).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "記住" }));
    expect(onAccept).toHaveBeenCalledExactlyOnceWith("事");
  });

  it("lets the person correct the wording, and saves exactly the corrected line", async () => {
    const onAccept = vi.fn();
    render(<RememberCard {...base} fact="我想五年後買房" onAccept={onAccept} />);
    await userEvent.click(screen.getByRole("button", { name: "修改" }));
    const box = screen.getByRole("textbox", { name: "修改要記住的內容" });
    await userEvent.clear(box);
    await userEvent.type(box, "我想三年後  買房");
    expect(onAccept).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "記住" }));
    expect(onAccept).toHaveBeenCalledExactlyOnceWith("我想三年後 買房");
  });

  it("cannot save an emptied note", async () => {
    const onAccept = vi.fn();
    render(<RememberCard {...base} fact="事" onAccept={onAccept} />);
    await userEvent.click(screen.getByRole("button", { name: "修改" }));
    await userEvent.clear(screen.getByRole("textbox"));
    expect(screen.getByText("請先輸入內容")).toBeTruthy();
    const accept = screen.getByRole("button", { name: "記住" }) as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    await userEvent.click(accept);
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("with a full list explains and offers no accept button", async () => {
    const onDismiss = vi.fn();
    render(<RememberCard {...base} fact="事" isFull={() => true} onDismiss={onDismiss} />);
    expect(screen.getByText("記住的事已滿，先到我的資料刪掉一則")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "記住" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "不用" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("refuses a fact over 200 characters, and accepts it again once shortened", async () => {
    render(<RememberCard {...base} fact={"字".repeat(201)} />);
    expect(screen.getByText("這則內容太長，無法記住")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "記住" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "修改" }));
    const box = screen.getByRole("textbox");
    await userEvent.clear(box);
    await userEvent.type(box, "短一點");
    expect(screen.getByRole("button", { name: "記住" })).toBeTruthy();
  });

  it("says which saved note accepting would replace, for the text as it stands", async () => {
    render(
      <RememberCard
        {...base}
        fact="我想存退休金，十五年後用"
        replaceOf={(note) => (note.includes("退休金") ? "我想存退休金，二十年後用" : undefined)}
      />,
    );
    expect(screen.getByText("這會取代舊的一則：『我想存退休金，二十年後用』")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "修改" }));
    const box = screen.getByRole("textbox");
    await userEvent.clear(box);
    await userEvent.type(box, "我想買車");
    expect(screen.queryByText(/這會取代/)).toBeNull();
  });

  it("says nothing about replacing when there is nothing to replace", () => {
    render(<RememberCard {...base} fact="事" />);
    expect(screen.queryByText(/這會取代/)).toBeNull();
  });
});
