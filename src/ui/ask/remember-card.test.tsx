import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RememberCard } from "./remember-card";

describe("RememberCard", () => {
  it("asks with the fact in quotes and offers 記住 and 不用", () => {
    render(<RememberCard fact="我每月定期定額一萬元" onAccept={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText("要記住嗎？『我每月定期定額一萬元』")).toBeTruthy();
    expect(screen.getByRole("button", { name: "記住" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "不用" })).toBeTruthy();
  });

  it("renders the fact as plain text, never as Markdown or HTML", () => {
    const fact = "**粗體** [點](https://evil.example) <b>b</b> ![x](https://evil.example/i.png)";
    const { container } = render(
      <RememberCard fact={fact} onAccept={() => {}} onDismiss={() => {}} />,
    );
    expect(container.querySelector("strong, a, b, img")).toBeNull();
    expect(container.textContent).toContain(`『${fact}』`);
  });

  it("calls only the matching callback", async () => {
    const onAccept = vi.fn();
    const onDismiss = vi.fn();
    render(<RememberCard fact="事" onAccept={onAccept} onDismiss={onDismiss} />);
    expect(onAccept).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "不用" }));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onAccept).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "記住" }));
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("with a full list explains and offers no accept button", async () => {
    const onDismiss = vi.fn();
    render(<RememberCard fact="事" full onAccept={() => {}} onDismiss={onDismiss} />);
    expect(screen.getByText("記住的事已滿，先到我的資料刪掉一則")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "記住" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "不用" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("refuses a fact over 200 characters", () => {
    render(<RememberCard fact={"字".repeat(201)} onAccept={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText("這則內容太長，無法記住")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "記住" })).toBeNull();
  });

  it("says which saved note accepting would replace", () => {
    render(
      <RememberCard
        fact="我想存退休金，十五年後用"
        replaces="我想存退休金，二十年後用"
        onAccept={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText("這會取代舊的一則：『我想存退休金，二十年後用』")).toBeTruthy();
    expect(screen.getByRole("button", { name: "記住" })).toBeTruthy();
  });

  it("says nothing about replacing when there is nothing to replace", () => {
    render(<RememberCard fact="事" onAccept={() => {}} onDismiss={() => {}} />);
    expect(screen.queryByText(/這會取代/)).toBeNull();
  });
});
