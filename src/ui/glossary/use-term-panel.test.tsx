import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GLOSSARY, type GlossaryTerm } from "@/glossary";
import { SettingsProvider } from "@/ui/device/settings-provider";
import { useTermPanel } from "@/ui/glossary/term-panel";
import { matchEveryQuery } from "@/ui/test/match-media";

const sidesRendered = vi.hoisted((): (string | undefined)[] => []);

// Records the `side` every render of the sheet content was given, then renders the real thing.
vi.mock("@/components/ui/sheet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/sheet")>();
  return {
    ...actual,
    SheetContent: (props: React.ComponentProps<typeof actual.SheetContent>) => {
      sidesRendered.push(props.side);
      return actual.SheetContent(props);
    },
  };
});

const BY_ID: Record<string, GlossaryTerm> = Object.fromEntries(GLOSSARY.map((t) => [t.id, t]));
const FIRST = GLOSSARY[0] as GlossaryTerm;

function Host() {
  const { open, panel } = useTermPanel(BY_ID);
  return (
    <>
      <button type="button" onClick={() => open(FIRST.id)}>
        開啟
      </button>
      <button type="button" onClick={() => open("no-such-term")}>
        開啟不存在
      </button>
      {panel}
    </>
  );
}

const renderHost = () =>
  render(
    <SettingsProvider>
      <Host />
    </SettingsProvider>,
  );

let restore = () => {};
afterEach(() => {
  restore();
  restore = () => {};
});

describe("useTermPanel", () => {
  it("opens the panel for a term and ignores an unknown id", async () => {
    renderHost();
    await userEvent.click(screen.getByRole("button", { name: "開啟不存在" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "開啟" }));
    expect(screen.getByRole("dialog", { name: FIRST.term })).toBeTruthy();
  });

  it("renders the opened panel on the right from its very first render on a wide screen", async () => {
    restore = matchEveryQuery();
    renderHost();
    sidesRendered.length = 0;
    await userEvent.click(screen.getByRole("button", { name: "開啟" }));
    // A panel that started "bottom" and flipped after mount would list "bottom" first.
    expect(sidesRendered.length).toBeGreaterThan(0);
    expect(new Set(sidesRendered)).toEqual(new Set(["right"]));
    expect(screen.getByRole("dialog").getAttribute("data-side")).toBe("right");
  });
});
