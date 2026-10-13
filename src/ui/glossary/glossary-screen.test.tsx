import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GLOSSARY } from "@/glossary";
import { SETTINGS_KEY } from "@/ui/device/settings";
import { SettingsProvider } from "@/ui/device/settings-provider";
import { GlossaryScreen } from "@/ui/glossary/glossary-screen";

let respondWith: () => Promise<Response>;

beforeEach(() => {
  respondWith = async () => Response.json({ terms: GLOSSARY });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => respondWith()),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

async function renderScreen() {
  render(
    <SettingsProvider>
      <GlossaryScreen />
    </SettingsProvider>,
  );
  // The list appears once the fetch settles.
  await screen.findByRole("searchbox", { name: "搜尋名詞" });
  await screen.findAllByRole("button", { name: new RegExp(`^${GLOSSARY[0]?.term}`) });
}

describe("GlossaryScreen", () => {
  it("lists terms under their category headings, hiding a category with no terms", async () => {
    await renderScreen();
    const present = new Set(GLOSSARY.map((t) => t.category));
    expect(screen.getByRole("heading", { name: "市場" })).toBeTruthy();
    for (const [category, label] of [
      ["flow", "資金"],
      ["limit", "漲跌停"],
      ["planning", "規劃"],
    ] as const) {
      expect(!!screen.queryByRole("heading", { name: label })).toBe(present.has(category));
    }
  });

  it("filters the list as the user types", async () => {
    await renderScreen();
    const box = screen.getByRole("searchbox", { name: "搜尋名詞" });
    await userEvent.type(box, "內外盤差");
    expect(screen.getByRole("button", { name: /內外盤金額差/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^週轉率/ })).toBeNull();
  });

  it("says so when nothing matches", async () => {
    await renderScreen();
    await userEvent.type(screen.getByRole("searchbox", { name: "搜尋名詞" }), "zzzzzz不存在");
    expect(screen.getByText("找不到符合的名詞。")).toBeTruthy();
  });

  it("opens the panel for a listed term, in the stored lens", async () => {
    const target = GLOSSARY.find((t) => t.id === "net-active-buy");
    if (!target) throw new Error("fixture term missing");
    await renderScreen();
    await userEvent.click(screen.getByRole("button", { name: new RegExp(target.term) }));
    const dialog = screen.getByRole("dialog", { name: target.term });
    expect(within(dialog).getByText(target.beginner.whyItMatters)).toBeTruthy();
  });

  it("opens every listed term", async () => {
    await renderScreen();
    for (const t of GLOSSARY.slice(0, 3)) {
      await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${t.term}`) }));
      expect(screen.getByRole("dialog", { name: t.term })).toBeTruthy();
      await userEvent.click(screen.getByRole("button", { name: "關閉" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    }
  });

  it("shows the pro text when the device lens is pro", async () => {
    window.localStorage.setItem(SETTINGS_KEY, '{"lens":"pro","theme":"system"}');
    const target = GLOSSARY[0];
    if (!target) throw new Error("no terms");
    await renderScreen();
    await userEvent.click(screen.getByRole("button", { name: new RegExp(`^${target.term}`) }));
    expect(screen.getByText(target.pro.definition)).toBeTruthy();
  });

  it("shows a loading note, then an error note when the request fails", async () => {
    respondWith = async () => new Response("down", { status: 500 });
    render(
      <SettingsProvider>
        <GlossaryScreen />
      </SettingsProvider>,
    );
    expect(screen.getByText("載入中…")).toBeTruthy();
    expect(await screen.findByText("名詞暫時載入失敗，請稍後再試。")).toBeTruthy();
    await act(async () => {});
  });
});
