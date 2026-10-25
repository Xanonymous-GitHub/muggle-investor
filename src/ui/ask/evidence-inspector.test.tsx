import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ASK_COPY } from "./copy";
import { EvidenceDetails, formatTaipei, recordLimits } from "./evidence-details";
import { EvidenceInspector, INSPECTOR_ID } from "./evidence-inspector";
import { makeRecord } from "./turn-fixture";

afterEach(() => {
  vi.restoreAllMocks();
});

const COPY = ASK_COPY.evidenceInspector;

describe("EvidenceDetails", () => {
  it("shows what the record carries, in Taipei time", () => {
    render(
      <EvidenceDetails
        index={1}
        record={makeRecord({
          retrievedAt: "2026-10-24T08:00:00.000Z",
          dataDate: "2026-10-24",
          session: "closed",
        })}
      />,
    );
    expect(screen.getByText("來源 1：今日行情")).toBeTruthy();
    expect(screen.getByText("2026-10-24")).toBeTruthy();
    expect(screen.getByText("收盤")).toBeTruthy();
    expect(screen.getByText("2026/10/24 16:00")).toBeTruthy();
    expect(screen.getByText(COPY.returned)).toBeTruthy();
  });

  it("says 未提供 for every field the record does not carry, and invents nothing", () => {
    render(
      <EvidenceDetails
        index={2}
        record={makeRecord({ dataDate: null, asOf: null, session: null })}
      />,
    );
    expect(screen.getAllByText(COPY.missing)).toHaveLength(3);
  });

  it("says plainly that no passage is kept, instead of showing an excerpt", () => {
    render(<EvidenceDetails index={1} record={makeRecord()} />);
    expect(screen.getByText(COPY.excerptMissing)).toBeTruthy();
    expect(screen.getByText(COPY.scope)).toBeTruthy();
  });

  it("marks a lookup that returned nothing", () => {
    render(<EvidenceDetails index={1} record={makeRecord({ failed: true })} />);
    expect(screen.getByText(COPY.failed)).toBeTruthy();
    expect(screen.queryByText(COPY.returned)).toBeNull();
  });

  it("lists limits as sentences: truncated, stale, provisional, mixed", () => {
    const record = makeRecord({
      truncated: true,
      warnings: ["stale", "provisional", "mixed_session"],
    });
    expect(recordLimits(record)).toEqual([
      COPY.truncated,
      COPY.warnings.stale,
      COPY.warnings.provisional,
      COPY.warnings.mixed_session,
    ]);
    render(<EvidenceDetails index={1} record={record} />);
    expect(screen.getByText(COPY.warnings.stale)).toBeTruthy();
  });

  it("ignores a warning it has no sentence for, and one that names a prototype key", () => {
    expect(recordLimits(makeRecord({ warnings: ["constructor", "__proto__", "novel"] }))).toEqual(
      [],
    );
  });

  it("opens links as https in a new tab with a safe rel, and keeps unsafe text unlinked", () => {
    render(
      <EvidenceDetails
        index={1}
        record={makeRecord({ urls: ["example.com/news/1", "bad host/x"] })}
      />,
    );
    const link = screen.getByRole("link", { name: /example\.com\/news\/1/ });
    expect(link.getAttribute("href")).toBe("https://example.com/news/1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("bad host/x").closest("a")).toBeNull();
  });

  it("says there are no links when there are none", () => {
    render(<EvidenceDetails index={1} record={makeRecord({ urls: [] })} />);
    expect(screen.getByText(COPY.noLinks)).toBeTruthy();
  });

  it("formats an unreadable time as it came", () => {
    expect(formatTaipei("not a time")).toBe("not a time");
  });
});

describe("EvidenceInspector beside the conversation", () => {
  const target = { turnId: "t1", index: 1, record: makeRecord() };

  it("renders nothing without a source", () => {
    const { container } = render(<EvidenceInspector target={null} beside onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("is a named non-modal panel and puts focus on its title", () => {
    render(<EvidenceInspector target={target} beside onClose={() => {}} />);
    const panel = screen.getByRole("complementary", { name: COPY.title });
    expect(panel.id).toBe(INSPECTOR_ID);
    expect(document.activeElement).toBe(within(panel).getByRole("heading", { name: COPY.title }));
    // Not a dialog: the answer next to it stays readable and operable.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes with Escape and with the close button", async () => {
    const onClose = vi.fn();
    render(<EvidenceInspector target={target} beside onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("heading", { name: COPY.title }), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: COPY.close }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("moves focus to the title again when it shows another source", () => {
    const { rerender } = render(<EvidenceInspector target={target} beside onClose={() => {}} />);
    (document.activeElement as HTMLElement).blur();
    rerender(
      <EvidenceInspector
        target={{ turnId: "t1", index: 2, record: makeRecord({ id: "s2" }) }}
        beside
        onClose={() => {}}
      />,
    );
    expect(document.activeElement?.textContent).toBe(COPY.title);
  });
});

describe("EvidenceInspector as a sheet", () => {
  const target = { turnId: "t1", index: 1, record: makeRecord() };

  it("is a named dialog with the details and a 44 px close button", async () => {
    render(<EvidenceInspector target={target} beside={false} onClose={() => {}} />);
    const dialog = await screen.findByRole("dialog", { name: COPY.title });
    expect(within(dialog).getByText("來源 1：今日行情")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: COPY.close }).className).toContain(
      "min-h-11",
    );
  });

  it("calls onClose on Escape, so the screen can return focus to the chip", async () => {
    const onClose = vi.fn();
    render(<EvidenceInspector target={target} beside={false} onClose={onClose} />);
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is not in the page without a source", () => {
    render(<EvidenceInspector target={null} beside={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
