import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./composer";

afterEach(() => {
  vi.restoreAllMocks();
});

type Harness = { onSend?: (text: string) => void; onStop?: () => void; offline?: boolean };

/** Plays the part of AskChat: owns the draft, clears it on send and flips to streaming. */
function Wrapper({ onSend, onStop, offline = false }: Harness) {
  const [value, setValue] = useState("");
  const [streaming, setStreaming] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSend={(text) => {
        onSend?.(text);
        setValue("");
        setStreaming(true);
      }}
      onStop={() => {
        onStop?.();
        setStreaming(false);
      }}
      streaming={streaming}
      offline={offline}
      inputRef={ref}
    />
  );
}

const box = () => screen.getByRole("textbox", { name: "提問" });
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });

describe("Composer", () => {
  it("labels the textarea 提問", () => {
    render(<Wrapper />);
    expect(box().tagName).toBe("TEXTAREA");
  });

  it("sends the trimmed text on Enter and clears the box", async () => {
    const onSend = vi.fn();
    render(<Wrapper onSend={onSend} />);
    type("  你好 ");
    await userEvent.type(box(), "{Enter}");
    expect(onSend).toHaveBeenCalledExactlyOnceWith("你好");
    expect((box() as HTMLTextAreaElement).value).toBe("");
  });

  it("Shift+Enter makes a new line and does not send", async () => {
    const onSend = vi.fn();
    render(<Wrapper onSend={onSend} />);
    await userEvent.type(box(), "一{Shift>}{Enter}{/Shift}二");
    expect(onSend).not.toHaveBeenCalled();
    expect((box() as HTMLTextAreaElement).value).toBe("一\n二");
  });

  it("does not send on the Enter that confirms an IME composition", () => {
    const onSend = vi.fn();
    render(<Wrapper onSend={onSend} />);
    type("ㄋㄧˇ");
    fireEvent.keyDown(box(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(box(), { key: "Enter", keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("does nothing for an empty or whitespace-only draft", async () => {
    const onSend = vi.fn();
    render(<Wrapper onSend={onSend} />);
    const send = screen.getByRole("button", { name: "送出" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    type("   \n ");
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows the remaining characters only within 200 of the limit", () => {
    render(<Wrapper />);
    type("字".repeat(3000));
    expect(screen.queryByText(/還可以輸入/)).toBeNull();
    type("字".repeat(3900));
    expect(screen.getByText("還可以輸入 100 字")).toBeTruthy();
  });

  it("blocks a draft over 4000 characters and says by how much", () => {
    const onSend = vi.fn();
    render(<Wrapper onSend={onSend} />);
    type("字".repeat(4001));
    expect(screen.getByRole("alert").textContent).toBe("超過 4000 字上限，請縮短後再送出");
    expect(screen.getByText("目前超過 1 字")).toBeTruthy();
    expect((screen.getByRole("button", { name: "送出" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    // Nothing is cut silently: no maxlength attribute that would clip a paste.
    expect(box().hasAttribute("maxlength")).toBe(false);
    type("字".repeat(4000));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("keeps one alert with the same words while the draft stays over, and the count apart from it", () => {
    render(<Wrapper />);
    type("字".repeat(4001));
    const alert = screen.getByRole("alert");
    type("字".repeat(4050));
    // The same node, the same text: typing does not announce it again.
    expect(screen.getByRole("alert")).toBe(alert);
    expect(alert.textContent).toBe("超過 4000 字上限，請縮短後再送出");
    const count = screen.getByText("目前超過 50 字");
    expect(count.closest("[role='alert'], [aria-live]")).toBeNull();
    const described = box().getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(described).toContain(alert.id);
    expect(described).toContain(count.id);
  });

  it("ignores a stop within 400 ms of sending, so the second click of a double click cannot cancel", async () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(<Wrapper onSend={onSend} onStop={onStop} />);
    type("問題");
    await userEvent.click(screen.getByRole("button", { name: "送出" }));
    expect(onSend).toHaveBeenCalledOnce();
    // The button is now the real 停止 button, which is where a second click lands.
    await userEvent.click(screen.getByRole("button", { name: "停止" }));
    expect(onStop).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "停止" })).toBeTruthy();
  });

  it("stops once the window has passed", async () => {
    const onStop = vi.fn();
    render(<Wrapper onStop={onStop} />);
    type("問題");
    const sentAt = Date.now();
    await userEvent.click(screen.getByRole("button", { name: "送出" }));
    vi.spyOn(Date, "now").mockReturnValue(sentAt + 399);
    await userEvent.click(screen.getByRole("button", { name: "停止" }));
    expect(onStop).not.toHaveBeenCalled();
    vi.spyOn(Date, "now").mockReturnValue(sentAt + 1000);
    await userEvent.click(screen.getByRole("button", { name: "停止" }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("switches to 停止 while streaming, and stopping works after the double-click window", async () => {
    const onStop = vi.fn();
    render(<Wrapper onStop={onStop} />);
    type("問題");
    await userEvent.click(screen.getByRole("button", { name: "送出" }));
    expect(screen.queryByRole("button", { name: "送出" })).toBeNull();
    const stop = screen.getByRole("button", { name: "停止" });
    expect(stop.className).toContain("min-h-11");
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 1000);
    await userEvent.click(stop);
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("Enter while streaming does not send", async () => {
    const onSend = vi.fn();
    render(<Wrapper onSend={onSend} />);
    type("一");
    fireEvent.keyDown(box(), { key: "Enter" });
    type("二");
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledOnce();
  });

  it("is disabled offline and says why", () => {
    render(<Wrapper offline />);
    expect((box() as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "送出" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("需要連線才能提問");
  });

  it("puts focus back in the box after sending with the button and after stopping", async () => {
    render(<Wrapper />);
    type("問題");
    await userEvent.click(screen.getByRole("button", { name: "送出" }));
    expect(document.activeElement).toBe(box());
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1000);
    await userEvent.click(screen.getByRole("button", { name: "停止" }));
    expect(document.activeElement).toBe(box());
  });
});
