import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "./message-list";
import { makeTurn } from "./turn-fixture";
import type { Turn } from "./use-ask-chat";

const turn = (id: string, role: Turn["role"], text: string): Turn => makeTurn({ id, role, text });

let scrollTo: ReturnType<typeof vi.fn>;

/** happy-dom has no layout: the page's scroll metrics are whatever the test says. */
function setMetrics(m: { height: number; top: number; viewport: number }) {
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    value: m.height,
  });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: m.viewport });
  Object.defineProperty(window, "scrollY", { configurable: true, value: m.top });
}
const userScrollsTo = (top: number) => {
  Object.defineProperty(window, "scrollY", { configurable: true, value: top });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
};

beforeEach(() => {
  scrollTo = vi.fn();
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  setMetrics({ height: 2000, top: 1500, viewport: 500 });
});
afterEach(() => {
  vi.restoreAllMocks();
});

const renderList = (turns: Turn[], busy = false) => (
  <MessageList turns={turns} busy={busy} renderTurn={(t) => <p data-testid={t.id}>{t.text}</p>} />
);

describe("MessageList", () => {
  it("is a polite log, busy while an answer streams", () => {
    const { rerender } = render(renderList([turn("a", "user", "問")], true));
    const log = screen.getByRole("log");
    expect(log.getAttribute("aria-live")).toBe("polite");
    expect(log.getAttribute("aria-busy")).toBe("true");
    rerender(renderList([turn("a", "user", "問")], false));
    expect(log.getAttribute("aria-busy")).toBe("false");
  });

  it("renders every turn in order", () => {
    render(renderList([turn("a", "user", "問"), turn("b", "assistant", "答")]));
    const texts = screen.getAllByTestId(/^[ab]$/).map((el) => el.textContent);
    expect(texts).toEqual(["問", "答"]);
  });

  it("follows the answer while the reader is at the bottom", () => {
    const { rerender } = render(
      renderList([turn("a", "user", "問"), turn("b", "assistant", "答")]),
    );
    scrollTo.mockClear();
    rerender(renderList([turn("a", "user", "問"), turn("b", "assistant", "答答")]));
    expect(scrollTo).toHaveBeenCalledWith({ top: 2000, behavior: "auto" });
  });

  it("stops following after the reader scrolls up", () => {
    const { rerender } = render(
      renderList([turn("a", "user", "問"), turn("b", "assistant", "答")]),
    );
    userScrollsTo(600);
    scrollTo.mockClear();
    rerender(renderList([turn("a", "user", "問"), turn("b", "assistant", "答答")]));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("follows again once the reader is back at the bottom", () => {
    const { rerender } = render(
      renderList([turn("a", "user", "問"), turn("b", "assistant", "答")]),
    );
    userScrollsTo(600);
    userScrollsTo(1490);
    scrollTo.mockClear();
    rerender(renderList([turn("a", "user", "問"), turn("b", "assistant", "答答")]));
    expect(scrollTo).toHaveBeenCalled();
  });

  it("jumps to the bottom for a new question even if the reader had scrolled up", () => {
    const first = [turn("a", "user", "問"), turn("b", "assistant", "答")];
    const { rerender } = render(renderList(first));
    userScrollsTo(100);
    scrollTo.mockClear();
    rerender(renderList([...first, turn("c", "user", "再問"), turn("d", "assistant", "")]));
    expect(scrollTo).toHaveBeenCalled();
  });

  it("never animates the scroll, so reduced motion is respected", () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    const { rerender } = render(renderList([turn("a", "user", "問")]));
    rerender(renderList([turn("a", "user", "問"), turn("b", "assistant", "答")]));
    for (const [arg] of scrollTo.mock.calls) {
      expect(arg.behavior).not.toBe("smooth");
    }
  });

  it("removes its scroll listener on unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(renderList([turn("a", "user", "問")]));
    unmount();
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
    fireEvent.scroll(window);
  });
});
