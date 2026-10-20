// Accessibility checks for the Ask screen that need no layout: heading structure, the log region,
// names, focus order, the focus trap of the two sheets, which live-region role is used where, and
// the 44 px targets (checked on the classes, as happy-dom has no layout). What only a browser can
// show (focus ring look, wrapping at 400 px) is checked by hand and recorded in the task report.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLOSSARY } from "@/glossary/terms";
import { SettingsProvider } from "@/ui/device/settings-provider";
import { AskChat } from "./ask-chat";
import { ASK_COPY } from "./copy";
import { InviteScreen } from "./invite-screen";
import { writeAck, writeHoldings, writeMemory } from "./stores";
import {
  controlledStream,
  finishChunk,
  type StreamChunk,
  textChunks,
  uiStreamResponse,
} from "./stream-fixture";

vi.mock("@/ui/data/ask-auth", () => ({ getAskSession: vi.fn(), postInvite: vi.fn() }));
// The glossary comes over the network in the app; the bundled one stands in.
vi.mock("@/ui/glossary/use-glossary", () => ({
  useGlossary: () => ({
    terms: GLOSSARY,
    byId: Object.fromEntries(GLOSSARY.map((term) => [term.id, term])),
    status: "ready",
  }),
}));

const { postInvite } = await import("@/ui/data/ask-auth");

const HEADINGS = ["結論", "依據", "情境", "對你的意義", "建議", "一般選項", "信心程度"];
const FULL_ANSWER = [
  ...HEADINGS.flatMap((heading) => [`**${heading}**`, `${heading}的內容，ETF 很分散。`, ""]),
  "[來源](https://example.com/news) 年化 87.65%",
  "要不要我記住：我兩年內想買房",
].join("\n");
const VERIFICATION: StreamChunk = {
  type: "data-verification",
  data: { unsupported: ["87.65"], checked: true },
};

const fullAnswer = () =>
  uiStreamResponse([...textChunks(FULL_ANSWER), VERIFICATION, { ...finishChunk }]);

function mount(fetchImpl: typeof fetch = (async () => fullAnswer()) as unknown as typeof fetch) {
  const wrap = (node: ReactNode) => <SettingsProvider>{node}</SettingsProvider>;
  return render(wrap(<AskChat fetchImpl={fetchImpl} onSignedOut={() => {}} />));
}

const box = () => screen.getByRole("textbox", { name: "提問" }) as HTMLTextAreaElement;
async function ask(text: string) {
  fireEvent.change(box(), { target: { value: text } });
  await userEvent.click(screen.getByRole("button", { name: "送出" }));
}

/** The names of the next `count` focus stops, pressing Tab (or Shift+Tab) from where focus is. */
async function stops(count: number, shift = false): Promise<string[]> {
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    await userEvent.tab({ shift });
    const element = document.activeElement as HTMLElement;
    names.push(element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "");
  }
  return names;
}

const idsOf = (root: ParentNode): string[] =>
  [...root.querySelectorAll("[id]")].map((element) => element.id);
const duplicates = (ids: string[]): string[] => ids.filter((id, i) => ids.indexOf(id) !== i);

/** Whether the classes give the control a height of at least 44 px (2.75 rem; Tailwind 11). */
function tallEnough(element: Element): boolean {
  return /(^|\s)(min-h-11|h-11|size-11|min-h-12|h-12)(\s|$)/.test(
    element.getAttribute("class") ?? "",
  );
}
function wideEnough(element: Element): boolean {
  return /(^|\s)(min-w-11|w-11|size-11|min-w-16|w-full|flex-1)(\s|$)/.test(
    element.getAttribute("class") ?? "",
  );
}

/**
 * The controls a finger has to hit. Inline controls inside running text (the glossary chips) are
 * left out: WCAG 2.5.8 exempts inline targets, and the chip is shared with the other screens.
 */
const isInlineChip = (element: Element) =>
  element.closest("article") !== null && /(^|\s)rounded-full(\s|$)/.test(element.className);
const CONTROLS = "button, input, textarea, select, [role='switch']";
function controlsIn(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(CONTROLS)].filter(
    (element) => !isInlineChip(element),
  );
}

beforeEach(() => {
  writeAck();
});
afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

describe("chat: heading structure", () => {
  it("has one h1 and nothing else before the first answer", () => {
    mount();
    expect(screen.getAllByRole("heading").map((h) => [h.tagName, h.textContent])).toEqual([
      ["H1", "問問看"],
    ]);
  });

  it("puts the seven answer titles under the h1 without skipping a level", async () => {
    mount();
    await ask("你好");
    await screen.findByText(ASK_COPY.chat.verdict);
    const headings = screen.getAllByRole("heading");
    const levels = headings.map((h) => Number(h.tagName.slice(1)));
    expect(headings.map((h) => h.textContent)).toEqual(["問問看", ...HEADINGS]);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) {
      expect((levels[i] ?? 0) - (levels[i - 1] ?? 0)).toBeLessThanOrEqual(1);
    }
  });
});

describe("chat: the log region", () => {
  it("is a polite, named log that is busy only while an answer streams", async () => {
    let stream: ReturnType<typeof controlledStream> | undefined;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      stream = controlledStream(init?.signal);
      return stream.response;
    }) as unknown as typeof fetch;
    mount(fetchImpl);
    const log = screen.getByRole("log", { name: ASK_COPY.chat.logLabel });
    expect(log.getAttribute("aria-live")).toBe("polite");
    expect(log.getAttribute("aria-busy")).toBe("false");

    await ask("你好");
    await waitFor(() => expect(stream).toBeDefined());
    for (const chunk of textChunks("**結論**\n先說")) stream?.push(chunk);
    await waitFor(() => expect(log.getAttribute("aria-busy")).toBe("true"));
    // Additions are announced, not every text change inside them.
    expect(log.getAttribute("aria-relevant")).toBe("additions");

    stream?.push({ ...finishChunk });
    stream?.close();
    await waitFor(() => expect(log.getAttribute("aria-busy")).toBe("false"));
  });

  it("holds each answer in an article", async () => {
    mount();
    await ask("你好");
    await screen.findByText(ASK_COPY.chat.verdict);
    const log = screen.getByRole("log");
    expect(within(log).getAllByRole("article")).toHaveLength(1);
  });
});

describe("chat: names and ids", () => {
  it("names the question box, every button and the switch, with no duplicate ids", async () => {
    mount();
    await ask("你好");
    await screen.findByText(ASK_COPY.chat.verdict);
    expect(screen.getByRole("textbox", { name: "提問" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /./ })).toHaveLength(
      screen.getAllByRole("button").length,
    );
    expect(duplicates(idsOf(document.body))).toEqual([]);
  });

  it("gives the link a name that says it opens a new tab, and a safe rel", async () => {
    mount();
    await ask("你好");
    const link = await screen.findByRole("link", { name: /來源/ });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.textContent).toContain(ASK_COPY.answer.opensInNewTab);
  });
});

describe("chat: focus order", () => {
  it("goes header, suggestions, question box; 送出 joins once there is text", async () => {
    mount();
    // From the page start: the data button, the new-chat button, four suggestions, the box. The
    // data button sits in the header, so it comes before the composer, in reading order.
    expect(await stops(7)).toEqual(["我的資料", "新對話", ...ASK_COPY.chat.suggestions, "提問"]);
    // 送出 is disabled while the box is empty, so the next stop is outside the chat.
    expect(await stops(1)).not.toContain("送出");
  });

  it("goes question box then 送出 with a draft in it", async () => {
    mount();
    fireEvent.change(box(), { target: { value: "你好" } });
    box().focus();
    expect(await stops(1)).toEqual(["送出"]);
  });

  it("keeps focus in the question box after sending", async () => {
    mount();
    box().focus();
    fireEvent.change(box(), { target: { value: "你好" } });
    await userEvent.keyboard("{Enter}");
    await screen.findByText(ASK_COPY.chat.verdict);
    expect(document.activeElement).toBe(box());
  });

  it("marks the keyboard focus on the controls with a visible style", () => {
    mount();
    // The Button primitive and the question box both carry a focus-visible ring.
    expect(box().className).toContain("focus-visible:ring");
    expect(screen.getByRole("button", { name: "我的資料" }).className).toContain(
      "focus-visible:ring",
    );
  });
});

describe("chat: live-region roles", () => {
  it("uses neither status nor alert while idle or after a good answer", async () => {
    mount();
    expect(screen.queryAllByRole("status")).toHaveLength(0);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    await ask("你好");
    await screen.findByText(ASK_COPY.chat.verdict);
    // The remember offer is a card, not an announcement; the verdict and footnotes are plain text.
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(screen.queryAllByRole("status")).toHaveLength(0);
  });

  it("announces a refusal as one alert", async () => {
    mount((async () => new Response("{}", { status: 429 })) as unknown as typeof fetch);
    await ask("你好");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("今天的提問次數用完了");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("announces a saved remember note as a status", async () => {
    mount();
    await ask("你好");
    await userEvent.click(await screen.findByRole("button", { name: "記住" }));
    expect((await screen.findByRole("status")).textContent).toBe(ASK_COPY.remember.saved);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it("says offline as a status (not an alert) and disables asking", () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    mount();
    expect(screen.getByRole("status").textContent).toContain(ASK_COPY.composer.offline);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(box().disabled).toBe(true);
  });

  it("announces a draft over the limit as an alert wired to the box", () => {
    mount();
    fireEvent.change(box(), { target: { value: "字".repeat(4001) } });
    const alert = screen.getByRole("alert");
    expect(box().getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);
    expect(alert.id).not.toBe("");
  });

  it("announces a broken answer as an alert and a notice as a status", async () => {
    const chunks: StreamChunk[] = [
      { type: "start" },
      { type: "data-notice", data: { kind: "no_web", text: "這次沒有查網路" } },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "半句" },
      { type: "error", errorText: "x" },
    ];
    mount((async () => uiStreamResponse(chunks)) as unknown as typeof fetch);
    await ask("你好");
    expect((await screen.findByRole("alert")).textContent).toContain(ASK_COPY.chat.failedTurn);
    expect(screen.getByRole("status").textContent).toBe("這次沒有查網路");
  });
});

describe("my-data sheet", () => {
  async function openSheet() {
    mount();
    const trigger = screen.getByRole("button", { name: "我的資料" });
    await userEvent.click(trigger);
    return { trigger, dialog: await screen.findByRole("dialog", { name: "我的資料" }) };
  }

  it("is a named, described dialog with headings below its title", async () => {
    const { dialog } = await openSheet();
    expect(dialog.getAttribute("aria-describedby")).not.toBeNull();
    const headings = within(dialog).getAllByRole("heading");
    expect(headings.map((h) => h.tagName)).toEqual(["H2", "H3", "H3", "H3", "H3"]);
    expect(duplicates(idsOf(document.body))).toEqual([]);
  });

  it("keeps Tab and Shift+Tab inside, and Escape closes it and gives focus back", async () => {
    writeHoldings([{ symbol: "2330", amount: 1000, quantity: 1 }]);
    writeMemory(["我兩年內想買房"]);
    const { trigger, dialog } = await openSheet();
    // More stops than the sheet has controls: focus must wrap, never reach the page behind.
    const total = controlsIn(dialog).length + 3;
    for (let i = 0; i < total; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < total; i++) {
      await userEvent.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it("labels the switch, every editor field and the close button", async () => {
    writeHoldings([{ symbol: "2330", amount: 1000, quantity: 1 }]);
    writeMemory(["我兩年內想買房"]);
    const { dialog } = await openSheet();
    expect(
      within(dialog).getByRole("switch", { name: ASK_COPY.data.plan.switchLabel }),
    ).toBeTruthy();
    expect(within(dialog).getByRole("textbox", { name: "代號" })).toBeTruthy();
    expect(within(dialog).getByRole("textbox", { name: /金額/ })).toBeTruthy();
    expect(within(dialog).getByRole("textbox", { name: "股數" })).toBeTruthy();
    expect(
      within(dialog).getByRole("textbox", { name: ASK_COPY.data.memory.addLabel }),
    ).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: ASK_COPY.data.close })).toBeTruthy();
    expect(within(dialog).getAllByRole("button", { name: /./ })).toHaveLength(
      within(dialog).getAllByRole("button").length,
    );
  });

  it("announces the summary politely and the cleared state as a status", async () => {
    const { dialog } = await openSheet();
    expect(within(dialog).getByTestId("ask-data-summary").getAttribute("aria-live")).toBe("polite");
    await userEvent.click(within(dialog).getByRole("button", { name: ASK_COPY.data.clear.button }));
    await userEvent.click(within(dialog).getByRole("button", { name: ASK_COPY.data.clear.yes }));
    expect((await within(dialog).findByRole("status")).textContent).toBe(ASK_COPY.data.clear.done);
  });
});

describe("disclosure dialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  async function openDisclosure() {
    mount();
    fireEvent.change(box(), { target: { value: "你好" } });
    await userEvent.click(screen.getByRole("button", { name: "送出" }));
    return screen.findByRole("dialog", { name: ASK_COPY.disclosure.title });
  }

  it("is a named, described dialog that keeps Tab inside", async () => {
    const dialog = await openDisclosure();
    expect(dialog.getAttribute("aria-describedby")).not.toBeNull();
    for (let i = 0; i < 5; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 5; i++) {
      await userEvent.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("returns focus to the question box when Escape closes it", async () => {
    const dialog = await openDisclosure();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    expect(document.activeElement).toBe(box());
  });
});

describe("invite screen", () => {
  const mockInvite = vi.mocked(postInvite);
  afterEach(() => mockInvite.mockReset());

  it("has one h1, a labelled field and a submit button", () => {
    render(<InviteScreen onSignedIn={() => {}} />);
    expect(screen.getAllByRole("heading").map((h) => [h.tagName, h.textContent])).toEqual([
      ["H1", ASK_COPY.invite.heading],
    ]);
    const field = screen.getByLabelText(ASK_COPY.invite.label);
    expect(field.tagName).toBe("INPUT");
    expect(screen.getByRole("button", { name: ASK_COPY.invite.submit })).toBeTruthy();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(screen.queryAllByRole("status")).toHaveLength(0);
  });

  it("tabs from the field to the button once there is a code", async () => {
    render(<InviteScreen onSignedIn={() => {}} />);
    await userEvent.type(screen.getByLabelText(ASK_COPY.invite.label), "abc");
    expect(await stops(1)).toEqual([ASK_COPY.invite.submit]);
  });

  it("announces a wrong code as one alert wired to the field, which keeps focus", async () => {
    mockInvite.mockResolvedValue("invalid");
    render(<InviteScreen onSignedIn={() => {}} />);
    const field = screen.getByLabelText(ASK_COPY.invite.label);
    await userEvent.type(field, "abc");
    await userEvent.click(screen.getByRole("button", { name: ASK_COPY.invite.submit }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(ASK_COPY.invite.invalid);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(alert.id);
    expect(document.activeElement).toBe(field);
  });
});

describe("44 px targets", () => {
  it("gives every control of the empty chat a 44 px height", () => {
    const { container } = mount();
    const controls = controlsIn(container);
    expect(controls.length).toBeGreaterThanOrEqual(7);
    for (const control of controls) expect(tallEnough(control), control.outerHTML).toBe(true);
    // Send and stop are wide enough as well.
    fireEvent.change(box(), { target: { value: "你好" } });
    expect(wideEnough(screen.getByRole("button", { name: "送出" }))).toBe(true);
  });

  it("gives the answer's own buttons 44 px, leaving only the inline glossary chips", async () => {
    const { container } = mount();
    await ask("你好");
    await screen.findByRole("button", { name: "記住" });
    // The only control left out is the glossary chip, and the answer does contain one.
    expect(container.querySelectorAll("article button.rounded-full")).toHaveLength(1);
    for (const control of controlsIn(container)) {
      expect(tallEnough(control), control.outerHTML).toBe(true);
    }
  });

  it("gives every control in the my-data sheet 44 px", async () => {
    writeHoldings([{ symbol: "2330", amount: 1000, quantity: 1 }]);
    writeMemory(["我兩年內想買房"]);
    mount();
    await userEvent.click(screen.getByRole("button", { name: "我的資料" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: ASK_COPY.data.clear.button }));
    const controls = controlsIn(dialog);
    expect(controls.length).toBeGreaterThan(10);
    for (const control of controls) expect(tallEnough(control), control.outerHTML).toBe(true);
  });

  it("gives the disclosure buttons and the invite screen 44 px", async () => {
    window.localStorage.clear();
    const { unmount } = mount();
    fireEvent.change(box(), { target: { value: "你好" } });
    await userEvent.click(screen.getByRole("button", { name: "送出" }));
    const dialog = await screen.findByRole("dialog", { name: ASK_COPY.disclosure.title });
    for (const control of controlsIn(dialog)) expect(tallEnough(control)).toBe(true);
    unmount();
    const { container } = render(<InviteScreen onSignedIn={() => {}} />);
    for (const control of controlsIn(container)) expect(tallEnough(control)).toBe(true);
  });
});
