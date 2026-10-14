import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseDigest, parseSectorBoard } from "@/sources/darkfanxing";
import { SettingsProvider } from "@/ui/device/settings-provider";
import { ChangeList } from "@/ui/sectors/change-list";
import { FlowView } from "@/ui/sectors/flow-view";
import { QuadrantView } from "@/ui/sectors/quadrant-view";

const fixtures = join(import.meta.dirname, "../../../test/fixtures/darkfanxing");
const board = parseSectorBoard(readFileSync(join(fixtures, "now-2026-10-08.html"), "utf8"));
const digest = parseDigest(readFileSync(join(fixtures, "digest-2026-10-08.html"), "utf8"));

const current = () =>
  screen
    .queryAllByRole("button")
    .filter((el) => el.getAttribute("aria-current") === "true")
    .map((el) => el.querySelector('[data-slot="sector-name"]')?.textContent ?? el.textContent);

beforeEach(() => {
  // QuadrantView asks for glossary terms; none are needed here.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ error: "not_found" }, { status: 404 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("the selected sector is marked in every view", () => {
  it("ChangeList marks only the selected row", () => {
    const rows = board.sectors.slice(0, 5);
    const name = rows[2]?.name;
    render(
      <ChangeList
        rows={rows}
        lens="pro"
        dir="desc"
        onToggleDir={() => {}}
        selected={name ?? null}
        onSelect={() => {}}
      />,
    );
    expect(current()).toEqual([name]);
  });

  it("FlowView marks only the selected row", () => {
    const name = digest.netBuy?.[0]?.name;
    expect(name).toBeTruthy();
    render(
      <FlowView
        netBuy={digest.netBuy}
        netSell={digest.netSell}
        lens="pro"
        selected={name ?? null}
        onSelect={() => {}}
      />,
    );
    expect(current()).toEqual([name]);
  });

  it("QuadrantView marks the selected sector wherever it is listed", () => {
    render(
      <SettingsProvider>
        <QuadrantView quadrant={digest.quadrant} selected="車用電子" onSelect={() => {}} />
      </SettingsProvider>,
    );
    const marked = current();
    expect(marked.length).toBeGreaterThan(0);
    expect(new Set(marked)).toEqual(new Set(["車用電子"]));
  });

  it("marks nothing when nothing is selected", () => {
    render(
      <FlowView
        netBuy={digest.netBuy}
        netSell={digest.netSell}
        lens="pro"
        selected={null}
        onSelect={() => {}}
      />,
    );
    expect(current()).toEqual([]);
  });
});
