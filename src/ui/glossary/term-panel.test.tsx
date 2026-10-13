import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTerm } from "@/glossary";
import type { Lens } from "@/insight/lens";
import { TermPanel } from "@/ui/glossary/term-panel";

function mustTerm(id: string) {
  const found = getTerm(id);
  if (!found) throw new Error(`missing test term ${id}`);
  return found;
}

/** Hosts the panel the way a screen does: related chips switch the shown term. */
function Host({
  start,
  lens,
  wide = false,
  onOpenChange,
}: {
  start: string;
  lens: Lens;
  wide?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [id, setId] = useState(start);
  return (
    <TermPanel
      term={mustTerm(id)}
      lens={lens}
      wide={wide}
      open
      onOpenChange={onOpenChange ?? (() => {})}
      onOpenRelated={setId}
    />
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TermPanel", () => {
  it("beginner lens shows plain, analogy and why it matters, not the definition", () => {
    const t = mustTerm("net-active-buy");
    render(<Host start="net-active-buy" lens="beginner" />);
    const dialog = screen.getByRole("dialog", { name: t.term });
    expect(within(dialog).getByText(t.beginner.plain)).toBeTruthy();
    expect(within(dialog).getByText(`比喻：${t.beginner.analogy}`)).toBeTruthy();
    expect(within(dialog).getByText(t.beginner.whyItMatters)).toBeTruthy();
    expect(within(dialog).queryByText(t.pro.definition)).toBeNull();
    expect(within(dialog).queryByText("來源：darkfanxing")).toBeNull();
  });

  it("pro lens shows the definition and source, hides the beginner text", () => {
    const t = mustTerm("net-active-buy");
    render(<Host start="net-active-buy" lens="pro" />);
    const dialog = screen.getByRole("dialog", { name: t.term });
    expect(within(dialog).getByText(t.pro.definition)).toBeTruthy();
    expect(within(dialog).getByText("來源：darkfanxing")).toBeTruthy();
    expect(within(dialog).queryByText(t.beginner.whyItMatters)).toBeNull();
    expect(within(dialog).queryByText(t.beginner.plain)).toBeNull();
  });

  it("pro lens shows a formula when there is one and 來源：自編 for curated terms", () => {
    const t = mustTerm("net-active-buy");
    const custom = {
      ...t,
      pro: { definition: "自訂定義", formula: "A ÷ B", source: "curated" as const },
    };
    render(
      <TermPanel
        term={custom}
        lens="pro"
        wide={false}
        open
        onOpenChange={() => {}}
        onOpenRelated={() => {}}
      />,
    );
    expect(screen.getByText("A ÷ B")).toBeTruthy();
    expect(screen.getByText("來源：自編")).toBeTruthy();
  });

  it("renders no 比喻： when the analogy is null", () => {
    const t = mustTerm("net-active-buy");
    const noAnalogy = { ...t, beginner: { ...t.beginner, analogy: null } };
    render(
      <TermPanel
        term={noAnalogy}
        lens="beginner"
        wide={false}
        open
        onOpenChange={() => {}}
        onOpenRelated={() => {}}
      />,
    );
    expect(screen.queryByText(/比喻：/)).toBeNull();
    expect(screen.getByText(t.beginner.plain)).toBeTruthy();
  });

  it("switches to a related term when its chip is clicked", async () => {
    const start = mustTerm("net-active-buy");
    const related = mustTerm(start.related[0] as string);
    render(<Host start="net-active-buy" lens="beginner" />);
    await userEvent.click(screen.getByRole("button", { name: related.term }));
    const dialog = screen.getByRole("dialog", { name: related.term });
    expect(within(dialog).getByText(related.beginner.whyItMatters)).toBeTruthy();
    expect(within(dialog).queryByText(start.beginner.whyItMatters)).toBeNull();
  });

  it("closes through a close button named 關閉", async () => {
    const onOpenChange = vi.fn();
    render(<Host start="net-active-buy" lens="beginner" onOpenChange={onOpenChange} />);
    expect(screen.queryByText("Close")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "關閉" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("slides up from the bottom when narrow and in from the right when wide", () => {
    const { unmount } = render(<Host start="net-active-buy" lens="beginner" />);
    expect(screen.getByRole("dialog").getAttribute("data-side")).toBe("bottom");
    unmount();
    render(<Host start="net-active-buy" lens="beginner" wide />);
    expect(screen.getByRole("dialog").getAttribute("data-side")).toBe("right");
  });
});
